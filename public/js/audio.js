// Работа с локальным микрофоном: захват, мут, переключение шумодава,
// а также детектор речи (для подсветки «кто говорит»).

export class LocalAudio {
  constructor() {
    this.stream = null;
    this.muted = false;
    this.noiseSuppression = true; // «шумодав» по умолчанию включён
  }

  _constraints() {
    return {
      // Эхоподавление и авто-громкость держим всегда — так комфортнее и без «завязки».
      echoCancellation: true,
      autoGainControl: true,
      // Этим управляет кнопка «Шумодав».
      noiseSuppression: this.noiseSuppression,
    };
  }

  get track() {
    return this.stream ? this.stream.getAudioTracks()[0] || null : null;
  }

  async start() {
    this.stream = await this._acquire();
    this._applyMute();
    return this.stream;
  }

  // Запрашиваем микрофон с таймаутом (чтобы не «висло» молча) и запасным
  // вариантом на простые constraints, если полные не поддержаны браузером/устройством.
  async _acquire() {
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new DOMException('Микрофон не ответил за отведённое время', 'TimeoutError')), ms)),
    ]);
    try {
      console.log('[mic] getUserMedia (полные constraints)…');
      return await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: this._constraints(), video: false }), 12000);
    } catch (err) {
      console.warn('[mic] полные constraints не сработали, пробую audio:true', err && err.name, err);
      return await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }), 12000);
    }
  }

  _applyMute() {
    const t = this.track;
    if (t) t.enabled = !this.muted;
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._applyMute();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  // Меняем режим шумодава. Надёжнее всего пересоздать трек с новыми
  // constraints и вернуть его — вызывающий заменит трек в соединениях.
  async setNoiseSuppression(on) {
    this.noiseSuppression = !!on;
    if (!this.stream) return null;

    const fresh = await navigator.mediaDevices.getUserMedia({
      audio: this._constraints(),
      video: false,
    });
    const newTrack = fresh.getAudioTracks()[0];
    newTrack.enabled = !this.muted;

    // Останавливаем старые треки, переключаемся на новый поток.
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = fresh;
    return newTrack;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}

// Один общий AudioContext на всю страницу: браузеры лимитируют их число (~6),
// а участников с детекторами может быть несколько (свой + удалённые).
let sharedCtx = null;
function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedCtx) sharedCtx = new AudioCtx();
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

// Детектор речи по громкости (RMS). Возвращает функцию-остановку.
// onChange(true|false) вызывается при смене состояния «говорит/молчит».
export function createSpeakingDetector(stream, onChange, opts = {}) {
  const { threshold = 0.02, interval = 150 } = opts;
  const ctx = getAudioContext();
  if (!ctx || !stream || stream.getAudioTracks().length === 0) return () => {};

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser); // к destination НЕ подключаем — иначе будет эхо
  const buf = new Uint8Array(analyser.fftSize);

  let speaking = false;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const now = rms > threshold;
    if (now !== speaking) {
      speaking = now;
      onChange(speaking);
    }
  }, interval);

  return () => {
    clearInterval(timer);
    // Отключаем только свои узлы; общий AudioContext не закрываем — им пользуются другие.
    try { source.disconnect(); analyser.disconnect(); } catch { /* ignore */ }
  };
}
