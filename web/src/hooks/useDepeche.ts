import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { LocalAudio, createSpeakingDetector, micErrorText } from '../lib/audio';
import { Signaling, type SignalStatus } from '../lib/signaling';
import { Mesh } from '../lib/rtc';
import { fetchIceServers } from '../lib/ice';
import type { ServerMessage } from '../lib/types';

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
  phase: 'join' | 'room';
  status: SignalStatus;
  participants: Participant[];
  self: Participant | null;
  room: string;
  muted: boolean;
  noiseSuppression: boolean;
  pushToTalk: boolean;
  micError: string | null;
  autoplayBlocked: boolean;
  busy: boolean;
  playNonce: number;
  join: (room: string, name: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleNoise: () => Promise<void>;
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
  const [phase, setPhase] = useState<'join' | 'room'>('join');
  const [status, setStatus] = useState<SignalStatus>('closed');
  const [participants, dispatch] = useReducer(reducer, {});
  const [muted, setMutedState] = useState(false);
  const [noiseSuppression, setNoiseState] = useState(true);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState('');
  const [playNonce, setPlayNonce] = useState(0);

  const audioRef = useRef<LocalAudio>();
  if (!audioRef.current) audioRef.current = new LocalAudio();
  const signalingRef = useRef<Signaling | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const nameRef = useRef('');
  const detectorsRef = useRef<Map<string, () => void>>(new Map());

  // ── детекторы речи ────────────────────────────────────────────────
  const stopDetector = (id: string) => {
    const stop = detectorsRef.current.get(id);
    if (stop) { stop(); detectorsRef.current.delete(id); }
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

  const handleMessage = (m: ServerMessage) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    switch (m.type) {
      case 'joined': {
        selfIdRef.current = m.selfId;
        mesh.setSelfId(m.selfId);
        mesh.reset();
        // сбрасываем удалённые детекторы (локальный оставляем)
        for (const [id, stop] of detectorsRef.current) {
          if (id !== 'self') { stop(); detectorsRef.current.delete(id); }
        }
        dispatch({ type: 'clear' });
        dispatch({ type: 'upsert', id: m.selfId, patch: { id: m.selfId, name: nameRef.current, self: true, muted: audioRef.current!.muted } });
        for (const p of m.peers) {
          dispatch({ type: 'upsert', id: p.id, patch: { id: p.id, name: p.name, muted: p.muted, self: false } });
          mesh.connect(p.id);
        }
        break;
      }
      case 'peer-joined':
        dispatch({ type: 'upsert', id: m.id, patch: { id: m.id, name: m.name, muted: m.muted, self: false } });
        mesh.connect(m.id);
        break;
      case 'peer-left':
        stopDetector(m.id);
        dispatch({ type: 'remove', id: m.id });
        mesh.disconnect(m.id);
        break;
      case 'peer-renamed':
        dispatch({ type: 'upsert', id: m.id, patch: { name: m.name } });
        break;
      case 'peer-state':
        dispatch({ type: 'upsert', id: m.id, patch: { muted: m.muted } });
        break;
      case 'signal':
        void mesh.handleSignal(m.from, m.data);
        break;
    }
  };

  // ── действия ──────────────────────────────────────────────────────
  const applyMuted = (m: boolean) => {
    audioRef.current!.setMuted(m);
    setMutedState(m);
    const id = selfIdRef.current;
    if (id) dispatch({ type: 'upsert', id, patch: { muted: m } });
    signalingRef.current?.send({ type: 'state', muted: m });
  };

  const join = async (roomArg: string, nameArg: string) => {
    const roomName = roomArg.trim() || 'lobby';
    const name = nameArg.trim() || 'Аноним';
    setBusy(true);
    setMicError(null);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setBusy(false);
      setMicError('Микрофон недоступен: открой сайт по HTTPS (адрес должен начинаться с https://), а не по http или по голому IP.');
      return;
    }
    try {
      await audioRef.current!.start();
    } catch (err) {
      console.error('[mic]', err);
      setBusy(false);
      setMicError(micErrorText(err));
      return;
    }
    startLocalDetector();

    const iceServers = await fetchIceServers();

    nameRef.current = name;
    setRoom(roomName);
    localStorage.setItem('depeche:name', name);
    const url = new URL(location.href);
    url.searchParams.set('room', roomName);
    history.replaceState(null, '', url);

    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const signaling = new Signaling(`${wsProto}://${location.host}/ws`);
    signalingRef.current = signaling;
    const mesh = new Mesh({
      signaling,
      getLocalStream: () => audioRef.current!.stream,
      iceServers,
      onPeerStream: handlePeerStream,
      onPeerConnState: (id, st) => dispatch({ type: 'upsert', id, patch: { connState: st } }),
    });
    meshRef.current = mesh;

    signaling.onStatus = setStatus;
    signaling.onOpen = () => {
      signaling.send({ type: 'join', room: roomName, name });
      signaling.send({ type: 'state', muted: audioRef.current!.muted });
    };
    signaling.onMessage = handleMessage;
    signaling.connect();

    setPhase('room');
    setBusy(false);
  };

  const leave = () => {
    try { signalingRef.current?.send({ type: 'leave' }); } catch { /* ignore */ }
    signalingRef.current?.close();
    signalingRef.current = null;
    meshRef.current?.reset();
    meshRef.current = null;
    stopAllDetectors();
    audioRef.current!.stop();
    selfIdRef.current = null;
    dispatch({ type: 'clear' });
    setPhase('join');
    setStatus('closed');
    setPushToTalk(false);
    setAutoplayBlocked(false);
    // сбрасываем мут, шумодав оставляем как выбрал пользователь
    setMutedState(false);
    audioRef.current!.muted = false;
  };

  const toggleMute = () => applyMuted(!audioRef.current!.muted);

  const toggleNoise = async () => {
    const on = !audioRef.current!.noiseSuppression;
    try {
      const newTrack = await audioRef.current!.setNoiseSuppression(on);
      if (newTrack) meshRef.current?.replaceAudioTrack(newTrack);
      startLocalDetector();
    } catch (err) {
      console.error('[noise]', err);
    }
    setNoiseState(on);
  };

  const enableAudio = () => { setAutoplayBlocked(false); setPlayNonce((n) => n + 1); };
  const onAudioBlocked = () => setAutoplayBlocked(true);

  // ── push-to-talk: зажатый пробел временно включает микрофон ───────
  useEffect(() => {
    if (phase !== 'room') return;
    let active = false;
    const isTyping = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e)) return;
      if (!audioRef.current!.muted || active) return;
      e.preventDefault();
      active = true;
      setPushToTalk(true);
      applyMuted(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !active) return;
      e.preventDefault();
      active = false;
      setPushToTalk(false);
      applyMuted(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Аккуратно уходим при закрытии вкладки.
  useEffect(() => {
    const onUnload = () => { try { signalingRef.current?.send({ type: 'leave' }); } catch { /* ignore */ } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const list = useMemo(() => {
    const arr = Object.values(participants);
    arr.sort((a, b) => (a.self === b.self ? 0 : a.self ? -1 : 1));
    return arr;
  }, [participants]);

  const self = list.find((p) => p.self) ?? null;

  return {
    phase, status, participants: list, self, room,
    muted, noiseSuppression, pushToTalk, micError, autoplayBlocked, busy, playNonce,
    join, leave, toggleMute, toggleNoise, enableAudio, onAudioBlocked,
  };
}
