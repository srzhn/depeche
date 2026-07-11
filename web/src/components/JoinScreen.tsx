import { useState } from 'react';

function randomRoom(): string {
  return 'room-' + Math.random().toString(36).slice(2, 7);
}

interface Props {
  onJoin: (room: string, name: string) => void;
  busy: boolean;
  error: string | null;
}

export function JoinScreen({ onJoin, busy, error }: Props) {
  const [room, setRoom] = useState(() => new URL(location.href).searchParams.get('room') ?? '');
  const [name, setName] = useState(() => localStorage.getItem('depeche:name') ?? '');
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) { setLocalErr('Введи имя'); return; }
    setLocalErr(null);
    onJoin(room, name);
  };

  return (
    <main className="screen">
      <div className="card">
        <h1 className="logo">🎙️ depeche</h1>
        <p className="subtitle">Заходи в комнату и болтай с друзьями голосом.</p>

        <label className="field">
          <span>Комната</span>
          <div className="field-row">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="например, kitchen"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="mini" title="Случайная комната" onClick={() => setRoom(randomRoom())}>🎲</button>
          </div>
        </label>

        <label className="field">
          <span>Твоё имя</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="как тебя зовут?"
            maxLength={32}
            autoComplete="off"
          />
        </label>

        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? 'Подключаюсь…' : 'Войти в комнату'}
        </button>

        {(localErr || error) && <p className="error">{localErr || error}</p>}
        <p className="hint">Понадобится доступ к микрофону. Лучше в наушниках — без эха.</p>
      </div>
    </main>
  );
}
