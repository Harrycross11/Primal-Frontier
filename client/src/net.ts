import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts';

/** Thin WebSocket wrapper: JSON in, JSON out. */
export class Net {
  private ws: WebSocket;
  onMessage: (msg: ServerMessage) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.addEventListener('message', (e) => this.onMessage(JSON.parse(e.data)));
    this.ws.addEventListener('close', () => this.onClose());
  }

  opened(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Could not reach the server')), { once: true });
    });
  }

  send(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
