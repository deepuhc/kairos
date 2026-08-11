import { describe, it, expect } from 'vitest';
import { JsonRpcCodec } from '../codec.js';
import {
  Methods,
  type InitializeParams,
  type InitializeResult,
  type SessionNewParams,
  type SessionNewResult,
  type SessionPromptParams,
  type SessionPromptResult,
  type SessionUpdateParams,
  type RequestPermissionParams,
  type SessionCancelParams,
} from '../types.js';

// These assertions pin @kairos/protocol to the wire contract the shipped UI
// actually speaks (packages/ui/src/services/acp.ts). If the UI method names or
// param shapes drift, this test must break — that's the point.

describe('ACP method names match acp.ts', () => {
  it('exposes exactly the methods the UI uses', () => {
    expect(Methods.INITIALIZE).toBe('initialize');
    expect(Methods.AUTHENTICATE).toBe('authenticate');
    expect(Methods.SESSION_NEW).toBe('session/new');
    expect(Methods.SESSION_LOAD).toBe('session/load');
    expect(Methods.SESSION_PROMPT).toBe('session/prompt');
    expect(Methods.SESSION_SET_CONFIG_OPTION).toBe('session/set_config_option');
    expect(Methods.SESSION_CANCEL).toBe('session/cancel');
    expect(Methods.SESSION_REQUEST_PERMISSION).toBe('session/request_permission');
    expect(Methods.ELICITATION_CREATE).toBe('elicitation/create');
    expect(Methods.SESSION_UPDATE).toBe('session/update');
    expect(Methods.EXT_LOG).toBe('_ext/log');
    expect(Methods.EXT_STALLED).toBe('_ext/stalled');
    expect(Methods.EXT_TERMINAL_OUTPUT).toBe('_ext/terminal_output');
  });

  it('uses camelCase params (cwd/mcpServers, not working_directory)', () => {
    // Compile-time: these object literals must satisfy the exported types.
    const init: InitializeParams = {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'kairos', title: 'Kairos', version: '2.0.0' },
    };
    const newParams: SessionNewParams = { cwd: '/repo', mcpServers: [] };
    const prompt: SessionPromptParams = {
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'hello' }],
    };
    expect(init.clientInfo?.name).toBe('kairos');
    expect(newParams).toHaveProperty('cwd');
    expect(newParams).not.toHaveProperty('working_directory');
    expect(prompt.prompt[0]).toMatchObject({ type: 'text' });
  });
});

describe('codec round-trips ACP frames', () => {
  it('encodes initialize as a JSON-RPC request the peer can decode', () => {
    const client = new JsonRpcCodec();
    const server = new JsonRpcCodec();

    const initParams: InitializeParams = {
      protocolVersion: 1,
      clientInfo: { name: 'kairos', version: '2.0.0' },
    };
    const { id, payload } = client.encode(Methods.INITIALIZE, initParams as unknown as Record<string, unknown>);

    const [decoded] = server.decode(payload);
    expect(decoded).toMatchObject({ jsonrpc: '2.0', id, method: 'initialize' });

    // Server answers; client correlates the pending request.
    const pending = client.registerPending(id);
    const result: InitializeResult = { protocolVersion: 1, authMethods: [] };
    client.decode(server.encodeResponse(id, result));
    return expect(pending).resolves.toMatchObject({ protocolVersion: 1 });
  });

  it('encodes session/new → result and session/prompt → stopReason', async () => {
    const client = new JsonRpcCodec();
    const server = new JsonRpcCodec();

    const { id: newId, payload: newPayload } = client.encode(
      Methods.SESSION_NEW,
      { cwd: '/repo', mcpServers: [] } satisfies SessionNewParams as unknown as Record<string, unknown>,
    );
    expect(server.decode(newPayload)[0]).toMatchObject({ method: 'session/new' });
    const newPending = client.registerPending(newId);
    const newResult: SessionNewResult = { sessionId: 'sess-1' };
    client.decode(server.encodeResponse(newId, newResult));
    await expect(newPending).resolves.toMatchObject({ sessionId: 'sess-1' });

    const { id: pId, payload: pPayload } = client.encode(
      Methods.SESSION_PROMPT,
      { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hi' }] } satisfies SessionPromptParams as unknown as Record<string, unknown>,
    );
    expect(server.decode(pPayload)[0]).toMatchObject({ method: 'session/prompt' });
    const pPending = client.registerPending(pId);
    const pResult: SessionPromptResult = { stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } };
    client.decode(server.encodeResponse(pId, pResult));
    await expect(pPending).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('encodes session/update and session/cancel as notifications (no id)', () => {
    const server = new JsonRpcCodec();
    const client = new JsonRpcCodec();

    const updateParams: SessionUpdateParams = {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } },
    };
    const updateFrame = server.encodeNotification(Methods.SESSION_UPDATE, updateParams as unknown as Record<string, unknown>);
    const [update] = client.decode(updateFrame);
    expect(update).toMatchObject({ jsonrpc: '2.0', method: 'session/update' });
    expect('id' in (update as object)).toBe(false);

    const cancelParams: SessionCancelParams = { sessionId: 'sess-1' };
    const cancelFrame = client.encodeNotification(Methods.SESSION_CANCEL, cancelParams as unknown as Record<string, unknown>);
    const [cancel] = server.decode(cancelFrame);
    expect(cancel).toMatchObject({ method: 'session/cancel' });
  });

  it('models a server-originated permission request the client answers', async () => {
    const server = new JsonRpcCodec();
    const client = new JsonRpcCodec();

    // Server → client REQUEST (bidirectional): the agent asks for permission.
    const permParams: RequestPermissionParams = {
      sessionId: 'sess-1',
      toolCall: { toolCallId: 'tc-1', title: 'write file', kind: 'edit' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    };
    const { id, payload } = server.encode(
      Methods.SESSION_REQUEST_PERMISSION,
      permParams as unknown as Record<string, unknown>,
    );
    const [req] = client.decode(payload);
    expect(req).toMatchObject({ method: 'session/request_permission', id });

    // Client answers; server correlates.
    const pending = server.registerPending(id);
    server.decode(client.encodeResponse(id, { outcome: { optionId: 'allow' } }));
    await expect(pending).resolves.toMatchObject({ outcome: { optionId: 'allow' } });
  });
});
