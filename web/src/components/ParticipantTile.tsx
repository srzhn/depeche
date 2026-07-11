import type { Participant } from '../hooks/useDepeche';

function initial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function ParticipantTile({ p }: { p: Participant }) {
  const speaking = p.speaking && !p.muted;
  const cls = ['tile', speaking ? 'speaking' : '', p.muted ? 'muted' : ''].filter(Boolean).join(' ');
  return (
    <li className={cls}>
      <div className="avatar">
        <span className="avatar-letter">{initial(p.name)}</span>
        <span className="ring" aria-hidden="true" />
      </div>
      <div className="tile-name" title={p.name}>
        {p.name}{p.self && <span className="you"> (ты)</span>}
      </div>
      <div className="tile-state">{p.muted ? '🔇' : '🎤'}</div>
    </li>
  );
}
