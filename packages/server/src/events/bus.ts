import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

// The `/events` fan-out bus. Distinct from the ACP transport (/acp, JSON-RPC)
// and the legacy hub (/ws, tagged union): this is a plain one-way publish
// stream of `{ event, data }` frames, exactly the shape the shipped UI's
// EventSocket (packages/ui/src/services/events.ts) parses. The UI subscribes to
// named events like `auth:changed`, `output:<id>`, and `done:<id>`; the server
// publishes them here. Correct as-is per the transport spec — NOT to be unified
// onto JSON-RPC.
//
// noServer mode: the central upgrade router in main.ts dispatches by pathname so
// /events coexists with /ws and /acp on one http.Server. A path-bound WSS would
// destroy the others' upgrades with a 400.
export class EventBus {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      // The bus is publish-only; ignore anything a client sends but keep the
      // socket healthy (drop it on close/error).
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  /** Route an HTTP upgrade for /events into a WebSocket connection. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  /** Publish a named event with an optional payload to every connected client. */
  publish(event: string, data?: unknown): void {
    const frame = JSON.stringify({ event, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}
