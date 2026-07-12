import { useEffect, useState } from 'react';
import type { DepecheApi } from '../hooks/useDepeche';
import { RoomCard } from './RoomCard';
import { ConnectionBadge } from './ConnectionBadge';

export function Lobby({ api }: { api: DepecheApi }) {
  const [creating, setCreating] = useState(false);
  const [newRoom, setNewRoom] = useState('');
  const [newPass, setNewPass] = useState('');
  const [pw, setPw] = useState('');

  // при открытии диалога пароля очищаем поле
  useEffect(() => { if (api.passwordPrompt) setPw(''); }, [api.passwordPrompt]);

  const submitCreate = () => {
    if (!newRoom.trim()) return;
    api.createRoom(newRoom, newPass);
  };
  const submitPassword = () => {
    if (api.passwordPrompt) api.enterRoom(api.passwordPrompt, pw);
  };

  return (
    <main className="screen lobby">
      <header className="lobby-head">
        <h1 className="logo">🎙️ depeche</h1>
        <ConnectionBadge status={api.status} />
      </header>
      <p className="subtitle">Выбери комнату и болтай с друзьями голосом.</p>

      <label className="field name-field">
        <span>Твоё имя</span>
        <input
          value={api.name}
          onChange={(e) => api.setName(e.target.value)}
          placeholder="как тебя зовут?"
          maxLength={32}
          autoComplete="off"
        />
      </label>

      <div className="rooms-grid">
        {api.rooms.map((r) => (
          <RoomCard
            key={r.name}
            room={r}
            maxPeers={api.maxPeers}
            busy={api.busy}
            onEnter={() => (r.locked ? api.promptPassword(r.name) : api.enterRoom(r.name))}
          />
        ))}

        {api.canCreate ? (
          creating ? (
            <div className="room-card create">
              <input
                className="ci"
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); }}
                placeholder="Название комнаты"
                maxLength={40}
                autoFocus
              />
              <input
                className="ci"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); }}
                placeholder="Пароль (необязательно)"
              />
              <div className="create-actions">
                <button className="primary sm" onClick={submitCreate} disabled={api.busy}>Создать и войти</button>
                <button className="ghost sm" onClick={() => setCreating(false)}>Отмена</button>
              </div>
            </div>
          ) : (
            <button className="room-card create-btn" onClick={() => setCreating(true)}>
              <span className="plus">＋</span>
              <span>Создать комнату</span>
            </button>
          )
        ) : (
          <div className="room-card create disabled">Лимит комнат достигнут</div>
        )}
      </div>

      {api.lobbyError && !api.passwordPrompt && <p className="error center">{api.lobbyError}</p>}
      <p className="hint center">Нужен доступ к микрофону. 🔒 — вход по паролю. Пустая комната живёт 2 часа.</p>

      {api.passwordPrompt && (
        <div className="modal-backdrop" onClick={api.dismissPasswordPrompt}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Пароль для «{api.passwordPrompt}»</h3>
            <input
              type="password"
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitPassword(); }}
              placeholder="Пароль"
            />
            {api.lobbyError && <p className="error">{api.lobbyError}</p>}
            <div className="modal-actions">
              <button className="primary sm" onClick={submitPassword} disabled={api.busy}>Войти</button>
              <button className="ghost sm" onClick={api.dismissPasswordPrompt}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
