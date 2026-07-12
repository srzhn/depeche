// Короткий звуковой сигнал входа/выхода участника (генерим осциллятором, без файлов).
let ctx: AudioContext | null = null;

function actx(): AudioContext | null {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function beep(kind: 'in' | 'out'): void {
  const ac = actx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ac.destination);
  const now = ac.currentTime;
  const [f1, f2] = kind === 'in' ? [520, 820] : [500, 300];
  osc.frequency.setValueAtTime(f1, now);
  osc.frequency.exponentialRampToValueAtTime(f2, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.start(now);
  osc.stop(now + 0.24);
}
