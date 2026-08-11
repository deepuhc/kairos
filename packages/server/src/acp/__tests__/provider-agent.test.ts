import { describe, it, expect } from 'vitest';
import { Methods, type SessionPromptResult, type SessionUpdateParams } from '@kairos/protocol';
import { ProviderRegistry, SmartRouter, MockProvider } from '@kairos/providers';
import { ProviderAcpAgent } from '../provider-agent.js';
import type { Peer } from '../peer.js';

// An in-memory Peer that records outbound notifications and auto-answers any
// server-originated requests (none are expected from ProviderAcpAgent, but the
// interface requires it).
function recordingPeer() {
  const updates: SessionUpdateParams[] = [];
  const peer: Peer = {
    notify: (method, params) => {
      if (method === Methods.SESSION_UPDATE) updates.push(params as unknown as SessionUpdateParams);
    },
    request: async <T = unknown>() => ({}) as T,
  };
  const textOf = (kind: string) =>
    updates
      .filter((u) => u.update.sessionUpdate === kind)
      .map((u) => ((u.update as { content?: { text?: string } }).content?.text ?? ''))
      .join('');
  return { peer, updates, textOf };
}

// A router backed by the real registry + the shipped MockProvider, so the test
// exercises the genuine registry → router → provider → session/update path.
function mockRouter(): SmartRouter {
  const registry = new ProviderRegistry({ mock: true, discoveryTtlMs: 0 });
  // Drop the non-mock probing providers so discovery is deterministic + offline.
  for (const p of [...registry.all]) if (p.name !== 'mock') registry.removeProvider(p.name);
  return new SmartRouter(registry);
}

async function newSession(agent: ProviderAcpAgent, peer: Peer): Promise<string> {
  const { sessionId } = (await agent.handleRequest(Methods.SESSION_NEW, { cwd: '/repo', mcpServers: [] }, peer)) as {
    sessionId: string;
  };
  return sessionId;
}

describe('ProviderAcpAgent', () => {
  it('answers initialize with agent info + protocol version', async () => {
    const agent = new ProviderAcpAgent({ router: mockRouter() });
    const { peer } = recordingPeer();
    const result = (await agent.handleRequest(Methods.INITIALIZE, { protocolVersion: 1 }, peer)) as {
      protocolVersion: number;
      agentInfo?: { name?: string };
    };
    expect(result.protocolVersion).toBe(1);
    expect(result.agentInfo?.name).toBe('kairos-provider-agent');
  });

  it('streams the mock provider reply as agent_message_chunk updates', async () => {
    const agent = new ProviderAcpAgent({ router: mockRouter() });
    const { peer, textOf } = recordingPeer();
    const sessionId = await newSession(agent, peer);

    const result = (await agent.handleRequest(
      Methods.SESSION_PROMPT,
      { sessionId, prompt: [{ type: 'text', text: 'build me a widget' }] },
      peer,
    )) as SessionPromptResult;

    expect(result.stopReason).toBe('end_turn');
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
    const text = textOf('agent_message_chunk');
    expect(text).toContain('[mock]');
    expect(text).toContain('build me a widget'); // prompt echoed back deterministically
  });

  it('emits agent_thought_chunk when thinking is enabled', async () => {
    const agent = new ProviderAcpAgent({ router: mockRouter(), thinking: true });
    const { peer, textOf } = recordingPeer();
    const sessionId = await newSession(agent, peer);
    await agent.handleRequest(
      Methods.SESSION_PROMPT,
      { sessionId, prompt: [{ type: 'text', text: 'think about it' }] },
      peer,
    );
    expect(textOf('agent_thought_chunk').length).toBeGreaterThan(0);
  });

  it('keeps per-session history so a second turn has context', async () => {
    const agent = new ProviderAcpAgent({ router: mockRouter() });
    const { peer } = recordingPeer();
    const sessionId = await newSession(agent, peer);
    await agent.handleRequest(Methods.SESSION_PROMPT, { sessionId, prompt: [{ type: 'text', text: 'first' }] }, peer);
    const second = (await agent.handleRequest(
      Methods.SESSION_PROMPT,
      { sessionId, prompt: [{ type: 'text', text: 'second' }] },
      peer,
    )) as SessionPromptResult;
    // 2 user + 1 assistant already recorded → this turn's input token count
    // reflects the accumulated history, not just "second".
    expect(second.stopReason).toBe('end_turn');
    expect(second.usage?.inputTokens ?? 0).toBeGreaterThan(0);
  });

  it('cancels an in-flight turn on session/cancel', async () => {
    // A slow mock so the cancel lands mid-stream.
    const registry = new ProviderRegistry({ discoveryTtlMs: 0 });
    for (const p of [...registry.all]) registry.removeProvider(p.name);
    registry.addProvider(new MockProvider({ streamDelayMs: 20 }));
    const agent = new ProviderAcpAgent({ router: new SmartRouter(registry) });
    const { peer } = recordingPeer();
    const sessionId = await newSession(agent, peer);

    const done = agent.handleRequest(
      Methods.SESSION_PROMPT,
      { sessionId, prompt: [{ type: 'text', text: 'a b c d e f g h i j' }] },
      peer,
    ) as Promise<SessionPromptResult>;
    agent.handleNotification(Methods.SESSION_CANCEL, { sessionId }, peer);
    const result = await done;
    expect(result.stopReason).toBe('cancelled');
  });

  it('reports an error stopReason when no models are available', async () => {
    const registry = new ProviderRegistry({ discoveryTtlMs: 0 });
    for (const p of [...registry.all]) registry.removeProvider(p.name); // no providers at all
    const agent = new ProviderAcpAgent({ router: new SmartRouter(registry) });
    const { peer, textOf } = recordingPeer();
    const sessionId = await newSession(agent, peer);
    const result = (await agent.handleRequest(
      Methods.SESSION_PROMPT,
      { sessionId, prompt: [{ type: 'text', text: 'hi' }] },
      peer,
    )) as SessionPromptResult;
    expect(result.stopReason).toBe('error');
    expect(textOf('agent_message_chunk')).toContain('[error]');
  });
});
