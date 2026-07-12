import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';

// Сигналинг + реестр комнат. Сервер — тонкая прослойка: голос идёт P2P и через сервер
// НЕ проходит; чат живёт только в памяти комнаты и стирается при её удалении; на диск
// ничего не пишется.
//
// Room = { name, peers: Map<id,{ws,name,muted}>, messages:[], passwordHash|null,
//          isDefault, emptyTimer }

const DEFAULT_ROOM = 'Lounge';
const MAX_ROOMS = parseInt(process.env.DEPECHE_MAX_ROOMS || '4', 10);
const MAX_PEERS = parseInt(process.env.DEPECHE_MAX_PEERS || '6', 10);
const EMPTY_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа
const MAX_CHAT = 50;
const MAX_NAME = 32;
const MAX_ROOM = 40;
const MAX_TEXT = 500;

const rooms = new Map();    // name -> Room
const lobby = new Set();    // ws, находящиеся в лобби (не в комнате)
const clients = new Map();  // id -> ws (для «постучаться»)

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function hashPw(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}
function sanitizeName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || 'Аноним';
}
function sanitizeRoom(room) {
  return String(room ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM) || DEFAULT_ROOM;
}
function sanitizeText(text) {
  return String(text ?? '').trim().slice(0, MAX_TEXT);
}

function ensureRoom(name, isDefault, passwordHash) {
  let r = rooms.get(name);
  if (!r) {
    r = { name, peers: new Map(), messages: [], passwordHash: passwordHash || null, isDefault: !!isDefault, emptyTimer: null };
    rooms.set(name, r);
  }
  return r;
}
ensureRoom(DEFAULT_ROOM, true, null);

function roomsSummary() {
  const arr = [...rooms.values()];
  arr.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name));
  return arr.map((r) => {
    const base = { name: r.name, isDefault: r.isDefault, locked: !!r.passwordHash, full: r.peers.size >= MAX_PEERS };
    if (r.passwordHash) return base; // у комнаты с паролем участников снаружи не видно
    return { ...base, count: r.peers.size, occupants: [...r.peers.entries()].map(([id, p]) => ({ id, name: p.name })) };
  });
}
function roomsPayload() {
  return { type: 'rooms', rooms: roomsSummary(), canCreate: rooms.size < MAX_ROOMS, maxPeers: MAX_PEERS };
}
function broadcastRooms() {
  const data = JSON.stringify(roomsPayload());
  for (const ws of lobby) if (ws.readyState === ws.OPEN) ws.send(data);
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID();
    ws.room = null;
    ws.knockRoom = null;
    ws.isAlive = true;
    lobby.add(ws);
    clients.set(ws.id, ws);
    send(ws, roomsPayload());

    const onGone = () => { clients.delete(ws.id); cancelKnock(ws); lobby.delete(ws); leaveRoom(ws, false); };
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg && typeof msg.type === 'string') handle(ws, msg);
    });
    ws.on('close', onGone);
    ws.on('error', onGone);
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'list': return send(ws, roomsPayload());
    case 'create': return create(ws, msg);
    case 'join': return join(ws, msg);
    case 'leave': return leaveRoom(ws, true);
    case 'signal': return relay(ws, msg);
    case 'rename': return rename(ws, msg);
    case 'state': return updateState(ws, msg);
    case 'chat': return chat(ws, msg);
    case 'knock': return knock(ws, msg);
    case 'admit': return admitKnock(ws, msg);
    case 'decline': return declineKnock(ws, msg);
    default: /* ignore */
  }
}

// Общая часть: фактически поместить ws в комнату.
function admit(ws, room, name) {
  if (ws.room) leaveRoom(ws, false);
  if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
  lobby.delete(ws);
  ws.room = room.name;
  ws.name = sanitizeName(name);
  ws.muted = false;

  const existing = [...room.peers.entries()].map(([id, p]) => ({ id, name: p.name, muted: p.muted }));
  room.peers.set(ws.id, { ws, name: ws.name, muted: false });

  send(ws, { type: 'joined', selfId: ws.id, room: room.name, locked: !!room.passwordHash, peers: existing });
  if (room.messages.length) send(ws, { type: 'chat-history', messages: room.messages });
  for (const [id, p] of room.peers) {
    if (id !== ws.id) send(p.ws, { type: 'peer-joined', id: ws.id, name: ws.name, muted: false });
  }
  broadcastRooms();
}

function create(ws, { room, name, password }) {
  const roomName = sanitizeRoom(room);
  if (rooms.has(roomName)) return send(ws, { type: 'create-denied', reason: 'exists' });
  if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'create-denied', reason: 'limit' });
  const r = ensureRoom(roomName, false, password ? hashPw(password) : null);
  admit(ws, r, name);
}

function join(ws, { room, name, password }) {
  const roomName = sanitizeRoom(room);
  const r = rooms.get(roomName);
  if (!r) return send(ws, { type: 'join-denied', reason: 'gone', room: roomName });
  if (r.passwordHash && hashPw(String(password ?? '')) !== r.passwordHash) {
    return send(ws, { type: 'join-denied', reason: 'password', room: roomName });
  }
  if (!r.peers.has(ws.id) && r.peers.size >= MAX_PEERS) {
    return send(ws, { type: 'join-denied', reason: 'full', room: roomName });
  }
  admit(ws, r, name);
}

function relay(ws, { to, data }) {
  if (!ws.room || !to || data == null) return;
  const r = rooms.get(ws.room);
  const target = r && r.peers.get(to);
  if (target) send(target.ws, { type: 'signal', from: ws.id, data });
}

function rename(ws, { name }) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  if (!r) return;
  ws.name = sanitizeName(name);
  const me = r.peers.get(ws.id);
  if (me) me.name = ws.name;
  for (const [id, p] of r.peers) {
    if (id !== ws.id) send(p.ws, { type: 'peer-renamed', id: ws.id, name: ws.name });
  }
  broadcastRooms();
}

function updateState(ws, { muted }) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  if (!r) return;
  const me = r.peers.get(ws.id);
  if (me) me.muted = !!muted;
  for (const [id, p] of r.peers) {
    if (id !== ws.id) send(p.ws, { type: 'peer-state', id: ws.id, muted: !!muted });
  }
  // мут не влияет на лобби — не рассылаем roomsSummary (иначе спам при push-to-talk)
}

function chat(ws, { text }) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  if (!r) return;
  const clean = sanitizeText(text);
  if (!clean) return;
  const msg = { id: ws.id, name: ws.name, text: clean, ts: Date.now() };
  r.messages.push(msg);
  if (r.messages.length > MAX_CHAT) r.messages.shift();
  const payload = { type: 'chat', ...msg };
  for (const [, p] of r.peers) send(p.ws, payload);
}

// «Постучаться» в комнату: лобби-клиент просит впустить; любой участник впускает без пароля.
function knock(ws, { room, name }) {
  const roomName = sanitizeRoom(room);
  const r = rooms.get(roomName);
  if (!r) return send(ws, { type: 'knock-failed', reason: 'gone' });
  if (r.peers.size === 0) return send(ws, { type: 'knock-failed', reason: 'empty' });
  if (r.peers.size >= MAX_PEERS) return send(ws, { type: 'knock-failed', reason: 'full' });
  ws.name = sanitizeName(name);
  ws.knockRoom = roomName;
  for (const [, p] of r.peers) send(p.ws, { type: 'knock', id: ws.id, name: ws.name });
  send(ws, { type: 'knock-sent', room: roomName });
}

function admitKnock(ws, { id }) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  if (!r) return;
  const knocker = clients.get(id);
  if (!knocker || knocker.room || knocker.knockRoom !== ws.room) return;
  if (r.peers.size >= MAX_PEERS) return send(knocker, { type: 'knock-failed', reason: 'full' });
  knocker.knockRoom = null;
  for (const [pid, p] of r.peers) if (pid !== ws.id) send(p.ws, { type: 'knock-cancel', id });
  admit(knocker, r, knocker.name);
}

function declineKnock(ws, { id }) {
  if (!ws.room) return;
  const knocker = clients.get(id);
  if (knocker && knocker.knockRoom === ws.room) {
    knocker.knockRoom = null;
    send(knocker, { type: 'knock-declined' });
    const r = rooms.get(ws.room);
    if (r) for (const [pid, p] of r.peers) if (pid !== ws.id) send(p.ws, { type: 'knock-cancel', id });
  }
}

function cancelKnock(ws) {
  if (!ws.knockRoom) return;
  const r = rooms.get(ws.knockRoom);
  const kid = ws.id;
  ws.knockRoom = null;
  if (r) for (const [, p] of r.peers) send(p.ws, { type: 'knock-cancel', id: kid });
}

function leaveRoom(ws, backToLobby) {
  const roomName = ws.room;
  if (roomName) {
    ws.room = null;
    const r = rooms.get(roomName);
    if (r) {
      r.peers.delete(ws.id);
      for (const [, p] of r.peers) send(p.ws, { type: 'peer-left', id: ws.id });
      if (r.peers.size === 0 && !r.isDefault) {
        r.emptyTimer = setTimeout(() => {
          rooms.delete(roomName); // сообщения комнаты уходят вместе с ней
          broadcastRooms();
        }, EMPTY_TTL_MS);
      }
    }
    broadcastRooms();
  }
  if (backToLobby) {
    lobby.add(ws);
    send(ws, roomsPayload());
  }
}
