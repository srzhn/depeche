import { useEffect, useRef } from 'react';

// Скрытый <audio> для одного удалённого потока: громкость гостя, локальный мут,
// устройство вывода (setSinkId), повторный play при разблокировке автоплея.
export function AudioSink({ stream, volume, muted, sinkId, nonce, onBlocked }: {
  stream: MediaStream;
  volume: number;
  muted: boolean;
  sinkId: string;
  nonce: number;
  onBlocked: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.volume = Math.min(1, Math.max(0, volume));
    el.muted = muted;
    const anyEl = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && typeof anyEl.setSinkId === 'function') anyEl.setSinkId(sinkId).catch(() => {});
    el.play().catch(() => onBlocked());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, volume, muted, sinkId, nonce]);
  return <audio ref={ref} autoPlay playsInline />;
}
