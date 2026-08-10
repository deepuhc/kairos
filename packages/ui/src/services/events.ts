import { ensureBackendCookie } from './backend-auth.js';

type Handler<T = unknown> = (payload: T) => void;

export class EventSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private closed = false;

  constructor() {
    this.connect();
  }

  on<T = unknown>(event: string, handler: Handler<T>): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);
  }

  off<T = unknown>(event: string, handler?: Handler<T>): void {
    if (!handler) {
      this.handlers.delete(event);
      return;
    }
    const set = this.handlers.get(event);
    set?.delete(handler as Handler);
    if (set?.size === 0) this.handlers.delete(event);
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    await ensureBackendCookie();
    if (this.closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/events`);
    this.ws.onmessage = (event) => this.dispatch(event.data);
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => {
      try { this.ws?.close(); } catch { /* already closed */ }
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  private dispatch(raw: string): void {
    let msg: { event?: string; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg.event) return;
    const set = this.handlers.get(msg.event);
    if (!set) return;
    for (const handler of [...set]) handler(msg.data);
  }
}

export function io(): EventSocket {
  return new EventSocket();
}

export type Socket = EventSocket;
