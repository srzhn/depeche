import type { SignalStatus } from '../lib/signaling';

const MAP: Record<SignalStatus, { label: string; cls: string }> = {
  connecting: { label: 'соединение…', cls: 'connecting' },
  open: { label: 'на связи', cls: 'open' },
  closed: { label: 'нет связи', cls: 'closed' },
};

export function ConnectionBadge({ status }: { status: SignalStatus }) {
  const s = MAP[status];
  return (
    <span className={`badge ${s.cls}`}>
      <span className="dot" aria-hidden="true" />
      {s.label}
    </span>
  );
}
