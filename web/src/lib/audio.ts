// Локальный микрофон: захват (с таймаутом и фолбэком), мут, переключение шумодава,
// плюс детектор речи для подсветки «кто говорит».

function raceTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new DOMException(msg, 'TimeoutError')), ms)),
  ]);
}

export class LocalAudio {
  stream: MediaStream | null = null;
  muted = false;
  noiseSuppression = true; // «шумодав» по умолчанию включён

  private constraints(): MediaTrackConstraints {
    return {
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: this.noiseSuppression,
    };
  }

  get track(): MediaStreamTrack | null {
    return this.stream ? this.stream.getAudioTracks()[0] ?? null : null;
  }

  async start(): Promise<MediaStream> {
    this.stream = await this.acquire();
    this.applyMute();
    return this.stream;
  }

  // Запрос микрофона с таймаутом (чтобы не «висло») и фолбэком на простые constraints.
  private async acquire(): Promise<MediaStream> {
    try {
      return await raceTimeout(
        navigator.mediaDevices.getUserMedia({ audio: this.constraints(), video: false }),
        12000, 'Микрофон не ответил за отведённое время');
    } catch (err) {
      console.warn('[mic] полные constraints не сработали, пробую audio:true', err);
      return await raceTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
        12000, 'Микрофон не ответил за отведённое время');
    }
  }

  private applyMute(): void {
    const t = this.track;
    if (t) t.enabled = !this.muted;
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    this.applyMute();
    return this.muted;
  }

  // Переключение шумодава: пересоздаём трек с новыми constraints и возвращаем его,
  // вызывающий заменит трек в соединениях через replaceTrack.
  async setNoiseSuppression(on: boolean): Promise<MediaStreamTrack | null> {
    this.noiseSuppression = on;
    if (!this.stream) return null;
    const fresh = await navigator.mediaDevices.getUserMedia({ audio: this.constraints(), video: false });
    const newTrack = fresh.getAudioTracks()[0];
    newTrack.enabled = !this.muted;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = fresh;
    return newTrack;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// Человекочитаемый текст ошибки доступа к микрофону.
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

// ── Детектор речи ──────────────────────────────────────────────────────────
// Один общий AudioContext на всю страницу (браузеры лимитируют их число).
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
  source.connect(analyser); // к destination НЕ подключаем — иначе эхо
  const buf = new Uint8Array(analyser.fftSize);

  let speaking = false;
  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const now = rms > threshold;
    if (now !== speaking) { speaking = now; onChange(speaking); }
  }, interval);

  return () => {
    clearInterval(timer);
    try { source.disconnect(); analyser.disconnect(); } catch { /* ignore */ }
  };
}
