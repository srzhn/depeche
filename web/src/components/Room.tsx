import { useState } from 'react';
import type { DepecheApi } from '../hooks/useDepeche';
import { ParticipantTile } from './ParticipantTile';
import { ControlBar } from './ControlBar';
import { ConnectionBadge } from './ConnectionBadge';
import { AudioSink } from './AudioSink';
import { Toast } from './Toast';

export function Room({ api }: { api: DepecheApi }) {
  const [toast, setToast] = useState<string | null>(null);

  const invite = async () => {
    const link = `${location.origin}/?room=${encodeURIComponent(api.room)}`;
    try {
      await navigator.clipboard.writeText(link);
      setToast('Ссылка скопирована');
      window.setTimeout(() => setToast(null), 1600);
    } catch {
      window.prompt('Ссылка-приглашение:', link);
    }
  };

  const alone = api.participants.length <= 1;

  return (
    <main className="screen room">
      <header className="room-header">
        <div className="room-title">
          <span className="room-label">Комната</span>
          <strong className="room-name">{api.room}</strong>
        </div>
        <div className="room-actions">
          <ConnectionBadge status={api.status} />
          <button className="ghost" onClick={invite} title="Скопировать ссылку-приглашение">🔗 Пригласить</button>
        </div>
      </header>

      <ul className="tiles">
        {api.participants.map((p) => <ParticipantTile key={p.id} p={p} />)}
      </ul>

      {alone && <p className="lonely">Пока ты один. Позови друзей — кнопка «Пригласить» скопирует ссылку.</p>}

      {api.participants.filter((p) => !p.self && p.stream).map((p) => (
        <AudioSink key={p.id} stream={p.stream!} nonce={api.playNonce} onBlocked={api.onAudioBlocked} />
      ))}

      {api.autoplayBlocked && (
        <button className="enable-audio" onClick={api.enableAudio}>🔊 Нажми, чтобы включить звук</button>
      )}

      <ControlBar
        muted={api.muted}
        noise={api.noiseSuppression}
        pushToTalk={api.pushToTalk}
        onMute={api.toggleMute}
        onNoise={api.toggleNoise}
        onLeave={api.leave}
      />

      <Toast message={toast} />
    </main>
  );
}
