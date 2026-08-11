import { describe, it, expect, vi } from 'vitest';
import { Methods } from '@kairos/protocol';
import { StdioAcpAgent, type ChildIo } from '../stdio-bridge.js';
import type { Peer } from '../peer.js';

// A fake child that lets the test drive stdout/stderr/exit and capture stdin.
class FakeChild implements ChildIo {
  writes: string[] = [];
  killed = false;
  private stdout: ((c: string) => void) | null = null;
  private stderr: ((c: string) => void) | null = null;
  private exit: ((code: number | null) => void) | null = null;

  write(frame: string): void { this.writes.push(frame); }
  onStdout(cb: (c: string) => void): void { this.stdout = cb; }
  onStderr(cb: (c: string) => void): void { this.stderr = cb; }
  onExit(cb: (code: number | null) => void): void { this.exit = cb; }
  kill(): void { this.killed = true; }

  // Test drivers:
  emitStdout(frame: string): void { this.stdout?.(frame); }
  emitStderr(text: string): void { this.stderr?.(text); }
  emitExit(code: number | null): void { this.exit?.(code); }

  /** The last stdin frame, parsed. */
  lastWrite(): { id?: number; method?: string; params?: unknown; result?: unknown } {
    return JSON.parse(this.writes[this.writes.length - 1]);
  }
}

function recordingPeer() {
  const notifications: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let answerNext: (params?: Record<string, unknown>) => unknown = () => ({});
  const peer: Peer = {
    notify: (method, params) => { notifications.push({ method, params }); },
    request: async <T = unknown>(method: string, params?: Record<string, unknown>) => {
      requests.push({ method, params });
      return answerNext(params) as T;
    },
  };
  return { peer, notifications, requests, setAnswer: (fn: (p?: Record<string, unknown>) => unknown) => { answerNext = fn; } };
}

describe('StdioAcpAgent (stdio ↔ client proxy)', () => {
  it('forwards a client request to the child and resolves with the child response', async () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer } = recordingPeer();

    const pending = agent.handleRequest(Methods.INITIALIZE, { protocolVersion: 1 }, peer);
    // The child saw the forwarded request (with the proxy's own id).
    const sent = child.lastWrite();
    expect(sent.method).toBe('initialize');
    expect(typeof sent.id).toBe('number');

    // Child replies on stdout → the forwarded promise resolves.
    child.emitStdout(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { protocolVersion: 1 } }) + '\n');
    await expect(pending).resolves.toEqual({ protocolVersion: 1 });
  });

  it('expands a ~ cwd in forwarded request params (adapters require an absolute cwd)', async () => {
    const { homedir } = await import('node:os');
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer } = recordingPeer();
    agent.handleRequest(Methods.SESSION_NEW, { cwd: '~', mcpServers: [] }, peer);
    expect(child.lastWrite().params).toMatchObject({ cwd: homedir() });
  });

  it('forwards client notifications to the child stdin', () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer } = recordingPeer();
    agent.handleNotification(Methods.SESSION_CANCEL, { sessionId: 's1' }, peer);
    expect(child.lastWrite()).toMatchObject({ method: 'session/cancel', params: { sessionId: 's1' } });
  });

  it('routes a child-originated notification (session/update) to the client peer', async () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer, notifications } = recordingPeer();
    // Attach the peer via any inbound request first.
    agent.handleNotification(Methods.SESSION_CANCEL, {}, peer);

    child.emitStdout(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } },
    }) + '\n');

    expect(notifications.find((n) => n.method === 'session/update')).toBeTruthy();
  });

  it('forwards a child-originated request to the client and returns its answer to the child', async () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer, setAnswer } = recordingPeer();
    setAnswer(() => ({ outcome: { optionId: 'allow' } }));
    agent.handleNotification(Methods.SESSION_CANCEL, {}, peer); // attach peer

    child.emitStdout(JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'session/request_permission',
      params: { sessionId: 's1', options: [{ optionId: 'allow' }] },
    }) + '\n');

    // The client's answer is written back to the child stdin as a response to id 7.
    await vi.waitFor(() => {
      const resp = child.writes.map((w) => JSON.parse(w)).find((m) => m.id === 7 && 'result' in m);
      expect(resp?.result).toEqual({ outcome: { optionId: 'allow' } });
    });
  });

  it('surfaces child stderr as an _ext/log notification', () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer, notifications } = recordingPeer();
    agent.handleNotification(Methods.SESSION_CANCEL, {}, peer); // attach peer
    child.emitStderr('adapter warning: something\n');
    const log = notifications.find((n) => n.method === Methods.EXT_LOG);
    expect(log?.params).toMatchObject({ stream: 'stderr' });
  });

  it('kills the child on close and rejects in-flight requests', async () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer } = recordingPeer();
    const pending = agent.handleRequest(Methods.SESSION_PROMPT, { sessionId: 's', prompt: [] }, peer);
    agent.close();
    expect(child.killed).toBe(true);
    await expect(pending).rejects.toThrow();
  });

  it('rejects requests made after the child has exited', async () => {
    const child = new FakeChild();
    const agent = new StdioAcpAgent(child);
    const { peer } = recordingPeer();
    child.emitExit(1);
    await expect(agent.handleRequest(Methods.INITIALIZE, {}, peer)).rejects.toThrow(/exited/);
  });
});
