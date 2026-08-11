import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex as NodeDuplex } from 'node:stream';
import { AcpConnection, type Duplex } from './connection.js';
import { ConnectionMonitor } from './connection-monitor.js';
import type { AcpAgent } from './peer.js';

const CLOSE_BAD_UPGRADE = 4400;

export interface AcpServerOptions {
  /**
   * Build the agent for a new connection. Receives the parsed `agent` and `cwd`
   * query params (acp.ts connects to `/acp?agent=<id>&cwd=<path>`).
   */
  createAgent: (info: { agentId: string; cwd: string }) => AcpAgent;
  /** Heartbeat interval in ms (default 30_000). */
  heartbeatMs?: number;
  /** Close a connection whose send buffer exceeds this many bytes (default 16 MiB). */
  backpressureLimitBytes?: number;
}

// Stands up the ACP JSON-RPC transport (served on `/acp` by the central upgrade
// router in main.ts, alongside the legacy `/ws` hub). Uses a `noServer`
// WebSocketServer so it coexists with WebSocketHub on the same http.Server.
export class AcpServer {
  private wss: WebSocketServer;
  private connections = new Set<AcpConnection>();

  constructor(private opts: AcpServerOptions) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Route an HTTP upgrade for the ACP path into a WebSocket connection. */
  handleUpgrade(req: IncomingMessage, socket: NodeDuplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    const agentId = url.searchParams.get('agent');
    const cwd = url.searchParams.get('cwd') ?? process.cwd();

    if (!agentId) {
      ws.close(CLOSE_BAD_UPGRADE, 'Missing ?agent= parameter');
      return;
    }

    const agent = this.opts.createAgent({ agentId, cwd });
    const duplex: Duplex = {
      send: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
      close: (code, reason) => ws.close(code, reason),
    };
    const conn = new AcpConnection(duplex, agent);
    this.connections.add(conn);

    // Liveness (ping/pong) + backpressure guard for this long-lived socket.
    const monitor = new ConnectionMonitor(ws, {
      intervalMs: this.opts.heartbeatMs,
      backpressureLimitBytes: this.opts.backpressureLimitBytes,
    });
    ws.on('pong', () => monitor.notifyPong());
    monitor.start();

    // A WebSocket delivers discrete message frames, but AcpConnection feeds a
    // newline-framed JsonRpcCodec (built for stdio streams). Vanilla ACP clients
    // — including the shipped browser client (ui/services/acp-ws.ts) — send one
    // JSON object per frame with NO trailing newline, which the codec would
    // otherwise buffer forever. Terminate each frame here so message-framed
    // transports and stream-framed ones both decode. (A frame that already ends
    // in "\n" just yields a harmless empty trailing line.)
    ws.on('message', (data) => conn.receive(data.toString() + '\n'));
    ws.on('close', () => { monitor.stop(); conn.close(); this.connections.delete(conn); });
    ws.on('error', () => { monitor.stop(); conn.close(); this.connections.delete(conn); });
  }
}
