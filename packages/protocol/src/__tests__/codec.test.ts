import { describe, it, expect } from 'vitest';
import { JsonRpcCodec } from '../codec.js';
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from '../types.js';

describe('JsonRpcCodec — encoding', () => {
  it('encodes a request with an auto-incrementing id and trailing newline', () => {
    const codec = new JsonRpcCodec();
    const a = codec.encode('session/new', { cwd: '/tmp' });
    const b = codec.encode('session/prompt');
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(a.payload.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(a.payload) as JsonRpcRequest;
    expect(parsed).toEqual({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp' } });
  });

  it('encodes a notification with no id', () => {
    const codec = new JsonRpcCodec();
    const payload = codec.encodeNotification('session/cancel', { sessionId: 's1' });
    const parsed = JSON.parse(payload) as JsonRpcNotification;
    expect(parsed).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's1' } });
    expect('id' in parsed).toBe(false);
  });

  it('encodes success and error responses', () => {
    const codec = new JsonRpcCodec();
    const ok = JSON.parse(codec.encodeResponse(5, { done: true })) as JsonRpcResponse;
    expect(ok).toEqual({ jsonrpc: '2.0', id: 5, result: { done: true } });

    const err = JSON.parse(codec.encodeResponse(6, undefined, { code: -32601, message: 'Method not found' })) as JsonRpcResponse;
    expect(err).toEqual({ jsonrpc: '2.0', id: 6, error: { code: -32601, message: 'Method not found' } });
  });
});

describe('JsonRpcCodec — decoding & framing', () => {
  it('decodes a single newline-terminated message', () => {
    const codec = new JsonRpcCodec();
    const msgs = codec.decode('{"jsonrpc":"2.0","method":"ping"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ method: 'ping' });
  });

  it('decodes multiple messages framed in one chunk', () => {
    const codec = new JsonRpcCodec();
    const chunk = '{"jsonrpc":"2.0","method":"a"}\n{"jsonrpc":"2.0","method":"b"}\n';
    const msgs = codec.decode(chunk);
    expect(msgs.map((m: any) => m.method)).toEqual(['a', 'b']);
  });

  it('buffers a partial message across chunks (split mid-frame)', () => {
    const codec = new JsonRpcCodec();
    // First chunk ends mid-JSON — no complete line yet.
    expect(codec.decode('{"jsonrpc":"2.0","me')).toEqual([]);
    // Second chunk completes the frame.
    const msgs = codec.decode('thod":"resume"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ method: 'resume' });
  });

  it('holds an unterminated trailing message until its newline arrives', () => {
    const codec = new JsonRpcCodec();
    const first = codec.decode('{"jsonrpc":"2.0","method":"a"}\n{"jsonrpc":"2.0","method":"b"}');
    expect(first.map((m: any) => m.method)).toEqual(['a']); // 'b' has no newline yet
    const second = codec.decode('\n');
    expect(second.map((m: any) => m.method)).toEqual(['b']);
  });

  it('skips blank lines and malformed JSON without throwing', () => {
    const codec = new JsonRpcCodec();
    const msgs = codec.decode('\n  \nnot json\n{"jsonrpc":"2.0","method":"ok"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ method: 'ok' });
  });
});

describe('JsonRpcCodec — request/response correlation', () => {
  it('resolves a pending request when its matching response is decoded', async () => {
    const codec = new JsonRpcCodec();
    const { id } = codec.encode('session/new');
    const pending = codec.registerPending(id);
    expect(codec.pendingCount).toBe(1);

    codec.decode(codec.encodeResponse(id, { sessionId: 's42' }));
    await expect(pending).resolves.toEqual({ sessionId: 's42' });
    expect(codec.pendingCount).toBe(0);
  });

  it('rejects a pending request when an error response is decoded', async () => {
    const codec = new JsonRpcCodec();
    const { id } = codec.encode('authenticate');
    const pending = codec.registerPending(id);

    codec.decode(codec.encodeResponse(id, undefined, { code: -32000, message: 'Unauthorized' }));
    await expect(pending).rejects.toThrow('Unauthorized');
  });

  it('does not settle a pending request against an inbound request that shares the id shape', async () => {
    const codec = new JsonRpcCodec();
    const { id } = codec.encode('session/prompt');
    const pending = codec.registerPending(id);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });

    // An inbound REQUEST (has `method`) with the same id must NOT resolve the pending response.
    codec.decode(`{"jsonrpc":"2.0","id":${id},"method":"session/request_permission"}\n`);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(codec.pendingCount).toBe(1);
  });

  it('reset() rejects all pending requests and clears the buffer', async () => {
    const codec = new JsonRpcCodec();
    const p1 = codec.registerPending(codec.encode('a').id);
    const p2 = codec.registerPending(codec.encode('b').id);
    codec.decode('{"partial'); // leave something in the buffer
    codec.reset();

    await expect(p1).rejects.toThrow('Connection reset');
    await expect(p2).rejects.toThrow('Connection reset');
    expect(codec.pendingCount).toBe(0);
    // Buffer was cleared: the earlier partial does not combine with a new frame.
    const msgs = codec.decode('"}\n{"jsonrpc":"2.0","method":"fresh"}\n');
    expect(msgs.some((m: any) => m.method === 'fresh')).toBe(true);
  });
});
