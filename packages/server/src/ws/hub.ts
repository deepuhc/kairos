import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ServerMessage, ClientMessage } from './protocol.js';

export class WebSocketHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private messageHandler?: (ws: WebSocket, msg: ClientMessage) => void;

  // `noServer` mode: a central upgrade router (see main.ts) dispatches by path
  // so the hub (/ws) can coexist with the ACP transport (/acp) on one server.
  constructor() {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ClientMessage;
          this.messageHandler?.(ws, msg);
        } catch {
          this.sendTo(ws, { type: 'error', message: 'Invalid JSON' });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  /** Route an HTTP upgrade for this hub's path into a WebSocket connection. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  onMessage(handler: (ws: WebSocket, msg: ClientMessage) => void): void {
    this.messageHandler = handler;
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}
