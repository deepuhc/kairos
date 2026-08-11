import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AcpClient } from '../services/acp.js';
import type { SessionUpdate } from '../services/acp-types.js';

// A fake WebSocket that plays the ACP *agent* (server) side in-process, so we
// can drive the real AcpClient without a network. It implements just the slice
// of the browser WebSocket API that WsJsonRpc touches: addEventListener for
// open/message/close/error, send, close, readyState, and the static OPEN/
// CONNECTING constants. On each JSON-RPC request the client sends, it responds
// on a microtask — including streaming session/update notifications and, when
// asked, originating a session/request_permission back to the client.
type Listener = (ev: { data?: string; code?: number; reason?: string }) => void;

interface FakeAgentOptions {
  requestPermission?: boolean;
  /** Close immediately with this code instead of opening (simulates 4400). */
  closeOnOpen?: { code: number; reason: string };
}

let lastSocket: FakeWebSocket | null = null;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  private listeners: Record<string, Listener[]> = { open: [], message: [], close: [], error: [] };
  private seq = 0;
  static options: FakeAgentOptions = {};

  constructor(readonly url: string) {
    lastSocket = this;
    queueMicrotask(() => {
      const close = FakeWebSocket.options.closeOnOpen;
      if (close) {
        this.readyState = FakeWebSocket.CLOSED;
        this.emit('close', { code: close.code, reason: close.reason });
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, cb: Listener): void {
    this.listeners[type]?.push(cb);
  }

  send(raw: string): void {
    const msg = JSON.parse(raw) as { id?: number; method?: string; params?: Record<string, unknown> };
    // Only requests (with id + method) need a response; responses from the
    // client (answering our permission request) carry id but no method.
    if (msg.method && msg.id !== undefined) this.handleRequest(msg.id, msg.method, msg.params ?? {});
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: 1000, reason: '' });
  }

  // ── agent behavior ────────────────────────────────────────────────────────

  private handleRequest(id: number, method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'initialize':
        return this.respond(id, {
          protocolVersion: 1,
          agentInfo: { name: 'fake-agent', title: 'Fake', version: '1.0.0' },
          agentCapabilities: { loadSession: true },
          authMethods: [],
        });
      case 'session/new':
        return this.respond(id, { sessionId: `sess-${++this.seq}`, configOptions: [] });
      case 'session/prompt':
        void this.runPrompt(id, params);
        return;
      default:
        return this.respond(id, {});
    }
  }

  private async runPrompt(id: number, params: Record<string, unknown>): Promise<void> {
    const sessionId = params.sessionId as string;
    const text = (params.prompt as Array<{ text?: string }>).map((b) => b.text ?? '').join(' ');

    if (FakeWebSocket.options.requestPermission) {
      const outcome = await this.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 'tc-1', title: 'run', kind: 'execute' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      });
      if ((outcome as { outcome?: { optionId?: string } })?.outcome?.optionId === 'reject') {
        return this.respond(id, { stopReason: 'refusal' });
      }
    }

    const reply = `[fake] ${text}`;
    for (const word of reply.split(' ')) {
      this.notify('session/update', {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: word + ' ' } },
      });
    }
    this.respond(id, { stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 8, totalTokens: 11 } });
  }

  // ── server → client requests (bidirectional) ────────────────────────────────

  private pending = new Map<number, (result: unknown) => void>();
  private outboundId = -1; // negative ids so they never collide with the client's

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const rid = this.outboundId--;
    return new Promise((resolve) => {
      this.pending.set(rid, resolve);
      this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) });
    });
  }

  /** Client answers our outbound request → resolve the pending promise. */
  ackResponse(raw: string): void {
    const msg = JSON.parse(raw) as { id?: number; result?: unknown };
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      this.pending.get(msg.id)!(msg.result);
      this.pending.delete(msg.id);
    }
  }

  private respond(id: number, result: unknown): void {
    this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id, result }) });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method, params }) });
  }

  private emit(type: string, ev: { data?: string; code?: number; reason?: string }): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

// The client's answer to an inbound request is sent via ws.send(); route those
// back into the fake agent's pending map.
const origSend = FakeWebSocket.prototype.send;
FakeWebSocket.prototype.send = function (this: FakeWebSocket, raw: string) {
  const msg = JSON.parse(raw) as { id?: number; method?: string };
  if (msg.id !== undefined && msg.method === undefined) {
    this.ackResponse(raw); // a response from the client → resolve our request
    return;
  }
  origSend.call(this, raw);
};

const realWs = (globalThis as { WebSocket?: unknown }).WebSocket;
const realLoc = (globalThis as { location?: unknown }).location;

beforeEach(() => {
  FakeWebSocket.options = {};
  lastSocket = null;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  (globalThis as { location?: unknown }).location = { protocol: 'http:', host: 'localhost:3333' };
  // AcpClient.connect awaits ensureBackendCookie() → fetch('/api/health').
  (globalThis as { fetch?: unknown }).fetch = async () => new Response('{}', { status: 200 });
});

afterEach(() => {
  if (realWs === undefined) delete (globalThis as { WebSocket?: unknown }).WebSocket;
  else (globalThis as { WebSocket?: unknown }).WebSocket = realWs;
  if (realLoc === undefined) delete (globalThis as { location?: unknown }).location;
  else (globalThis as { location?: unknown }).location = realLoc;
});

describe('AcpClient (shipped UI client) against a fake ACP agent', () => {
  it('connects → initializes → new session → prompt → onStop, dispatching updates', async () => {
    const client = new AcpClient();
    const updates: SessionUpdate[] = [];
    let initializedAgent = '';

    const stopped = new Promise<{ sessionId: string; stopReason: string; outputTokens?: number }>((resolve, reject) => {
      client.setHandlers({
        onInitialized: (info) => {
          initializedAgent = info.agentId;
          client.newSession('/repo', 'mock');
        },
        onSession: (s) => client.prompt(s.sessionId, [{ type: 'text', text: 'hello client' }]),
        onUpdate: (_sid, u) => updates.push(u),
        onStop: (sessionId, stopReason, usage) => resolve({ sessionId, stopReason, outputTokens: usage?.outputTokens }),
        onError: (m) => reject(new Error(m)),
      });
      client.connect('/repo', 'mock');
    });

    const result = await stopped;
    expect(initializedAgent).toBe('mock');
    expect(result.stopReason).toBe('end_turn');
    expect(result.outputTokens).toBe(8);
    const text = updates
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => ((u as { content?: { text?: string } }).content?.text ?? ''))
      .join('');
    expect(text).toContain('[fake]');
    expect(text).toContain('hello client');
    client.dispose();
  });

  it('answers an inbound session/request_permission and completes the turn', async () => {
    FakeWebSocket.options = { requestPermission: true };
    const client = new AcpClient();

    const stopped = new Promise<string>((resolve, reject) => {
      client.setHandlers({
        onInitialized: () => client.newSession('/repo', 'mock'),
        onSession: (s) => client.prompt(s.sessionId, [{ type: 'text', text: 'do it' }]),
        onPermissionRequest: (req) => {
          // The Agents UI shows a prompt; here we auto-allow.
          expect(req.options[0].optionId).toBe('allow');
          client.resolvePermission(req.requestId, { optionId: 'allow' });
        },
        onStop: (_sid, reason) => resolve(reason),
        onError: (m) => reject(new Error(m)),
      });
      client.connect('/repo', 'mock');
    });

    expect(await stopped).toBe('end_turn');
    client.dispose();
  });

  it('reports onError when the agent connection is refused (4400 close)', async () => {
    FakeWebSocket.options = { closeOnOpen: { code: 4400, reason: 'Missing ?agent= parameter' } };
    const client = new AcpClient();

    const message = await new Promise<string>((resolve) => {
      client.setHandlers({ onError: (m) => resolve(m) });
      client.connect('/repo', 'mock');
    });
    expect(message).toContain('agent');
    client.dispose();
  });

  it('is idempotent: a second connect to the same agent reuses the socket', async () => {
    const client = new AcpClient();
    await new Promise<void>((resolve) => {
      client.setHandlers({ onInitialized: () => resolve() });
      client.connect('/repo', 'mock');
    });
    const first = lastSocket;
    client.connect('/repo', 'mock'); // should be a no-op
    expect(lastSocket).toBe(first);
    client.dispose();
  });
});
