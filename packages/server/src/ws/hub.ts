import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ServerMessage, ClientMessage } from './protocol.js';

export class WebSocketHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private messageHandler?: (ws: WebSocket, msg: ClientMessage) => void;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

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
