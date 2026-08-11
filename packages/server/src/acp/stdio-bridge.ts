import { JsonRpcCodec } from '@kairos/protocol';
import { Methods } from '@kairos/protocol';
import type { AcpAgent, Peer } from './peer.js';

// A real ACP agent that runs as a child process speaking JSON-RPC over stdio —
// e.g. Claude Code via `@agentclientprotocol/claude-agent-acp`. This is a
// transparent bidirectional proxy between the browser (the ACP *client*, on the
// far side of `peer`) and the child (the ACP *agent*, on the far side of `io`):
//
//   browser → server request/notification  ── handleRequest/handleNotification →  child stdin
//   child stdout request/notification       ── peer.request / peer.notify        →  browser
//   child stdout responses                   ── settled by the child codec        →  resolve the
//                                                                                     forwarded request
//
// Requests are re-issued with the proxy's own id space (JsonRpcCodec.encode) and
// correlated back by that codec; child-originated requests echo the child's id.
// Requests vs responses are told apart by the presence of `method` (same rule
// AcpConnection uses), so the two id spaces never collide.
//
// The transport seam (`ChildIo`) is abstract so the whole proxy is unit-testable
// with an in-memory fake child; production wires it to a spawned subprocess.
export interface ChildIo {
  /** Write one already-newline-terminated JSON-RPC frame to the child's stdin. */
  write(frame: string): void;
  /** Register a handler for raw stdout chunks (may be partial lines). */
  onStdout(cb: (chunk: string) => void): void;
  /** Register a handler for raw stderr chunks. */
  onStderr(cb: (chunk: string) => void): void;
  /** Register a handler for child exit. */
  onExit(cb: (code: number | null) => void): void;
  /** Terminate the child. */
  kill(): void;
}

export class StdioAcpAgent implements AcpAgent {
  // A codec dedicated to the child: frames + correlates responses to the
  // requests this proxy forwards into the child.
  private codec = new JsonRpcCodec();
  private peer: Peer | null = null;
  private closed = false;

  constructor(private io: ChildIo) {
    this.io.onStdout((chunk) => this.onChildOutput(chunk));
    this.io.onStderr((chunk) => this.onChildStderr(chunk));
    this.io.onExit((code) => this.onChildExit(code));
  }

  // ── client → server (browser → child) ───────────────────────────────────────

  async handleRequest(method: string, params: Record<string, unknown>, peer: Peer): Promise<unknown> {
    this.peer = peer;
    if (this.closed) throw new Error('agent process has exited');
    const { id, payload } = this.codec.encode(method, params);
    const pending = this.codec.registerPending(id);
    this.io.write(payload);
    return pending;
  }

  handleNotification(method: string, params: Record<string, unknown>, peer: Peer): void {
    this.peer = peer;
    if (this.closed) return;
    this.io.write(this.codec.encodeNotification(method, params));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.codec.reset(); // reject any in-flight forwarded requests
    this.io.kill();
  }

  // ── server → client (child → browser) ────────────────────────────────────────

  private onChildOutput(chunk: string): void {
    // decode() both parses frames and settles responses to our forwarded
    // requests (resolving the promises handleRequest returned). What remains to
    // route are the child's own requests/notifications.
    for (const msg of this.codec.decode(chunk)) {
      if (!('method' in msg)) continue; // a response — already settled by decode
      const method = msg.method;
      const params = (msg.params ?? {}) as Record<string, unknown>;

      if ('id' in msg && msg.id !== undefined && msg.id !== null) {
        // Child → client request (session/request_permission, fs/*, terminal/*).
        const id = msg.id;
        const peer = this.peer;
        if (!peer) continue; // no client attached yet; nothing to forward to
        peer
          .request(method, params)
          .then((result) => this.io.write(this.codec.encodeResponse(id, result)))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.io.write(this.codec.encodeResponse(id, undefined, { code: -32603, message }));
          });
      } else {
        // Child → client notification (session/update, _ext/*, …).
        this.peer?.notify(method, params);
      }
    }
  }

  private onChildStderr(chunk: string): void {
    // Surface the child's stderr to the client as a Kairos log extension so it
    // shows in the Frames/log panel instead of vanishing.
    this.peer?.notify(Methods.EXT_LOG, { stream: 'stderr', text: chunk });
  }

  private onChildExit(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    this.codec.reset();
    this.peer?.notify(Methods.EXT_LOG, { stream: 'exit', text: `agent process exited (code ${code ?? 'null'})` });
  }
}
