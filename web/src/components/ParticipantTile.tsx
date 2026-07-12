import type { Participant } from '../hooks/useDepeche';

function initial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function ParticipantTile({ p, onVolume, onToggleMute }: {
  p: Participant;
  onVolume?: (v: number) => void;
  onToggleMute?: () => void;
}) {
  const speaking = p.speaking && !p.muted && !p.pmuted;
  const cls = ['tile', speaking ? 'speaking' : '', (p.muted || p.pmuted) ? 'muted' : ''].filter(Boolean).join(' ');
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

      {!p.self && onVolume && (
        <div className="tile-vol">
          <button className="vmute" onClick={onToggleMute} title={p.pmuted ? 'Включить звук гостя' : 'Заглушить у себя'}>
            {p.pmuted ? '🔇' : '🔊'}
          </button>
          <input
            type="range" min={0} max={1} step={0.05}
            value={p.pmuted ? 0 : p.volume}
            onChange={(e) => onVolume(parseFloat(e.target.value))}
            title="Насколько громко слышно гостя"
          />
        </div>
      )}
    </li>
  );
}
