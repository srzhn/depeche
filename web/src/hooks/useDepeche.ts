import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { LocalAudio, createSpeakingDetector, micErrorText } from '../lib/audio';
import { Signaling, type SignalStatus } from '../lib/signaling';
import { Mesh } from '../lib/rtc';
import { fetchIceServers } from '../lib/ice';
import { beep } from '../lib/notify';
import type { ChatMsg, IceServer, RoomSummary, ServerMessage } from '../lib/types';

export interface Participant {
  id: string;
  name: string;
  muted: boolean;
  speaking: boolean;
  self: boolean;
  stream?: MediaStream;
  connState?: RTCPeerConnectionState;
}

export interface DepecheApi {
  phase: 'lobby' | 'room';
  status: SignalStatus;
  rooms: RoomSummary[];
  canCreate: boolean;
  maxPeers: number;
  name: string;
  setName: (n: string) => void;
  participants: Participant[];
  self: Participant | null;
  currentRoom: string;
  roomLocked: boolean;
  roomPassword: string;
  messages: ChatMsg[];
  muted: boolean;
  noiseSuppression: boolean;
  pushToTalk: boolean;
  busy: boolean;
  lobbyError: string | null;
  passwordPrompt: string | null; // имя комнаты, для которой спрашиваем пароль
  notice: string | null;
  autoplayBlocked: boolean;
  playNonce: number;
  enterRoom: (room: string, password?: string) => void;
  createRoom: (room: string, password?: string) => void;
  leaveRoom: () => void;
  promptPassword: (room: string) => void;
  dismissPasswordPrompt: () => void;
  clearLobbyError: () => void;
  toggleMute: () => void;
  toggleNoise: () => Promise<void>;
  sendChat: (text: string) => void;
  enableAudio: () => void;
  onAudioBlocked: () => void;
}

type PState = Record<string, Participant>;
type PAction =
  | { type: 'clear' }
  | { type: 'remove'; id: string }
  | { type: 'upsert'; id: string; patch: Partial<Participant> };

function reducer(state: PState, action: PAction): PState {
  switch (action.type) {
    case 'clear':
      return {};
    case 'remove': {
      if (!state[action.id]) return state;
      const next = { ...state };
      delete next[action.id];
      return next;
    }
    case 'upsert': {
      const prev = state[action.id] ?? { id: action.id, name: '', muted: false, speaking: false, self: false };
      return { ...state, [action.id]: { ...prev, ...action.patch } };
    }
  }
}

export function useDepeche(): DepecheApi {
  const [phase, setPhase] = useState<'lobby' | 'room'>('lobby');
  const [status, setStatus] = useState<SignalStatus>('closed');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [canCreate, setCanCreate] = useState(true);
  const [maxPeers, setMaxPeers] = useState(6);
  const [name, setNameState] = useState(() => localStorage.getItem('depeche:name') ?? '');
  const [participants, dispatch] = useReducer(reducer, {});
  const [currentRoom, setCurrentRoom] = useState('');
  const [roomLocked, setRoomLocked] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [muted, setMutedState] = useState(false);
  const [noiseSuppression, setNoiseState] = useState(true);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playNonce, setPlayNonce] = useState(0);

  const audioRef = useRef<LocalAudio>();
  if (!audioRef.current) audioRef.current = new LocalAudio();
  const signalingRef = useRef<Signaling | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const iceRef = useRef<IceServer[] | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const detectorsRef = useRef<Map<string, () => void>>(new Map());
  const participantsRef = useRef<PState>({});
  participantsRef.current = participants;
  const nameRef = useRef(name);
  nameRef.current = name;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const noticeTimer = useRef<number | undefined>(undefined);
  const pendingPasswordRef = useRef<string>('');
  const roomPasswordRef = useRef<string>('');
  const lastJoinRef = useRef<{ room: string; password: string } | null>(null);
  const deepLinkRef = useRef<{ room: string; password: string } | null>(readDeepLink());

  // ── детекторы речи ────────────────────────────────────────────────
  const stopDetector = (id: string) => {
    const stop = detectorsRef.current.get(id);
    if (stop) { stop(); detectorsRef.current.delete(id); }
  };
  const stopAllDetectors = () => {
    for (const [, stop] of detectorsRef.current) stop();
    detectorsRef.current.clear();
  };
  const stopRemoteDetectors = () => {
    for (const [id, stop] of detectorsRef.current) if (id !== 'self') { stop(); detectorsRef.current.delete(id); }
  };
  const startLocalDetector = () => {
    const stream = audioRef.current!.stream;
    if (!stream) return;
    stopDetector('self');
    const stop = createSpeakingDetector(stream, (sp) => {
      const id = selfIdRef.current;
      if (id) dispatch({ type: 'upsert', id, patch: { speaking: sp } });
    });
    detectorsRef.current.set('self', stop);
  };
  const handlePeerStream = (peerId: string, stream: MediaStream) => {
    dispatch({ type: 'upsert', id: peerId, patch: { stream } });
    stopDetector(peerId);
    const stop = createSpeakingDetector(stream, (sp) =>
      dispatch({ type: 'upsert', id: peerId, patch: { speaking: sp } }));
    detectorsRef.current.set(peerId, stop);
  };

  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500);
  };

  // ── обработка входящих сообщений ──────────────────────────────────
  const onJoined = (m: Extract<ServerMessage, { type: 'joined' }>) => {
    selfIdRef.current = m.selfId;
    setCurrentRoom(m.room);
    setRoomLocked(m.locked);
    roomPasswordRef.current = pendingPasswordRef.current;
    lastJoinRef.current = { room: m.room, password: pendingPasswordRef.current };

    // URL для шаринга (пароль — только во фрагменте, мимо сервера)
    const url = new URL(location.href);
    url.searchParams.set('room', m.room);
    url.hash = m.locked && roomPasswordRef.current ? `k=${encodeURIComponent(roomPasswordRef.current)}` : '';
    history.replaceState(null, '', url);

    // микрофон и ICE уже получены в enterRoom/createRoom (до отправки join) —
    // поэтому здесь всё синхронно, без гонок с chat-history и ранними офферами.
    meshRef.current?.reset();
    const mesh = new Mesh({
      signaling: signalingRef.current!,
      getLocalStream: () => audioRef.current!.stream,
      iceServers: iceRef.current ?? [],
      onPeerStream: handlePeerStream,
      onPeerConnState: (id, st) => dispatch({ type: 'upsert', id, patch: { connState: st } }),
    });
    meshRef.current = mesh;
    mesh.setSelfId(m.selfId);

    stopRemoteDetectors();
    dispatch({ type: 'clear' });
    setMessages([]);
    dispatch({ type: 'upsert', id: m.selfId, patch: { id: m.selfId, name: nameRef.current, self: true, muted: audioRef.current!.muted } });
    for (const p of m.peers) {
      dispatch({ type: 'upsert', id: p.id, patch: { id: p.id, name: p.name, muted: p.muted, self: false } });
      mesh.connect(p.id);
    }
    signalingRef.current!.send({ type: 'state', muted: audioRef.current!.muted });

    phaseRef.current = 'room';
    setPhase('room');
    setBusy(false);
  };

  const handleMessage = (m: ServerMessage) => {
    const mesh = meshRef.current;
    switch (m.type) {
      case 'rooms':
        setRooms(m.rooms);
        setCanCreate(m.canCreate);
        setMaxPeers(m.maxPeers);
        break;
      case 'joined':
        onJoined(m);
        break;
      case 'peer-joined':
        if (!mesh) break;
        dispatch({ type: 'upsert', id: m.id, patch: { id: m.id, name: m.name, muted: m.muted, self: false } });
        mesh.connect(m.id);
        beep('in');
        flashNotice(`${m.name} зашёл`);
        break;
      case 'peer-left': {
        const nm = participantsRef.current[m.id]?.name || 'Кто-то';
        stopDetector(m.id);
        dispatch({ type: 'remove', id: m.id });
        mesh?.disconnect(m.id);
        beep('out');
        flashNotice(`${nm} вышел`);
        break;
      }
      case 'peer-renamed':
        dispatch({ type: 'upsert', id: m.id, patch: { name: m.name } });
        break;
      case 'peer-state':
        dispatch({ type: 'upsert', id: m.id, patch: { muted: m.muted } });
        break;
      case 'signal':
        void mesh?.handleSignal(m.from, m.data);
        break;
      case 'chat':
        setMessages((prev) => [...prev, { id: m.id, name: m.name, text: m.text, ts: m.ts }]);
        break;
      case 'chat-history':
        setMessages(m.messages);
        break;
      case 'join-denied':
        setBusy(false);
        if (m.reason === 'password') { setPasswordPrompt(m.room); setLobbyError('Неверный пароль.'); }
        else if (m.reason === 'full') setLobbyError('Комната заполнена — попробуй позже.');
        else setLobbyError('Комнаты уже нет.');
        break;
      case 'create-denied':
        setBusy(false);
        setLobbyError(m.reason === 'limit' ? 'Достигнут лимит комнат (4).' : 'Комната с таким именем уже есть.');
        break;
    }
  };

  // ── подключение сигналинга на маунте (лобби) ──────────────────────
  useEffect(() => {
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const signaling = new Signaling(`${wsProto}://${location.host}/ws`);
    signalingRef.current = signaling;
    signaling.onStatus = setStatus;
    signaling.onMessage = handleMessage;
    signaling.onOpen = () => {
      // авто-риджойн после переобрыва связи
      if (phaseRef.current === 'room' && lastJoinRef.current) {
        const { room, password } = lastJoinRef.current;
        pendingPasswordRef.current = password;
        signaling.send({ type: 'join', room, name: nameRef.current, password });
      }
    };
    signaling.connect();
    return () => { signaling.close(); signalingRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── авто-вход по ссылке-приглашению ───────────────────────────────
  useEffect(() => {
    if (status !== 'open' || phase !== 'lobby' || busy) return;
    const dl = deepLinkRef.current;
    if (dl && nameRef.current.trim()) {
      deepLinkRef.current = null;
      enterRoom(dl.room, dl.password);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, phase, name, busy]);

  // ── действия ──────────────────────────────────────────────────────
  const setName = (n: string) => {
    setNameState(n);
    localStorage.setItem('depeche:name', n.trim());
  };

  // Получаем микрофон и ICE ДО отправки join/create (чтобы onJoined был синхронным).
  const ensureReady = async (): Promise<boolean> => {
    if (!audioRef.current!.stream) {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setLobbyError('Микрофон недоступен: открой сайт по HTTPS (адрес должен начинаться с https://).');
        return false;
      }
      try { await audioRef.current!.start(); }
      catch (err) { setLobbyError(micErrorText(err)); return false; }
      startLocalDetector();
    }
    if (!iceRef.current) iceRef.current = await fetchIceServers();
    return true;
  };

  const enterRoom = async (room: string, password = '') => {
    if (!nameRef.current.trim()) { setLobbyError('Сначала введи имя.'); return; }
    setLobbyError(null);
    setPasswordPrompt(null);
    setBusy(true);
    if (!(await ensureReady())) { setBusy(false); return; }
    pendingPasswordRef.current = password;
    signalingRef.current?.send({ type: 'join', room, name: nameRef.current, password: password || undefined });
  };

  const createRoom = async (room: string, password = '') => {
    const roomName = room.trim();
    if (!roomName) { setLobbyError('Введи название комнаты.'); return; }
    if (!nameRef.current.trim()) { setLobbyError('Сначала введи имя.'); return; }
    setLobbyError(null);
    setBusy(true);
    if (!(await ensureReady())) { setBusy(false); return; }
    pendingPasswordRef.current = password;
    signalingRef.current?.send({ type: 'create', room: roomName, name: nameRef.current, password: password || undefined });
  };

  const applyMuted = (m: boolean) => {
    audioRef.current!.setMuted(m);
    setMutedState(m);
    const id = selfIdRef.current;
    if (id) dispatch({ type: 'upsert', id, patch: { muted: m } });
    signalingRef.current?.send({ type: 'state', muted: m });
  };
  const toggleMute = () => applyMuted(!audioRef.current!.muted);

  const toggleNoise = async () => {
    const on = !audioRef.current!.noiseSuppression;
    try {
      const newTrack = await audioRef.current!.setNoiseSuppression(on);
      if (newTrack) meshRef.current?.replaceAudioTrack(newTrack);
      startLocalDetector();
    } catch (err) { console.error('[noise]', err); }
    setNoiseState(on);
  };

  const sendChat = (text: string) => {
    const t = text.trim();
    if (t) signalingRef.current?.send({ type: 'chat', text: t });
  };

  const leaveRoom = () => {
    try { signalingRef.current?.send({ type: 'leave' }); } catch { /* ignore */ }
    meshRef.current?.reset();
    meshRef.current = null;
    stopAllDetectors();
    audioRef.current!.stop();
    selfIdRef.current = null;
    lastJoinRef.current = null;
    roomPasswordRef.current = '';
    dispatch({ type: 'clear' });
    setMessages([]);
    setCurrentRoom('');
    setRoomLocked(false);
    setPushToTalk(false);
    setAutoplayBlocked(false);
    setMutedState(false);
    audioRef.current!.muted = false;
    const url = new URL(location.href);
    url.searchParams.delete('room');
    url.hash = '';
    history.replaceState(null, '', url);
    phaseRef.current = 'lobby';
    setPhase('lobby');
  };

  const enableAudio = () => { setAutoplayBlocked(false); setPlayNonce((n) => n + 1); };
  const onAudioBlocked = () => setAutoplayBlocked(true);

  // ── push-to-talk (пробел) ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'room') return;
    let active = false;
    const isTyping = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'KeyM' && !isTyping(e)) { e.preventDefault(); applyMuted(!audioRef.current!.muted); return; }
      if (e.code !== 'Space' || isTyping(e)) return;
      if (!audioRef.current!.muted || active) return;
      e.preventDefault(); active = true; setPushToTalk(true); applyMuted(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !active) return;
      e.preventDefault(); active = false; setPushToTalk(false); applyMuted(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const list = useMemo(() => {
    const arr = Object.values(participants);
    arr.sort((a, b) => (a.self === b.self ? 0 : a.self ? -1 : 1));
    return arr;
  }, [participants]);
  const self = list.find((p) => p.self) ?? null;

  return {
    phase, status, rooms, canCreate, maxPeers,
    name, setName,
    participants: list, self, currentRoom, roomLocked, roomPassword: roomPasswordRef.current, messages,
    muted, noiseSuppression, pushToTalk, busy, lobbyError, passwordPrompt, notice, autoplayBlocked, playNonce,
    enterRoom, createRoom, leaveRoom,
    promptPassword: (room: string) => { setLobbyError(null); setPasswordPrompt(room); },
    dismissPasswordPrompt: () => { setPasswordPrompt(null); setLobbyError(null); },
    clearLobbyError: () => setLobbyError(null),
    toggleMute, toggleNoise, sendChat, enableAudio, onAudioBlocked,
  };
}

function readDeepLink(): { room: string; password: string } | null {
  try {
    const room = new URL(location.href).searchParams.get('room');
    if (!room) return null;
    let password = '';
    const hash = location.hash.replace(/^#/, '');
    for (const part of hash.split('&')) {
      const [k, v] = part.split('=');
      if (k === 'k') password = decodeURIComponent(v || '');
    }
    return { room, password };
  } catch {
    return null;
  }
}
