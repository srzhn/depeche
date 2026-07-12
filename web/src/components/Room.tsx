import { useState } from 'react';
import type { DepecheApi } from '../hooks/useDepeche';
import { ParticipantTile } from './ParticipantTile';
import { ControlBar } from './ControlBar';
import { ConnectionBadge } from './ConnectionBadge';
import { AudioSink } from './AudioSink';
import { Toast } from './Toast';
import { ChatPanel } from './ChatPanel';
import { Settings } from './Settings';

export function Room({ api }: { api: DepecheApi }) {
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const invite = async () => {
    const base = `${location.origin}/?room=${encodeURIComponent(api.currentRoom)}`;
    const link = api.roomLocked && api.roomPassword
      ? `${base}#k=${encodeURIComponent(api.roomPassword)}`
      : base;
    try {
      await navigator.clipboard.writeText(link);
      setToast(api.roomLocked ? 'Ссылка с паролем скопирована' : 'Ссылка скопирована');
      window.setTimeout(() => setToast(null), 1800);
    } catch {
      window.prompt('Ссылка-приглашение:', link);
    }
  };

  const alone = api.participants.length <= 1;

  return (
    <main className="screen room">
      <header className="room-header">
        <div className="room-title">
          <span className="room-label">Комната {api.roomLocked ? '🔒' : ''}</span>
          <strong className="room-name">{api.currentRoom}</strong>
        </div>
        <div className="room-actions">
          <ConnectionBadge status={api.status} />
          <button className="ghost" onClick={() => setSettingsOpen(true)} title="Настройки звука">⚙</button>
          <button className="ghost" onClick={invite} title="Скопировать ссылку-приглашение">🔗 Пригласить</button>
          <button className="ghost" onClick={api.leaveRoom} title="Выйти в лобби">← Лобби</button>
        </div>
      </header>

      <ul className="tiles">
        {api.participants.map((p) => (
          <ParticipantTile
            key={p.id}
            p={p}
            onVolume={p.self ? undefined : (v) => api.setGuestVolume(p.id, v)}
            onToggleMute={p.self ? undefined : () => api.toggleGuestMute(p.id)}
          />
        ))}
      </ul>
      {alone && (
        <p className="lonely">Пока ты один. «Пригласить» скопирует ссылку{api.roomLocked ? ' с паролем' : ''}.</p>
      )}

      <ChatPanel messages={api.messages} selfId={api.self?.id ?? null} onSend={api.sendChat} />

      {api.participants.filter((p) => !p.self && p.stream).map((p) => (
        <AudioSink
          key={p.id}
          stream={p.stream!}
          volume={p.pmuted ? 0 : p.volume}
          muted={p.pmuted}
          sinkId={api.settings.outputDeviceId}
          nonce={api.playNonce}
          onBlocked={api.onAudioBlocked}
        />
      ))}
      {api.autoplayBlocked && (
        <button className="enable-audio" onClick={api.enableAudio}>🔊 Нажми, чтобы включить звук</button>
      )}

      <ControlBar
        muted={api.muted}
        noise={api.settings.noiseSuppression}
        pushToTalk={api.pushToTalk}
        onMute={api.toggleMute}
        onNoise={() => api.setNoiseSuppression(!api.settings.noiseSuppression)}
        onLeave={api.leaveRoom}
      />

      <Toast message={toast || api.notice} />
      {settingsOpen && <Settings api={api} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
