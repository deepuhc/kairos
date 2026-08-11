import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { JsonRpcCodec, Methods, type SessionPromptResult } from '@kairos/protocol';
import { AcpServer } from '../server.js';
import { WebSocketHub } from '../../ws/hub.js';
import { FakeAcpAgent } from '../fake-agent.js';

// Boots a real http.Server with the SAME central upgrade router main.ts uses,
// wiring both the /ws hub and the /acp AcpServer, then drives a genuine
// WebSocket client through the ACP handshake + prompt. This is the headless
// end-to-end proof from transport-integration-spec §4.

let server: Server;

afterEach(() => new Promise<void>((r) => server?.close(() => r())));

function boot(): Promise<{ port: number; hub: WebSocketHub }> {
  server = createServer();
  const hub = new WebSocketHub();
  const acp = new AcpServer({ createAgent: () => new FakeAcpAgent({ requestPermission: true }) });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname === '/ws') hub.handleUpgrade(req, socket, head);
    else if (pathname === '/acp') acp.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  return new Promise((resolve) => {
    server.listen(0, () => resolve({ port: (server.address() as AddressInfo).port, hub }));
  });
}

// A minimal ACP client over a real socket: codec for framing, auto-answers
// server-originated permission requests with `allow`.
class TestAcpClient {
  private codec = new JsonRpcCodec();
  updates: Array<Record<string, unknown>> = [];
  permissionAsks = 0;

  constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      for (const msg of this.codec.decode(data.toString())) {
        if ('method' in msg) {
          if (msg.method === Methods.SESSION_UPDATE) this.updates.push(msg.params ?? {});
          if (msg.method === Methods.SESSION_REQUEST_PERMISSION && 'id' in msg && msg.id != null) {
            this.permissionAsks++;
            this.ws.send(this.codec.encodeResponse(msg.id, { outcome: { optionId: 'allow' } }));
          }
        }
      }
    });
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const { id, payload } = this.codec.encode(method, params);
    const pending = this.codec.registerPending(id) as Promise<T>;
    this.ws.send(payload);
    return pending;
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

describe('AcpServer over a real WebSocket', () => {
  it('completes initialize → session/new → session/prompt with streamed updates', async () => {
    const { port } = await boot();
    const ws = await connect(`ws://localhost:${port}/acp?agent=test&cwd=/tmp`);
    const client = new TestAcpClient(ws);

    const init = await client.request<{ protocolVersion: number }>(Methods.INITIALIZE, { protocolVersion: 1 });
    expect(init.protocolVersion).toBe(1);

    const { sessionId } = await client.request<{ sessionId: string }>(Methods.SESSION_NEW, { cwd: '/tmp', mcpServers: [] });
    expect(sessionId).toMatch(/^fake-sess-/);

    const result = await client.request<SessionPromptResult>(Methods.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: 'text', text: 'integration test' }],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(client.permissionAsks).toBe(1); // bidirectional request round-tripped
    expect(client.updates.length).toBeGreaterThan(0);
    ws.close();
  });

  it('rejects an /acp upgrade with no ?agent= param', async () => {
    const { port } = await boot();
    const closeInfo = await new Promise<{ code: number }>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/acp?cwd=/tmp`);
      ws.on('close', (code) => resolve({ code }));
      ws.on('error', () => {}); // a 4400 close may also surface as an error
      setTimeout(() => reject(new Error('no close')), 2000);
    });
    expect(closeInfo.code).toBe(4400);
  });

  it('still serves the legacy /ws hub alongside /acp', async () => {
    const { port, hub } = await boot();
    const gotInit = new Promise<void>((resolve) => {
      hub.onMessage((_ws, msg) => { if (msg.type === 'agent:kill') resolve(); });
    });
    const ws = await connect(`ws://localhost:${port}/ws`);
    ws.send(JSON.stringify({ type: 'agent:kill', agentId: 'x' }));
    await gotInit; // hub received a /ws message → coexistence proven
    ws.close();
  });
});
