import { useEffect, useRef, useState } from 'react';
import type { ChatMsg } from '../lib/types';

export function ChatPanel({ messages, selfId, onSend }: {
  messages: ChatMsg[];
  selfId: string | null;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="chat-empty">Сообщений пока нет. Напиши первым 👋</p>}
        {messages.map((m, i) => (
          <div key={i} className={'msg' + (m.id === selfId ? ' own' : '')}>
            {m.id !== selfId && <span className="msg-name">{m.name}</span>}
            <span className="msg-bubble">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Сообщение…"
          maxLength={500}
        />
        <button onClick={send} aria-label="Отправить">➤</button>
      </div>
    </div>
  );
}
