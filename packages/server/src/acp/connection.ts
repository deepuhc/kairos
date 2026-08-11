import { JsonRpcCodec, type JsonRpcMessage } from '@kairos/protocol';
import type { AcpAgent, Peer } from './peer.js';

/** Minimal duplex the connection needs — satisfied by a `ws` WebSocket. */
export interface Duplex {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

// JSON-RPC error codes (subset).
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

// Bridges a single client connection to an AcpAgent. Owns one JsonRpcCodec for
// framing + server-originated request correlation, and implements the Peer the
// agent uses to push notifications and originate requests back to the client.
//
// Transport-agnostic: `Duplex` is anything with send/close, so this is unit
// tested with an in-memory pipe and used in production with a `ws` socket.
export class AcpConnection implements Peer {
  private codec = new JsonRpcCodec();

  constructor(
    private socket: Duplex,
    private agent: AcpAgent,
  ) {}

  /** Feed a raw inbound frame (or partial frame) from the transport. */
  receive(chunk: string): void {
    const messages = this.codec.decode(chunk);
    for (const msg of messages) this.dispatch(msg);
  }

  /** Reject any in-flight server-originated requests when the socket drops. */
  close(): void {
    this.codec.reset();
  }

  // ── Peer ──────────────────────────────────────────────────────────────────

  notify(method: string, params?: Record<string, unknown>): void {
    this.socket.send(this.codec.encodeNotification(method, params));
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const { id, payload } = this.codec.encode(method, params);
    const pending = this.codec.registerPending(id) as Promise<T>;
    this.socket.send(payload);
    return pending;
  }

  // ── inbound dispatch ────────────────────────────────────────────────────────

  private dispatch(msg: JsonRpcMessage): void {
    // Responses to our server-originated requests are settled inside codec.decode
    // (via settlePending); nothing more to do here.
    const isRequestOrNotification = 'method' in msg;
    if (!isRequestOrNotification) return;

    const method = msg.method;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    if ('id' in msg && msg.id !== undefined && msg.id !== null) {
      // Client → server request: answer with a result or an error frame.
      const id = msg.id;
      this.agent
        .handleRequest(method, params, this)
        .then((result) => this.socket.send(this.codec.encodeResponse(id, result)))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          const code = /method not found/i.test(message) ? METHOD_NOT_FOUND : INTERNAL_ERROR;
          this.socket.send(this.codec.encodeResponse(id, undefined, { code, message }));
        });
    } else {
      // Client → server notification.
      this.agent.handleNotification(method, params, this);
    }
  }
}
