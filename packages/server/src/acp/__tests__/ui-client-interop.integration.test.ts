import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ProviderRegistry, SmartRouter } from '@kairos/providers';
import { AcpServer } from '../server.js';
import { ProviderAcpAgent } from '../provider-agent.js';
import { SessionStore } from '../session-store.js';
import { FakeAcpAgent } from '../fake-agent.js';
import type { AcpAgent } from '../peer.js';
// The SHIPPED UI client — same file the browser bundles. Driving the real
// server with it is the headless interop proof from transport-integration-spec
// §4 ("a thin AcpClient node harness reusing acp-ws.ts to assert the client
// contract without a browser"). Node 24 supplies the global WebSocket it needs.
import { WsJsonRpc } from '@kairos/ui/services/acp-ws';

// A mock-only router so the whole stack runs offline + deterministically.
function mockRouter(): SmartRouter {
  const registry = new ProviderRegistry({ mock: true, discoveryTtlMs: 0 });
  for (const p of [...registry.all]) if (p.name !== 'mock') registry.removeProvider(p.name);
  return new SmartRouter(registry);
}

let server: Server;
afterEach(() => new Promise<void>((r) => server?.close(() => r())));

function boot(createAgent: () => AcpAgent = () => new ProviderAcpAgent({ router: mockRouter() })): Promise<number> {
  server = createServer();
  const acp = new AcpServer({ createAgent });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname === '/acp') acp.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

describe('shipped UI client (WsJsonRpc) ↔ real ACP server', () => {
  it('completes initialize → session/new → session/prompt and receives streamed session/update', async () => {
    const port = await boot();
    const rpc = new WsJsonRpc(`ws://localhost:${port}/acp?agent=mock&cwd=/tmp`);

    const chunks: string[] = [];
    rpc.notify('session/update', (params) => {
      const p = params as { update?: { sessionUpdate?: string; content?: { text?: string } } };
      if (p.update?.sessionUpdate === 'agent_message_chunk') chunks.push(p.update.content?.text ?? '');
    });

    await new Promise<void>((resolve, reject) => {
      rpc.onOpen = resolve;
      rpc.onSocketError = reject;
    });

    const init = await rpc.request<{ protocolVersion: number; agentInfo?: { name?: string } }>('initialize', {
      protocolVersion: 1,
    });
    expect(init.protocolVersion).toBe(1);
    expect(init.agentInfo?.name).toBe('kairos-provider-agent');

    const { sessionId } = await rpc.request<{ sessionId: string }>('session/new', { cwd: '/tmp', mcpServers: [] });
    expect(sessionId).toBeTruthy();

    const result = await rpc.request<{ stopReason: string; usage?: { outputTokens?: number } }>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'hello from the real UI client' }],
    });
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage?.outputTokens).toBeGreaterThan(0);

    const text = chunks.join('');
    expect(text).toContain('[mock]');
    expect(text).toContain('hello from the real UI client');

    rpc.close();
  });

  it('answers a server-originated session/request_permission via the client', async () => {
    // Full bidirectional proof: a FakeAcpAgent originates a permission request
    // back to the client mid-turn; the shipped WsJsonRpc dispatches it to the
    // registered handler and sends the {outcome} answer over the same socket.
    const port = await boot(() => new FakeAcpAgent({ requestPermission: true }));
    const rpc = new WsJsonRpc(`ws://localhost:${port}/acp?agent=fake&cwd=/tmp`);
    await new Promise<void>((resolve, reject) => { rpc.onOpen = resolve; rpc.onSocketError = reject; });

    let asked = false;
    rpc.handle('session/request_permission', () => {
      asked = true;
      return { outcome: { optionId: 'allow' } };
    });

    const { sessionId } = await rpc.request<{ sessionId: string }>('session/new', { cwd: '/tmp', mcpServers: [] });
    const result = await rpc.request<{ stopReason: string }>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'please run the tool' }],
    });
    expect(asked).toBe(true); // server originated the request; client answered
    expect(result.stopReason).toBe('end_turn'); // allow → turn completes
    rpc.close();
  });

  it('resumes a session over a fresh socket via session/load (shared store)', async () => {
    // Wire a shared SessionStore exactly as main.ts does, so a NEW connection
    // (new per-socket agent) resumes the prior session's history rather than
    // landing on an empty agent. This is the end-to-end proof of the resume fix.
    const router = mockRouter();
    const sessions = new SessionStore();
    const port = await boot(() => new ProviderAcpAgent({ router, sessions }));

    // Connection 1: new session + one turn.
    const c1 = new WsJsonRpc(`ws://localhost:${port}/acp?agent=mock&cwd=/tmp`);
    await new Promise<void>((resolve, reject) => { c1.onOpen = resolve; c1.onSocketError = reject; });
    await c1.request('initialize', { protocolVersion: 1 });
    const { sessionId } = await c1.request<{ sessionId: string }>('session/new', { cwd: '/tmp', mcpServers: [] });
    await c1.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'remember this fact' }] });
    c1.close();

    // Connection 2: a brand-new socket → a brand-new agent → resume + prompt.
    const c2 = new WsJsonRpc(`ws://localhost:${port}/acp?agent=mock&cwd=/tmp`);
    await new Promise<void>((resolve, reject) => { c2.onOpen = resolve; c2.onSocketError = reject; });
    const loaded = await c2.request('session/load', { sessionId, cwd: '/tmp', mcpServers: [] });
    expect(loaded).toMatchObject({ sessionId });
    const resumed = await c2.request<{ stopReason: string; usage?: { inputTokens?: number } }>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'x' }],
    });
    expect(resumed.stopReason).toBe('end_turn');

    // A cold session on the same shared store: the resumed turn carried more
    // input tokens because its history from connection 1 came along.
    const coldNew = await c2.request<{ sessionId: string }>('session/new', { cwd: '/tmp', mcpServers: [] });
    const cold = await c2.request<{ usage?: { inputTokens?: number } }>('session/prompt', {
      sessionId: coldNew.sessionId,
      prompt: [{ type: 'text', text: 'x' }],
    });
    expect(resumed.usage?.inputTokens ?? 0).toBeGreaterThan(cold.usage?.inputTokens ?? 0);
    c2.close();
  });

  it('surfaces the 4400 close when ?agent= is missing', async () => {
    const port = await boot();
    const rpc = new WsJsonRpc(`ws://localhost:${port}/acp?cwd=/tmp`);
    const close = await new Promise<{ code: number }>((resolve) => {
      rpc.onClose = resolve;
      rpc.onSocketError = () => {};
    });
    expect(close.code).toBe(4400);
  });
});
