import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ProviderRegistry, SmartRouter } from '@kairos/providers';
import { AcpServer } from '../server.js';
import { ProviderAcpAgent } from '../provider-agent.js';
// The SHIPPED UI client — proving a *real* (non-mock) provider turn flows all
// the way through: WsJsonRpc → /acp → ProviderAcpAgent → SmartRouter →
// AnthropicProvider (SSE) → session/update. The Anthropic HTTP call is stubbed
// with a recorded SSE body so no key or network is needed; the ws transport is
// genuine (ws uses http, not fetch, so the fetch stub doesn't touch it).
import { WsJsonRpc } from '@kairos/ui/services/acp-ws';

// A registry with ONLY a real AnthropicProvider (mock off), exactly the shape
// main.ts builds when ANTHROPIC_API_KEY is present.
function anthropicRouter(): SmartRouter {
  const registry = new ProviderRegistry({ anthropic: { apiKey: 'sk-ant-test' }, discoveryTtlMs: 0 });
  for (const p of [...registry.all]) if (p.name !== 'anthropic') registry.removeProvider(p.name);
  return new SmartRouter(registry);
}

// A stubbed Anthropic streaming response: message_start (input tokens),
// text deltas, then message_delta (output tokens).
function stubAnthropicSSE(): void {
  const events = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" from Claude"}}',
    'data: {"type":"message_delta","usage":{"output_tokens":7}}',
    'data: [DONE]',
  ].join('\n') + '\n';
  const encoder = new TextEncoder();
  let sent = false;
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: encoder.encode(events) }),
      }),
    },
  })));
}

let server: Server;
afterEach(() => {
  vi.unstubAllGlobals();
  return new Promise<void>((r) => server?.close(() => r()));
});

function boot(): Promise<number> {
  server = createServer();
  const router = anthropicRouter();
  const acp = new AcpServer({ createAgent: () => new ProviderAcpAgent({ router }) });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname === '/acp') acp.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));
}

describe('real provider (Anthropic) over /acp via the shipped client', () => {
  it('streams a Claude SSE turn through as session/update with real usage', async () => {
    stubAnthropicSSE();
    const port = await boot();
    const rpc = new WsJsonRpc(`ws://localhost:${port}/acp?agent=anthropic&cwd=/tmp`);

    const chunks: string[] = [];
    rpc.notify('session/update', (params) => {
      const p = params as { update?: { sessionUpdate?: string; content?: { text?: string } } };
      if (p.update?.sessionUpdate === 'agent_message_chunk') chunks.push(p.update.content?.text ?? '');
    });
    await new Promise<void>((resolve, reject) => { rpc.onOpen = resolve; rpc.onSocketError = reject; });

    const init = await rpc.request<{ agentInfo?: { name?: string } }>('initialize', { protocolVersion: 1 });
    expect(init.agentInfo?.name).toBe('kairos-provider-agent');

    const { sessionId } = await rpc.request<{ sessionId: string }>('session/new', { cwd: '/tmp', mcpServers: [] });
    const result = await rpc.request<{ stopReason: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }>(
      'session/prompt',
      { sessionId, prompt: [{ type: 'text', text: 'hi Claude' }] },
    );

    expect(result.stopReason).toBe('end_turn');
    // The streamed reply reached the client as session/update frames.
    expect(chunks.join('')).toBe('Hello from Claude');
    // Real usage survived the full path: input tokens from message_start,
    // output from message_delta, total = sum (the bug this path had before).
    expect(result.usage?.inputTokens).toBe(11);
    expect(result.usage?.outputTokens).toBe(7);
    expect(result.usage?.totalTokens).toBe(18);

    rpc.close();
  });
});
