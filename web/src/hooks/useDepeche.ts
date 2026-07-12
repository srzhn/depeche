import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { LocalAudio, createSpeakingDetector, micErrorText, listDevices, type AudioSettings, type VoiceEffect } from '../lib/audio';
import { Recorder } from '../lib/record';
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
  volume: number;   // громкость гостя 0..1 (на приёме)
  pmuted: boolean;  // локально заглушён
}

export interface DeviceList {
  mics: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
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
  pushToTalk: boolean;
  busy: boolean;
  lobbyError: string | null;
  passwordPrompt: string | null;
  notice: string | null;
  autoplayBlocked: boolean;
  playNonce: number;
  settings: AudioSettings;
  devices: DeviceList;
  enterRoom: (room: string, password?: string) => void;
  createRoom: (room: string, password?: string) => void;
  leaveRoom: () => void;
  promptPassword: (room: string) => void;
  dismissPasswordPrompt: () => void;
  clearLobbyError: () => void;
  toggleMute: () => void;
  sendChat: (text: string) => void;
  enableAudio: () => void;
  onAudioBlocked: () => void;
  refreshDevices: () => void;
  setMicGain: (v: number) => void;
  setGate: (enabled: boolean, threshold?: number) => void;
  setMonitor: (on: boolean) => void;
  setMicDevice: (id: string) => void;
  setOutputDevice: (id: string) => void;
  setEchoCancellation: (on: boolean) => void;
  setNoiseSuppression: (on: boolean) => void;
  setAutoGainControl: (on: boolean) => void;
  setRnnoise: (on: boolean) => void;
  setGuestVolume: (id: string, v: number) => void;
  toggleGuestMute: (id: string) => void;
  setEq: (low: number, mid: number, high: number) => void;
  setCompressor: (on: boolean) => void;
  setEffect: (e: VoiceEffect) => void;
  recording: boolean;
  recordSupported: boolean;
  toggleRecording: () => void;
}

type PState = Record<string, Participant>;
type PAction =
  | { type: 'clear' }
  | { type: 'remove'; id: string }
  | { type: 'upsert'; id: string; patch: Partial<Participant> };

function baseParticipant(id: string): Participant {
  return { id, name: '', muted: false, speaking: false, self: false, volume: 1, pmuted: false };
}
function reducer(state: PState, action: PAction): PState {
  switch (action.type) {
    case 'clear': return {};
    case 'remove': {
      if (!state[action.id]) return state;
      const next = { ...state }; delete next[action.id]; return next;
    }
    case 'upsert': {
      const prev = state[action.id] ?? baseParticipant(action.id);
      return { ...state, [action.id]: { ...prev, ...action.patch } };
    }
  }
}

function loadGuestVols(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem('depeche:guestVol') || '{}'); } catch { return {}; }
}
function saveGuestVol(name: string, v: number) {
  const m = loadGuestVols(); m[name] = v;
  try { localStorage.setItem('depeche:guestVol', JSON.stringify(m)); } catch { /* ignore */ }
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
  const [pushToTalk, setPushToTalk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playNonce, setPlayNonce] = useState(0);
  const [devices, setDevices] = useState<DeviceList>({ mics: [], outputs: [] });

  const audioRef = useRef<LocalAudio>();
  if (!audioRef.current) audioRef.current = new LocalAudio();
  const recorderRef = useRef<Recorder>();
  if (!recorderRef.current) recorderRef.current = new Recorder();
  const [recording, setRecording] = useState(false);
  const [settings, setSettings] = useState<AudioSettings>(() => audioRef.current!.settings);
  const syncSettings = () => setSettings({ ...audioRef.current!.settings });

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

  // локальный индикатор речи считает сам движок
  audioRef.current.onSpeaking = (sp) => {
    const id = selfIdRef.current;
    if (id) dispatch({ type: 'upsert', id, patch: { speaking: sp } });
  };

  // ── детекторы речи удалённых участников ───────────────────────────
  const stopDetector = (id: string) => {
    const stop = detectorsRef.current.get(id);
    if (stop) { stop(); detectorsRef.current.delete(id); }
  };
  const stopAllDetectors = () => {
    for (const [, stop] of detectorsRef.current) stop();
    detectorsRef.current.clear();
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

  const addParticipant = (id: string, pname: string, pmutedRemote: boolean, self: boolean) => {
    const vol = self ? 1 : (loadGuestVols()[pname] ?? 1);
    dispatch({ type: 'upsert', id, patch: { id, name: pname, muted: pmutedRemote, self, volume: vol } });
  };

  const onJoined = (m: Extract<ServerMessage, { type: 'joined' }>) => {
    selfIdRef.current = m.selfId;
    setCurrentRoom(m.room);
    setRoomLocked(m.locked);
    roomPasswordRef.current = pendingPasswordRef.current;
    lastJoinRef.current = { room: m.room, password: pendingPasswordRef.current };

    const url = new URL(location.href);
    url.searchParams.set('room', m.room);
    url.hash = m.locked && roomPasswordRef.current ? `k=${encodeURIComponent(roomPasswordRef.current)}` : '';
    history.replaceState(null, '', url);

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

    for (const [id, stop] of detectorsRef.current) { stop(); detectorsRef.current.delete(id); }
    dispatch({ type: 'clear' });
    setMessages([]);
    addParticipant(m.selfId, nameRef.current, audioRef.current!.muted, true);
    for (const p of m.peers) { addParticipant(p.id, p.name, p.muted, false); mesh.connect(p.id); }
    signalingRef.current!.send({ type: 'state', muted: audioRef.current!.muted });

    phaseRef.current = 'room';
    setPhase('room');
    setBusy(false);
    refreshDevices();
  };

  const handleMessage = (m: ServerMessage) => {
    const mesh = meshRef.current;
    switch (m.type) {
      case 'rooms':
        setRooms(m.rooms); setCanCreate(m.canCreate); setMaxPeers(m.maxPeers);
        break;
      case 'joined':
        onJoined(m);
        break;
      case 'peer-joined':
        if (!mesh) break;
        addParticipant(m.id, m.name, m.muted, false);
        mesh.connect(m.id);
        beep('in'); flashNotice(`${m.name} зашёл`);
        break;
      case 'peer-left': {
        const nm = participantsRef.current[m.id]?.name || 'Кто-то';
        stopDetector(m.id);
        dispatch({ type: 'remove', id: m.id });
        mesh?.disconnect(m.id);
        beep('out'); flashNotice(`${nm} вышел`);
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

  // ── подключение сигналинга на маунте ──────────────────────────────
  useEffect(() => {
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const signaling = new Signaling(`${wsProto}://${location.host}/ws`);
    signalingRef.current = signaling;
    signaling.onStatus = setStatus;
    signaling.onMessage = handleMessage;
    signaling.onOpen = () => {
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
  const setName = (n: string) => { setNameState(n); localStorage.setItem('depeche:name', n.trim()); };

  const refreshDevices = () => { void listDevices().then(setDevices); };

  const ensureReady = async (): Promise<boolean> => {
    if (!audioRef.current!.stream) {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setLobbyError('Микрофон недоступен: открой сайт по HTTPS (адрес должен начинаться с https://).');
        return false;
      }
      try { await audioRef.current!.start(); }
      catch (err) { setLobbyError(micErrorText(err)); return false; }
    }
    if (!iceRef.current) iceRef.current = await fetchIceServers();
    return true;
  };

  const enterRoom = async (room: string, password = '') => {
    if (!nameRef.current.trim()) { setLobbyError('Сначала введи имя.'); return; }
    setLobbyError(null); setPasswordPrompt(null); setBusy(true);
    if (!(await ensureReady())) { setBusy(false); return; }
    pendingPasswordRef.current = password;
    signalingRef.current?.send({ type: 'join', room, name: nameRef.current, password: password || undefined });
  };

  const createRoom = async (room: string, password = '') => {
    const roomName = room.trim();
    if (!roomName) { setLobbyError('Введи название комнаты.'); return; }
    if (!nameRef.current.trim()) { setLobbyError('Сначала введи имя.'); return; }
    setLobbyError(null); setBusy(true);
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

  const sendChat = (text: string) => {
    const t = text.trim();
    if (t) signalingRef.current?.send({ type: 'chat', text: t });
  };

  const leaveRoom = () => {
    recorderRef.current?.stop();
    setRecording(false);
    try { signalingRef.current?.send({ type: 'leave' }); } catch { /* ignore */ }
    meshRef.current?.reset(); meshRef.current = null;
    stopAllDetectors();
    audioRef.current!.stop();
    selfIdRef.current = null;
    lastJoinRef.current = null;
    roomPasswordRef.current = '';
    dispatch({ type: 'clear' });
    setMessages([]);
    setCurrentRoom(''); setRoomLocked(false);
    setPushToTalk(false); setAutoplayBlocked(false);
    setMutedState(false); audioRef.current!.muted = false;
    const url = new URL(location.href);
    url.searchParams.delete('room'); url.hash = '';
    history.replaceState(null, '', url);
    phaseRef.current = 'lobby'; setPhase('lobby');
  };

  const enableAudio = () => { setAutoplayBlocked(false); setPlayNonce((n) => n + 1); };
  const onAudioBlocked = () => setAutoplayBlocked(true);

  // настройки звука
  const setMicGain = (v: number) => { audioRef.current!.setMicGain(v); syncSettings(); };
  const setGate = (enabled: boolean, threshold?: number) => { audioRef.current!.setGate(enabled, threshold); syncSettings(); };
  const setMonitor = (on: boolean) => { audioRef.current!.setMonitor(on); syncSettings(); };
  const setMicDevice = (id: string) => { void audioRef.current!.setMicDevice(id).then(syncSettings); };
  const setOutputDevice = (id: string) => { audioRef.current!.setOutputDevice(id); syncSettings(); setPlayNonce((n) => n + 1); };
  const setEchoCancellation = (on: boolean) => { void audioRef.current!.setEchoCancellation(on).then(syncSettings); };
  const setNoiseSuppression = (on: boolean) => { void audioRef.current!.setNoiseSuppression(on).then(syncSettings); };
  const setAutoGainControl = (on: boolean) => { void audioRef.current!.setAutoGainControl(on).then(syncSettings); };
  const setRnnoise = (on: boolean) => { void audioRef.current!.setRnnoise(on).then(syncSettings); };
  const setEq = (low: number, mid: number, high: number) => { audioRef.current!.setEq(low, mid, high); syncSettings(); };
  const setCompressor = (on: boolean) => { audioRef.current!.setCompressor(on); syncSettings(); };
  const setEffect = (e: VoiceEffect) => { audioRef.current!.setEffect(e); syncSettings(); };
  const toggleRecording = () => {
    const r = recorderRef.current!;
    if (r.recording) { r.stop(); setRecording(false); return; }
    const remotes = Object.values(participantsRef.current).filter((p) => !p.self && p.stream).map((p) => p.stream!);
    const ok = r.start(audioRef.current!.stream, remotes);
    setRecording(ok);
  };

  const setGuestVolume = (id: string, v: number) => {
    dispatch({ type: 'upsert', id, patch: { volume: v, pmuted: v <= 0 } });
    const nm = participantsRef.current[id]?.name;
    if (nm) saveGuestVol(nm, v);
  };
  const toggleGuestMute = (id: string) => {
    const cur = participantsRef.current[id]?.pmuted ?? false;
    dispatch({ type: 'upsert', id, patch: { pmuted: !cur } });
  };

  // ── горячие клавиши: M — мут, Space — push-to-talk ────────────────
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
    muted, pushToTalk, busy, lobbyError, passwordPrompt, notice, autoplayBlocked, playNonce,
    settings, devices,
    enterRoom, createRoom, leaveRoom,
    promptPassword: (room: string) => { setLobbyError(null); setPasswordPrompt(room); },
    dismissPasswordPrompt: () => { setPasswordPrompt(null); setLobbyError(null); },
    clearLobbyError: () => setLobbyError(null),
    toggleMute, sendChat, enableAudio, onAudioBlocked, refreshDevices,
    setMicGain, setGate, setMonitor, setMicDevice, setOutputDevice,
    setEchoCancellation, setNoiseSuppression, setAutoGainControl, setRnnoise,
    setGuestVolume, toggleGuestMute,
    setEq, setCompressor, setEffect,
    recording, recordSupported: Recorder.supported(), toggleRecording,
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
