// Minimal browser-side JSON-RPC 2.0 peer over WebSocket. Mirrors the shape of
// src-tauri/src/backend/acp.rs — request/notification dispatch in both directions,
// with inbound request handlers that answer via the same WebSocket. Keeps the
// wire format vanilla ACP JSON-RPC so external clients on other localhost ports
// can speak the same protocol without a bespoke wrapper.

export type RpcParams = Record<string, unknown> | unknown[] | undefined;
type RequestHandler = (params: RpcParams) => unknown | Promise<unknown>;
type NotificationHandler = (params: RpcParams) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error & { code?: number; data?: unknown }) => void;
}

/** A JSON-RPC 2.0 error, with the transport-level `code` and optional `data`. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code = -32000,
    readonly data?: unknown,
    /** True when this rejection was caused by the socket closing (vs. an agent
     * error response). Lets callers defer to their onClose handler as the
     * single reporter instead of double-reporting a generic close. */
    readonly socketClosed = false,
  ) {
    super(message);
  }
}

export interface RpcErrorLike {
  code?: number;
  message?: string;
  data?: unknown;
}

/** Read the human-useful "details" string that agents stash in `error.data`. */
export function errorDetails(err: unknown): string {
  const e = err as RpcErrorLike;
  const details = (e?.data as { details?: unknown } | undefined)?.details;
  if (typeof details === 'string' && details.trim()) return details;
  return e?.message ?? String(err);
}

export class WsJsonRpc {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private requestHandlers = new Map<string, RequestHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private closed = false;

  onOpen?: () => void;
  onClose?: (ev: { code: number; reason: string }) => void;
  onSocketError?: (err: unknown) => void;
  onTraffic?: (direction: 'in' | 'out', raw: string) => void;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => this.onOpen?.());
    this.ws.addEventListener('message', (ev) => this.onLine(String(ev.data)));
    this.ws.addEventListener('close', (ev) => {
      this.closed = true;
      // Carry the close reason (e.g. the agent's stderr tail, an exit code) into
      // the rejection so pending requests fail with the real cause, not a bare
      // "websocket closed". Tagged socketClosed so the client can defer to its
      // single onClose reporter rather than surfacing this generically.
      const err = new RpcError(ev.reason || 'websocket closed', ev.code || -32000, undefined, true);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.onClose?.({ code: ev.code, reason: ev.reason });
    });
    this.ws.addEventListener('error', (err) => this.onSocketError?.(err));
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  request<T = unknown>(method: string, params?: RpcParams): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError('websocket closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject: reject as (err: Error) => void,
      });
      this.send({ jsonrpc: '2.0', id, method, params: params ?? {} });
    });
  }

  sendNotification(method: string, params?: RpcParams): void {
    if (this.closed) return;
    this.send({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  handle(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  notify(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  close(): void {
    try { this.ws.close(); } catch { /* already closed */ }
  }

  private send(payload: unknown): void {
    // Queue if the socket hasn't opened yet; every real send path awaits `open`
    // via the request Promise, but sendNotification callers may fire before.
    if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.addEventListener(
        'open',
        () => {
          const raw = JSON.stringify(payload);
          this.onTraffic?.('out', raw);
          this.ws.send(raw);
        },
        { once: true },
      );
      return;
    }
    const raw = JSON.stringify(payload);
    this.onTraffic?.('out', raw);
    try {
      this.ws.send(raw);
    } catch { /* closed mid-send */ }
  }

  private onLine(line: string): void {
    if (!line) return;
    this.onTraffic?.('in', line);
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    this.dispatch(msg);
  }

  private dispatch(msg: Record<string, unknown>): void {
    const id = msg.id as number | undefined;
    const method = msg.method as string | undefined;

    // Response to an outbound request.
    if (id !== undefined && !method && ('result' in msg || 'error' in msg)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error) {
        const e = msg.error as { message?: string; code?: number; data?: unknown };
        pending.reject(new RpcError(e.message ?? 'RPC error', e.code, e.data));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Inbound request (server → client). Answer via the same WebSocket.
    if (method && id !== undefined) {
      const handler = this.requestHandlers.get(method);
      if (!handler) {
        this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
      }
      Promise.resolve()
        .then(() => handler(msg.params as RpcParams))
        .then((result) => this.send({ jsonrpc: '2.0', id, result: result ?? null }))
        .catch((err: Error & { code?: number; data?: unknown }) =>
          this.send({
            jsonrpc: '2.0',
            id,
            error: {
              code: err.code ?? -32000,
              message: err.message ?? String(err),
              ...(err.data !== undefined ? { data: err.data } : {}),
            },
          }),
        );
      return;
    }

    // Inbound notification (no id).
    if (method) {
      const handler = this.notificationHandlers.get(method);
      handler?.(msg.params as RpcParams);
    }
  }
}
