import type { ClientMessage, ServerMessage } from './types';

export type SignalStatus = 'connecting' | 'open' | 'closed';

// WebSocket-клиент сигналинга с авто-реконнектом и очередью исходящих сообщений.
export class Signaling {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private queue: string[] = [];
  private reconnectDelay = 1000;

  onOpen?: () => void;
  onMessage?: (msg: ServerMessage) => void;
  onStatus?: (status: SignalStatus) => void;

  constructor(private url: string) {}

  connect(): void {
    this.onStatus?.('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatus?.('open');
      this.onOpen?.();
      this.flush();
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      this.onMessage?.(msg);
    };
    ws.onclose = () => {
      this.onStatus?.('closed');
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 8000);
      }
    };
    ws.onerror = () => { /* onclose разрулит реконнект */ };
  }

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  private flush(): void {
    if (!this.ws) return;
    for (const data of this.queue) this.ws.send(data);
    this.queue = [];
  }

  close(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
