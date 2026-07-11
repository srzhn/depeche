import { useEffect, useRef } from 'react';

// Скрытый <audio> для одного удалённого потока. Обновляется при смене потока
// и при nonce (кнопка «включить звук» после блокировки автоплея).
export function AudioSink({ stream, nonce, onBlocked }: {
  stream: MediaStream;
  nonce: number;
  onBlocked: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => onBlocked());
    // onBlocked намеренно не в зависимостях — иначе перезапуск каждый рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, nonce]);
  return <audio ref={ref} autoPlay playsInline />;
}
