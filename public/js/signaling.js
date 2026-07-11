// WebSocket-клиент сигналинга с авто-реконнектом и очередью исходящих сообщений.
// События: 'open', 'message' (detail = разобранный объект), 'close'.

export class Signaling extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.shouldReconnect = true;
    this.queue = [];
    this.reconnectDelay = 1000;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.dispatchEvent(new Event('open'));
      this._flush();
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    };

    this.ws.onclose = () => {
      this.dispatchEvent(new Event('close'));
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 8000);
      }
    };

    this.ws.onerror = () => { /* onclose разрулит реконнект */ };
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  _flush() {
    for (const data of this.queue) this.ws.send(data);
    this.queue = [];
  }

  close() {
    this.shouldReconnect = false;
    if (this.ws) this.ws.close();
  }
}
