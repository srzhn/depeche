import type { RoomSummary } from '../lib/types';

export function RoomCard({ room, maxPeers, busy, onEnter }: {
  room: RoomSummary;
  maxPeers: number;
  busy: boolean;
  onEnter: () => void;
}) {
  const disabled = busy || room.full;
  return (
    <button className={'room-card' + (room.full ? ' full' : '')} onClick={onEnter} disabled={disabled}>
      <div className="rc-head">
        <span className="rc-name" title={room.name}>{room.name}</span>
        {room.isDefault && <span className="rc-tag">общая</span>}
        {room.locked && <span className="rc-lock" title="Приватная комната">🔒</span>}
      </div>

      {room.locked ? (
        <div className="rc-body locked">Приватная — участников не видно</div>
      ) : (
        <div className="rc-body">
          {room.occupants && room.occupants.length > 0 ? (
            <div className="rc-occ">
              {room.occupants.map((o) => <span key={o.id} className="chip">{o.name}</span>)}
            </div>
          ) : (
            <span className="rc-empty">никого нет</span>
          )}
        </div>
      )}

      <div className="rc-foot">
        <span className="rc-count">
          {room.locked ? 'по паролю' : `${room.count}/${maxPeers}${room.full ? ' · заполнено' : ''}`}
        </span>
        <span className="rc-enter">{room.full ? '' : 'Войти →'}</span>
      </div>
    </button>
  );
}
