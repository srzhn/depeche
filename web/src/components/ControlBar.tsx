interface Props {
  muted: boolean;
  noise: boolean;
  pushToTalk: boolean;
  onMute: () => void;
  onNoise: () => void | Promise<void>;
  onLeave: () => void;
}

export function ControlBar({ muted, noise, pushToTalk, onMute, onNoise, onLeave }: Props) {
  const muteCls = ['control', 'mute', muted ? 'active' : '', pushToTalk ? 'ptt' : ''].filter(Boolean).join(' ');
  return (
    <div className="controls-wrap">
      <div className="controls">
        <button className={muteCls} onClick={onMute} aria-pressed={muted}
          title="Заглушить микрофон — клавиша M (или зажми Пробел для push-to-talk)">
          <span className="ico">{muted ? '🔇' : '🎤'}</span>
          <span className="lbl">{pushToTalk ? 'Говорю…' : muted ? 'Вкл. звук' : 'Микрофон'}</span>
        </button>
        <button className={'control noise' + (noise ? ' on' : '')} onClick={() => onNoise()} aria-pressed={noise} title="Шумоподавление">
          <span className="ico">🌿</span>
          <span className="lbl">{noise ? 'Шумодав' : 'Шумодав off'}</span>
        </button>
        <button className="control danger" onClick={onLeave} title="Выйти из комнаты">
          <span className="ico">📴</span>
          <span className="lbl">Выйти</span>
        </button>
      </div>
      <p className="ptt-hint">Зажми <kbd>пробел</kbd> — говорить, пока держишь (push-to-talk)</p>
    </div>
  );
}
