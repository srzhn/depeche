// Аудио-движок: локальный микрофон проходит через граф Web Audio
//   source → EQ(low/mid/high) → compressor → эффект(waveshaper) → gain → gate → mute
//            → { исходящий трек (dest), монитор }
// Исходящий трек берётся из MediaStreamDestination и СТАБИЛЕН: все правки (громкость,
// эквалайзер, компрессор, эффект, гейт, мут, смена устройства/режима) меняют граф без
// replaceTrack в mesh.

import { createRnnoiseNode } from './rnnoise';

export type VoiceEffect = 'none' | 'soft' | 'hard' | 'megaphone';

export interface AudioSettings {
  micDeviceId: string;
  outputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  micGain: number;            // 0..2
  gateEnabled: boolean;
  gateThreshold: number;      // 0..0.2
  monitor: boolean;
  eqLow: number;              // dB -12..12
  eqMid: number;
  eqHigh: number;
  compressor: boolean;
  effect: VoiceEffect;
  rnnoise: boolean;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  micDeviceId: '',
  outputDeviceId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  micGain: 1,
  gateEnabled: false,
  gateThreshold: 0.02,
  monitor: false,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compressor: false,
  effect: 'none',
  rnnoise: false,
};

const LS_KEY = 'depeche:audio';

export function loadSettings(): AudioSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s: AudioSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function raceTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new DOMException(msg, 'TimeoutError')), ms)),
  ]);
}

// Классическая кривая дисторшна для WaveShaper.
function distortionCurve(k: number): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
function effectCurve(effect: VoiceEffect): Float32Array | null {
  switch (effect) {
    case 'soft': return distortionCurve(6);
    case 'hard': return distortionCurve(40);
    case 'megaphone': return distortionCurve(120);
    default: return null;
  }
}

export class LocalAudio {
  settings: AudioSettings;
  muted = false;
  onSpeaking?: (speaking: boolean) => void;

  private ctx: AudioContext | null = null;
  private raw: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rnnoiseNode: AudioNode | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private gain: GainNode | null = null;
  private gate: GainNode | null = null;
  private muteGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private buf: Uint8Array = new Uint8Array(0);
  private rafId = 0;
  private speaking = false;

  constructor(settings?: Partial<AudioSettings>) {
    this.settings = { ...loadSettings(), ...settings };
  }

  get stream(): MediaStream | null { return this.dest ? this.dest.stream : null; }
  get track(): MediaStreamTrack | null { return this.dest ? this.dest.stream.getAudioTracks()[0] ?? null : null; }

  private micConstraints(): MediaStreamConstraints {
    const s = this.settings;
    const audio: MediaTrackConstraints = {
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
    };
    if (s.micDeviceId) audio.deviceId = { exact: s.micDeviceId };
    return { audio, video: false };
  }

  async start(): Promise<MediaStream> {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

    this.eqLow = ctx.createBiquadFilter();
    this.eqMid = ctx.createBiquadFilter();
    this.eqHigh = ctx.createBiquadFilter();
    this.comp = ctx.createDynamicsCompressor();
    this.shaper = ctx.createWaveShaper();
    this.gain = ctx.createGain();
    this.gate = ctx.createGain();
    this.muteGain = ctx.createGain();
    this.monitorGain = ctx.createGain();
    this.dest = ctx.createMediaStreamDestination();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Uint8Array(this.analyser.fftSize);

    // фиксированная цепочка (всё нейтрализуется настройками)
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.comp);
    this.comp.connect(this.shaper);
    this.shaper.connect(this.gain);
    this.gain.connect(this.gate);
    this.gate.connect(this.muteGain);
    this.muteGain.connect(this.dest);
    this.muteGain.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);

    this.applyEq();
    this.applyCompressor();
    this.applyEffect();
    this.gain.gain.value = this.settings.micGain;
    this.gate.gain.value = 1;
    this.muteGain.gain.value = this.muted ? 0 : 1;
    this.monitorGain.gain.value = this.settings.monitor ? 1 : 0;

    await this.acquireRaw();
    this.startLoop();
    return this.dest.stream;
  }

  private async acquireRaw(): Promise<void> {
    if (!this.ctx) return;
    let stream: MediaStream;
    try {
      stream = await raceTimeout(navigator.mediaDevices.getUserMedia(this.micConstraints()), 12000, 'Микрофон не ответил');
    } catch (err) {
      console.warn('[mic] constraints не сработали, пробую audio:true', err);
      stream = await raceTimeout(navigator.mediaDevices.getUserMedia({ audio: true, video: false }), 12000, 'Микрофон не ответил');
    }
    if (this.source) { try { this.source.disconnect(); } catch { /* ignore */ } }
    if (this.raw) this.raw.getTracks().forEach((t) => t.stop());
    this.raw = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    await this.wireSource();
  }

  // source → [RNNoise] → eqLow, плюс отвод в analyser (для гейта и индикатора речи).
  private async wireSource(): Promise<void> {
    if (!this.source || !this.ctx || !this.eqLow) return;
    try { this.source.disconnect(); } catch { /* ignore */ }
    this.source.connect(this.analyser!);
    if (this.settings.rnnoise) {
      try {
        if (!this.rnnoiseNode) this.rnnoiseNode = await createRnnoiseNode(this.ctx);
        this.source.connect(this.rnnoiseNode);
        this.rnnoiseNode.connect(this.eqLow);
        return;
      } catch (err) {
        console.error('[rnnoise] не удалось загрузить, откатываю на обычный звук', err);
        this.settings.rnnoise = false;
        this.persist();
      }
    }
    if (this.rnnoiseNode) { try { this.rnnoiseNode.disconnect(); } catch { /* ignore */ } }
    this.source.connect(this.eqLow);
  }

  async setRnnoise(on: boolean): Promise<void> {
    this.settings.rnnoise = on;
    this.persist();
    if (this.ctx && this.source) await this.wireSource();
  }

  private applyEq(): void {
    if (!this.eqLow || !this.eqMid || !this.eqHigh) return;
    this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 220; this.eqLow.gain.value = this.settings.eqLow;
    this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1200; this.eqMid.Q.value = 1; this.eqMid.gain.value = this.settings.eqMid;
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 3500; this.eqHigh.gain.value = this.settings.eqHigh;
  }
  private applyCompressor(): void {
    if (!this.comp) return;
    const c = this.comp;
    if (this.settings.compressor) {
      c.threshold.value = -24; c.knee.value = 30; c.ratio.value = 4; c.attack.value = 0.003; c.release.value = 0.25;
    } else {
      c.threshold.value = 0; c.knee.value = 0; c.ratio.value = 1; c.attack.value = 0.003; c.release.value = 0.25;
    }
  }
  private applyEffect(): void {
    if (this.shaper) { this.shaper.curve = effectCurve(this.settings.effect); this.shaper.oversample = '2x'; }
  }

  private startLoop(): void {
    const tick = () => {
      if (!this.analyser || !this.ctx) return;
      this.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / this.buf.length);
      const now = this.ctx.currentTime;
      const open = !this.settings.gateEnabled || rms > this.settings.gateThreshold;
      this.gate!.gain.setTargetAtTime(open ? 1 : 0, now, open ? 0.01 : 0.06);
      const sp = !this.muted && open && rms > Math.max(0.02, this.settings.gateThreshold * 0.8);
      if (sp !== this.speaking) { this.speaking = sp; this.onSpeaking?.(sp); }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  setMuted(m: boolean): boolean {
    this.muted = m;
    if (this.muteGain && this.ctx) this.muteGain.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.01);
    if (m && this.speaking) { this.speaking = false; this.onSpeaking?.(false); }
    return m;
  }
  setMicGain(v: number): void {
    this.settings.micGain = v;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    this.persist();
  }
  setGate(enabled: boolean, threshold?: number): void {
    this.settings.gateEnabled = enabled;
    if (threshold != null) this.settings.gateThreshold = threshold;
    this.persist();
  }
  setMonitor(on: boolean): void {
    this.settings.monitor = on;
    if (this.monitorGain && this.ctx) this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    this.persist();
  }
  setEq(low: number, mid: number, high: number): void {
    this.settings.eqLow = low; this.settings.eqMid = mid; this.settings.eqHigh = high;
    this.applyEq(); this.persist();
  }
  setCompressor(on: boolean): void {
    this.settings.compressor = on; this.applyCompressor(); this.persist();
  }
  setEffect(effect: VoiceEffect): void {
    this.settings.effect = effect; this.applyEffect(); this.persist();
  }
  async setMicDevice(id: string): Promise<void> {
    this.settings.micDeviceId = id; this.persist();
    if (this.ctx) await this.acquireRaw();
  }
  async setEchoCancellation(on: boolean): Promise<void> {
    this.settings.echoCancellation = on; this.persist();
    if (this.ctx) await this.acquireRaw();
  }
  async setNoiseSuppression(on: boolean): Promise<void> {
    this.settings.noiseSuppression = on; this.persist();
    if (this.ctx) await this.acquireRaw();
  }
  async setAutoGainControl(on: boolean): Promise<void> {
    this.settings.autoGainControl = on; this.persist();
    if (this.ctx) await this.acquireRaw();
  }
  setOutputDevice(id: string): void {
    this.settings.outputDeviceId = id; this.persist();
  }

  private persist() { saveSettings(this.settings); }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.raw) this.raw.getTracks().forEach((t) => t.stop());
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.raw = null; this.source = null; this.rnnoiseNode = null; this.speaking = false;
  }
}

export function micErrorText(err: unknown): string {
  const name = (err as { name?: string })?.name;
  switch (name) {
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
      return 'Не удалось получить микрофон: ' + (name || (err as { message?: string })?.message || 'неизвестная ошибка') + '.';
  }
}

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

export function createSpeakingDetector(
  stream: MediaStream,
  onChange: (speaking: boolean) => void,
  opts: { threshold?: number; interval?: number } = {},
): () => void {
  const { threshold = 0.02, interval = 150 } = opts;
  const ctx = getAudioContext();
  if (!ctx || stream.getAudioTracks().length === 0) return () => {};
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let speaking = false;
  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    const now = rms > threshold;
    if (now !== speaking) { speaking = now; onChange(speaking); }
  }, interval);
  return () => {
    clearInterval(timer);
    try { source.disconnect(); analyser.disconnect(); } catch { /* ignore */ }
  };
}

export async function listDevices(): Promise<{ mics: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: all.filter((d) => d.kind === 'audioinput'),
      outputs: all.filter((d) => d.kind === 'audiooutput'),
    };
  } catch {
    return { mics: [], outputs: [] };
  }
}
