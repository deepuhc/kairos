import { describe, it, expect } from 'vitest';
import { JsonRpcCodec, Methods, type SessionPromptResult } from '@kairos/protocol';
import { AcpConnection, type Duplex } from '../connection.js';
import { FakeAcpAgent } from '../fake-agent.js';

// A client-side harness: its own codec + a Duplex that pipes both ways into an
// AcpConnection wrapping a FakeAcpAgent. This drives the full server-side ACP
// path (dispatch → agent → peer notify/request) with no sockets.
function wire(agent = new FakeAcpAgent()) {
  const clientCodec = new JsonRpcCodec();
  const inbound: Array<{ method: string; params: Record<string, unknown> }> = [];
  let conn!: AcpConnection;

  // Client's view of the server: what the server sends, the client decodes.
  // Server-originated REQUESTS get auto-answered by `onRequest` if provided.
  let onRequest: ((method: string, params: Record<string, unknown>) => unknown) | null = null;

  const clientDuplex: Duplex = {
    send: (data) => {
      for (const msg of clientCodec.decode(data)) {
        if ('method' in msg) {
          const method = msg.method;
          const params = (msg.params ?? {}) as Record<string, unknown>;
          inbound.push({ method, params });
          if ('id' in msg && msg.id != null) {
            // server → client request: answer it back through the connection
            const result = onRequest ? onRequest(method, params) : {};
            conn.receive(clientCodec.encodeResponse(msg.id, result));
          }
        }
      }
    },
    close: () => {},
  };

  conn = new AcpConnection(clientDuplex, agent);

  // Helper: client sends a request to the server and resolves with its result.
  const clientRequest = <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const { id, payload } = clientCodec.encode(method, params);
    const pending = clientCodec.registerPending(id) as Promise<T>;
    conn.receive(payload);
    return pending;
  };

  const clientNotify = (method: string, params?: Record<string, unknown>) => {
    conn.receive(clientCodec.encodeNotification(method, params));
  };

  return {
    conn,
    inbound,
    clientRequest,
    clientNotify,
    setOnRequest: (fn: typeof onRequest) => { onRequest = fn; },
  };
}

describe('AcpConnection + FakeAcpAgent', () => {
  it('answers initialize with a protocol version and agent info', async () => {
    const h = wire();
    const result = await h.clientRequest<{ protocolVersion: number; agentInfo?: { name?: string } }>(
      Methods.INITIALIZE,
      { protocolVersion: 1 },
    );
    expect(result.protocolVersion).toBe(1);
    expect(result.agentInfo?.name).toBe('fake-acp-agent');
  });

  it('creates a session and streams the prompt reply as session/update chunks', async () => {
    const h = wire();
    const { sessionId } = await h.clientRequest<{ sessionId: string }>(Methods.SESSION_NEW, { cwd: '/repo', mcpServers: [] });
    expect(sessionId).toMatch(/^fake-sess-/);

    const result = await h.clientRequest<SessionPromptResult>(Methods.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: 'text', text: 'hello world' }],
    });
    expect(result.stopReason).toBe('end_turn');

    const updates = h.inbound.filter((m) => m.method === Methods.SESSION_UPDATE);
    expect(updates.length).toBeGreaterThan(0);
    const text = updates
      .map((u) => (u.params.update as { content?: { text?: string } }).content?.text ?? '')
      .join('');
    expect(text).toContain('hello world');
  });

  it('returns a JSON-RPC method-not-found error for unknown methods', async () => {
    const h = wire();
    await expect(h.clientRequest('does/not/exist', {})).rejects.toThrow(/method not found/i);
  });

  it('originates a permission request and honors an allow answer', async () => {
    const h = wire(new FakeAcpAgent({ requestPermission: true }));
    h.setOnRequest((method) => {
      if (method === Methods.SESSION_REQUEST_PERMISSION) return { outcome: { optionId: 'allow' } };
      return {};
    });
    const { sessionId } = await h.clientRequest<{ sessionId: string }>(Methods.SESSION_NEW, { cwd: '/r', mcpServers: [] });
    const result = await h.clientRequest<SessionPromptResult>(Methods.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: 'text', text: 'do it' }],
    });
    expect(h.inbound.some((m) => m.method === Methods.SESSION_REQUEST_PERMISSION)).toBe(true);
    expect(result.stopReason).toBe('end_turn');
  });

  it('refuses the turn when permission is rejected', async () => {
    const h = wire(new FakeAcpAgent({ requestPermission: true }));
    h.setOnRequest(() => ({ outcome: { optionId: 'reject' } }));
    const { sessionId } = await h.clientRequest<{ sessionId: string }>(Methods.SESSION_NEW, { cwd: '/r', mcpServers: [] });
    const result = await h.clientRequest<SessionPromptResult>(Methods.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: 'text', text: 'do it' }],
    });
    expect(result.stopReason).toBe('refusal');
  });

  it('cancels an in-flight turn via session/cancel notification', async () => {
    const agent = new FakeAcpAgent({ chunkDelayMs: 5 });
    const h = wire(agent);
    const { sessionId } = await h.clientRequest<{ sessionId: string }>(Methods.SESSION_NEW, { cwd: '/r', mcpServers: [] });
    const promptDone = h.clientRequest<SessionPromptResult>(Methods.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: 'text', text: 'a b c d e f g h' }],
    });
    // Cancel almost immediately, before all chunks stream.
    h.clientNotify(Methods.SESSION_CANCEL, { sessionId });
    const result = await promptDone;
    expect(result.stopReason).toBe('cancelled');
  });
});
