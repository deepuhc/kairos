import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { JsonRpcCodec, Methods, type SessionPromptResult } from '@kairos/protocol';
import { AcpServer } from '../server.js';
import { StdioAcpAgent, type ChildIo } from '../stdio-bridge.js';

// End-to-end proof that an EXTERNAL stdio ACP agent (the shape a local Claude
// Code adapter takes) flows through the real transport: a genuine WebSocket
// client → AcpServer → AcpConnection → StdioAcpAgent → child stdin, and the
// child's stdout responses/notifications/requests → back to the client. The
// child is a scripted in-memory fake (no subprocess) so the test is fast and
// deterministic; ChildProcessIo is the only untested seam and it is a thin
// spawn() wrapper over this same ChildIo interface.

let server: Server;

afterEach(() => new Promise<void>((r) => server?.close(() => r())));

// A scripted ACP *agent* speaking JSON-RPC over its "stdio". It answers
// initialize / session/new / session/prompt; during a prompt it streams a
// session/update, originates a session/request_permission back to the client,
// and only sends the prompt result once that permission answer arrives on stdin.
class ScriptedChild implements ChildIo {
  private codec = new JsonRpcCodec();
  private stdout: ((c: string) => void) | null = null;
  private exit: ((code: number | null) => void) | null = null;
  killed = false;
  private pendingPromptId: number | null = null;
  private readonly permId = 1000;

  write(frame: string): void {
    for (const msg of this.codec.decode(frame)) {
      if ('method' in msg) {
        this.onRequest(msg as { id?: number; method: string });
      } else if (this.pendingPromptId != null) {
        // A response with no method — the client's permission answer. Now the
        // prompt can complete.
        this.emit({ id: this.pendingPromptId, result: { stopReason: 'end_turn' } satisfies SessionPromptResult });
        this.pendingPromptId = null;
      }
    }
  }
  onStdout(cb: (c: string) => void): void { this.stdout = cb; }
  onStderr(_cb: (c: string) => void): void { /* unused in this scenario */ }
  onExit(cb: (code: number | null) => void): void { this.exit = cb; }
  kill(): void { this.killed = true; this.exit?.(0); }

  private emit(obj: Record<string, unknown>): void {
    this.stdout?.(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
  }

  private onRequest(msg: { id?: number; method: string }): void {
    const { id, method } = msg;
    if (method === Methods.INITIALIZE) {
      this.emit({ id, result: { protocolVersion: 1 } });
    } else if (method === Methods.SESSION_NEW) {
      this.emit({ id, result: { sessionId: 'child-sess-1' } });
    } else if (method === Methods.SESSION_PROMPT) {
      this.pendingPromptId = id ?? null;
      this.emit({
        method: Methods.SESSION_UPDATE,
        params: { sessionId: 'child-sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working' } } },
      });
      this.emit({
        id: this.permId,
        method: Methods.SESSION_REQUEST_PERMISSION,
        params: { sessionId: 'child-sess-1', options: [{ optionId: 'allow' }] },
      });
    }
  }
}

function boot(): Promise<{ port: number; child: ScriptedChild }> {
  server = createServer();
  const child = new ScriptedChild();
  const acp = new AcpServer({ createAgent: () => new StdioAcpAgent(child) });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname === '/acp') acp.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ port: (server.address() as AddressInfo).port, child }));
  });
}

// A minimal ACP client over a real socket: auto-answers permission requests.
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

describe('StdioAcpAgent over a real WebSocket (external CLI agent end-to-end)', () => {
  it('proxies initialize → session/new → session/prompt through a stdio child, round-tripping a permission request', async () => {
    const { port } = await boot();
    const ws = await connect(`ws://localhost:${port}/acp?agent=claude&cwd=/tmp`);
    const client = new TestAcpClient(ws);

    const init = await client.request<{ protocolVersion: number }>(Methods.INITIALIZE, { protocolVersion: 1 });
    expect(init.protocolVersion).toBe(1);

    const { sessionId } = await client.request<{ sessionId: string }>(Methods.SESSION_NEW, { cwd: '/tmp', mcpServers: [] });
    expect(sessionId).toBe('child-sess-1');

    const result = await client.request<SessionPromptResult>(Methods.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: 'text', text: 'do work' }],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(client.permissionAsks).toBe(1); // child→client request round-tripped
    expect(client.updates.length).toBeGreaterThan(0); // child→client notification forwarded
    ws.close();
  });

  it('kills the child subprocess when the client disconnects', async () => {
    const { port, child } = await boot();
    const ws = await connect(`ws://localhost:${port}/acp?agent=claude&cwd=/tmp`);
    const client = new TestAcpClient(ws);
    await client.request(Methods.INITIALIZE, { protocolVersion: 1 });
    ws.close();
    await vi.waitFor(() => expect(child.killed).toBe(true), { timeout: 2000 });
  });
});
