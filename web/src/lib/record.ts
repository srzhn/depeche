// Локальная запись разговора — целиком в браузере. Микшируем локальный микрофон и
// потоки удалённых участников в один поток и пишем через MediaRecorder. Сервер ничего
// не пишет и не участвует.

function pickMime(): string {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const m of cands) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return '';
}

function download(blob: Blob, mime: string) {
  const ext = mime.includes('ogg') ? 'ogg' : 'webm';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `depeche-${ts}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export class Recorder {
  recording = false;
  private ctx: AudioContext | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = '';

  // Поддерживается ли запись в этом браузере.
  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  start(localStream: MediaStream | null, remoteStreams: MediaStream[]): boolean {
    if (this.recording || !Recorder.supported()) return false;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    this.ctx = new Ctor();
    const mix = this.ctx.createMediaStreamDestination();
    const add = (s: MediaStream | null) => {
      if (!s || s.getAudioTracks().length === 0) return;
      try { this.ctx!.createMediaStreamSource(s).connect(mix); } catch { /* ignore */ }
    };
    add(localStream);
    remoteStreams.forEach(add);

    this.mime = pickMime();
    try {
      this.rec = this.mime ? new MediaRecorder(mix.stream, { mimeType: this.mime }) : new MediaRecorder(mix.stream);
    } catch {
      this.cleanup();
      return false;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => {
      const type = this.rec?.mimeType || this.mime || 'audio/webm';
      if (this.chunks.length) download(new Blob(this.chunks, { type }), type);
      this.cleanup();
    };
    this.rec.start();
    this.recording = true;
    return true;
  }

  stop(): void {
    if (this.rec && this.recording) {
      try { this.rec.stop(); } catch { /* ignore */ }
    }
    this.recording = false;
  }

  private cleanup(): void {
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.rec = null;
    this.chunks = [];
  }
}
