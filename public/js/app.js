import { Signaling } from './signaling.js';
import { LocalAudio, createSpeakingDetector } from './audio.js';
import { Mesh } from './rtc.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  join: $('#join'), room: $('#room'),
  roomInput: $('#room-input'), nameInput: $('#name-input'),
  joinBtn: $('#join-btn'), joinError: $('#join-error'),
  roomName: $('#room-name'), copyLink: $('#copy-link'),
  participants: $('#participants'), sink: $('#audio-sink'),
  muteBtn: $('#mute-btn'), noiseBtn: $('#noise-btn'), leaveBtn: $('#leave-btn'),
  enableAudio: $('#enable-audio'),
};

const state = {
  audio: new LocalAudio(),
  signaling: null,
  mesh: null,
  selfId: null,
  roomName: '',
  myName: '',
  participants: new Map(), // id -> { name, muted, speaking, self, elRow, audioEl, detector }
  localDetector: null,
  pttActive: false,
};

// ─────────── Инициализация экрана входа ───────────
const pageUrl = new URL(location.href);
el.roomInput.value = pageUrl.searchParams.get('room') || '';
el.nameInput.value = localStorage.getItem('depeche:name') || '';

el.joinBtn.addEventListener('click', join);
el.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.nameInput.focus(); });
el.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

async function join() {
  const room = (el.roomInput.value || '').trim() || 'lobby';
  const name = (el.nameInput.value || '').trim();
  if (!name) { showJoinError('Введи имя'); el.nameInput.focus(); return; }

  el.joinBtn.disabled = true;
  hideJoinError();

  // 1) Микрофон. Доступен только в защищённом контексте (https:// или localhost).
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    el.joinBtn.disabled = false;
    showJoinError('Микрофон недоступен: открой сайт по HTTPS (адрес должен начинаться с https://), а не по http или по голому IP.');
    return;
  }
  try {
    await state.audio.start();
  } catch (err) {
    console.error('[mic]', err);
    el.joinBtn.disabled = false;
    showJoinError(micErrorText(err));
    return;
  }

  // 2) ICE-серверы (STUN/TURN)
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const res = await fetch('/api/ice');
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) iceServers = data.iceServers;
  } catch (err) {
    console.warn('[ice] не удалось получить конфиг, использую публичный STUN', err);
  }

  state.roomName = room;
  state.myName = name;
  localStorage.setItem('depeche:name', name);

  // Обновляем адрес в строке браузера, чтобы им можно было делиться.
  pageUrl.searchParams.set('room', room);
  history.replaceState(null, '', pageUrl);

  // 3) Сигналинг + mesh
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.signaling = new Signaling(`${wsProto}://${location.host}/ws`);
  state.mesh = new Mesh({
    signaling: state.signaling,
    getLocalStream: () => state.audio.stream,
    iceServers,
    onPeerStream: attachRemoteStream,
    onPeerConnectionState: () => {},
  });

  state.signaling.addEventListener('open', () => {
    state.signaling.send({ type: 'join', room, name });
    state.signaling.send({ type: 'state', muted: state.audio.muted });
  });
  state.signaling.addEventListener('message', (e) => onMessage(e.detail));
  state.signaling.connect();

  // 4) UI комнаты
  el.roomName.textContent = room;
  hide(el.join);
  show(el.room);
  setupLocalVad();
  wireControls();
}

// ─────────── Сообщения сигналинга ───────────
function onMessage(m) {
  switch (m.type) {
    case 'joined': {
      state.selfId = m.selfId;
      state.mesh.setSelfId(m.selfId);
      state.mesh.reset();          // на случай реконнекта — пересобираем mesh
      clearParticipants();
      upsertRow(state.selfId, { name: state.myName, self: true, muted: state.audio.muted });
      for (const p of m.peers) {
        upsertRow(p.id, { name: p.name, muted: !!p.muted });
        state.mesh.connect(p.id);
      }
      break;
    }
    case 'peer-joined':
      upsertRow(m.id, { name: m.name, muted: !!m.muted });
      state.mesh.connect(m.id);
      break;
    case 'peer-left':
      removeParticipant(m.id);
      state.mesh.disconnect(m.id);
      break;
    case 'peer-renamed':
      if (state.participants.has(m.id)) upsertRow(m.id, { name: m.name });
      break;
    case 'peer-state':
      if (state.participants.has(m.id)) upsertRow(m.id, { muted: !!m.muted });
      break;
    case 'signal':
      state.mesh.handleSignal(m.from, m.data);
      break;
    default:
      /* ignore */
  }
}

// ─────────── Список участников ───────────
function upsertRow(id, patch) {
  let rec = state.participants.get(id);
  if (!rec) {
    const row = document.createElement('li');
    row.className = 'participant';
    row.dataset.id = id;
    el.participants.appendChild(row);
    rec = { name: '', muted: false, speaking: false, self: false, elRow: row, audioEl: null, detector: null };
    state.participants.set(id, rec);
  }
  Object.assign(rec, patch);
  renderRow(rec);
  return rec;
}

function renderRow(rec) {
  rec.elRow.classList.toggle('speaking', !!rec.speaking && !rec.muted);
  rec.elRow.classList.toggle('muted', !!rec.muted);
  rec.elRow.innerHTML =
    `<span class="avatar">${escapeHtml(initial(rec.name))}</span>` +
    `<span class="pname">${escapeHtml(rec.name)}${rec.self ? ' <span class="you">(ты)</span>' : ''}</span>` +
    `<span class="pstate">${rec.muted ? '🔇' : '🎤'}</span>`;
}

function removeParticipant(id) {
  const rec = state.participants.get(id);
  if (!rec) return;
  if (rec.detector) rec.detector();
  if (rec.audioEl) { rec.audioEl.srcObject = null; rec.audioEl.remove(); }
  rec.elRow.remove();
  state.participants.delete(id);
}

function clearParticipants() {
  for (const id of [...state.participants.keys()]) removeParticipant(id);
}

// ─────────── Удалённый звук + детектор речи ───────────
function attachRemoteStream(peerId, stream) {
  const rec = state.participants.get(peerId) || upsertRow(peerId, { name: '…' });
  if (!rec.audioEl) {
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    el.sink.appendChild(audioEl);
    rec.audioEl = audioEl;
  }
  rec.audioEl.srcObject = stream;
  rec.audioEl.play().catch(() => show(el.enableAudio));

  if (rec.detector) rec.detector();
  rec.detector = createSpeakingDetector(stream, (sp) => {
    const r = state.participants.get(peerId);
    if (r) { r.speaking = sp; renderRow(r); }
  });
}

function setupLocalVad() {
  if (state.localDetector) state.localDetector();
  state.localDetector = createSpeakingDetector(state.audio.stream, (sp) => {
    if (!state.selfId) return;
    const r = state.participants.get(state.selfId);
    if (r) { r.speaking = sp; renderRow(r); }
  });
}

// ─────────── Кнопки управления ───────────
function wireControls() {
  el.muteBtn.onclick = () => applyMute(!state.audio.muted);

  el.noiseBtn.onclick = async () => {
    el.noiseBtn.disabled = true;
    const on = !state.audio.noiseSuppression;
    try {
      const newTrack = await state.audio.setNoiseSuppression(on);
      if (newTrack) state.mesh.replaceAudioTrack(newTrack);
      setupLocalVad(); // поток сменился — пересобираем детектор речи
    } catch (err) {
      console.error('[noise]', err);
    }
    el.noiseBtn.classList.toggle('on', on);
    el.noiseBtn.setAttribute('aria-pressed', String(on));
    el.noiseBtn.querySelector('.lbl').textContent = on ? 'Шумодав' : 'Шумодав off';
    el.noiseBtn.disabled = false;
  };

  el.leaveBtn.onclick = leave;
  el.copyLink.onclick = copyInvite;
  el.enableAudio.onclick = enableAudioPlayback;
}

function applyMute(muted) {
  state.audio.setMuted(muted);
  el.muteBtn.setAttribute('aria-pressed', String(muted));
  el.muteBtn.classList.toggle('active', muted);
  el.muteBtn.querySelector('.ico').textContent = muted ? '🔇' : '🎤';
  el.muteBtn.querySelector('.lbl').textContent = muted ? 'Вкл. звук' : 'Микрофон';
  if (state.selfId && state.participants.has(state.selfId)) upsertRow(state.selfId, { muted });
  if (state.signaling) state.signaling.send({ type: 'state', muted });
}

// Push-to-talk: пока экран комнаты открыт и микрофон заглушён —
// зажатый пробел временно включает звук.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || el.room.hidden) return;
  if (!state.audio.muted || state.pttActive) return;
  e.preventDefault();
  state.pttActive = true;
  applyMute(false);
});
document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !state.pttActive) return;
  e.preventDefault();
  state.pttActive = false;
  applyMute(true);
});

function leave() {
  try { if (state.signaling) state.signaling.send({ type: 'leave' }); } catch { /* ignore */ }
  if (state.signaling) { state.signaling.close(); state.signaling = null; }
  if (state.mesh) { state.mesh.reset(); state.mesh = null; }
  if (state.localDetector) { state.localDetector(); state.localDetector = null; }
  clearParticipants();
  state.audio.stop();
  el.sink.innerHTML = '';
  hide(el.enableAudio);
  show(el.join);
  hide(el.room);
  el.joinBtn.disabled = false;
}

async function copyInvite() {
  const link = `${location.origin}/?room=${encodeURIComponent(state.roomName)}`;
  try {
    await navigator.clipboard.writeText(link);
    flash(el.copyLink, '✓ Скопировано');
  } catch {
    window.prompt('Ссылка-приглашение:', link);
  }
}

function enableAudioPlayback() {
  for (const rec of state.participants.values()) {
    if (rec.audioEl) rec.audioEl.play().catch(() => {});
  }
  hide(el.enableAudio);
}

// ─────────── Мелкие помощники ───────────
function show(node) { node.hidden = false; }
function hide(node) { node.hidden = true; }
function showJoinError(text) { el.joinError.textContent = text; el.joinError.hidden = false; }
function hideJoinError() { el.joinError.hidden = true; }
function micErrorText(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Доступ к микрофону запрещён. Разреши микрофон для сайта (значок 🔒 в адресной строке) и попробуй снова.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Микрофон не найден. Подключи микрофон и попробуй снова.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Микрофон занят другим приложением (Zoom, Meet и т.п.). Закрой его и попробуй снова.';
    default:
      return 'Не удалось получить микрофон: ' + ((err && (err.name || err.message)) || 'неизвестная ошибка') + '.';
  }
}
function initial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function flash(btn, text) {
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = prev; }, 1400);
}

// Аккуратно уходим из комнаты при закрытии вкладки.
window.addEventListener('beforeunload', () => {
  try { if (state.signaling) state.signaling.send({ type: 'leave' }); } catch { /* ignore */ }
});
