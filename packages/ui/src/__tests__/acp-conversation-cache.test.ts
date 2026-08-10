import { describe, expect, it } from 'vitest';
import { Conversation } from '../services/acp-conversation.js';
import type { TimelineItem } from '../services/acp-types.js';

function firstAssistantText(items: TimelineItem[]): string {
  const item = items[0];
  if (!item || item.kind !== 'message' || item.role !== 'assistant') {
    throw new Error('expected first item to be an assistant message');
  }
  return item.text;
}

describe('Conversation cache usage', () => {
  it('accumulates per-turn cache usage across turns and derives the hit rate', () => {
    const c = new Conversation();
    expect(c.usage).toBeNull();

    c.addTurnUsage({ inputTokens: 1000, outputTokens: 500, cachedReadTokens: 2000, cachedWriteTokens: 8000 });
    c.addTurnUsage({ inputTokens: 500, outputTokens: 300, cachedReadTokens: 12000, cachedWriteTokens: 0 });

    expect(c.usage?.cache).toEqual({
      cachedRead: 14000,
      cachedWrite: 8000,
      input: 1500,
      output: 800,
      hitRate: 14000 / 15500,
    });
  });

  it('leaves cache undefined for adapters that report no cache activity', () => {
    const c = new Conversation();
    c.addTurnUsage({ inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 });
    c.addTurnUsage(undefined);
    expect(c.usage).toBeNull();
  });

  it('reports cache signals: median turn gap and compaction', () => {
    const c = new Conversation();
    c.addTurnUsage({ cachedReadTokens: 100, inputTokens: 100 }, 0);
    c.addTurnUsage({ cachedReadTokens: 100, inputTokens: 100 }, 60_000);
    c.addTurnUsage({ cachedReadTokens: 100, inputTokens: 100 }, 600_000);

    let sig = c.cacheSignals();
    expect(sig.turns).toBe(3);
    expect(sig.medianTurnGapSec).toBe(300);
    expect(sig.compacted).toBe(false);

    c.apply({ sessionUpdate: 'usage_update', used: 150000, size: 200000 });
    c.apply({ sessionUpdate: 'usage_update', used: 20000, size: 200000 });
    sig = c.cacheSignals();
    expect(sig.compacted).toBe(true);
  });

  it('folds cache totals alongside a later usage_update snapshot', () => {
    const c = new Conversation();
    c.addTurnUsage({ inputTokens: 1000, cachedReadTokens: 3000, cachedWriteTokens: 0, outputTokens: 200 });
    c.apply({ sessionUpdate: 'usage_update', used: 4200, size: 200000, cost: { amount: 0.01 } });
    expect(c.usage).toMatchObject({ used: 4200, size: 200000, cost: 0.01 });
    expect(c.usage?.cache).toMatchObject({ cachedRead: 3000, input: 1000 });
  });
});

describe('Conversation text streaming', () => {
  it('keeps the timeline array stable while streaming into the last message', () => {
    const c = new Conversation();
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });

    const items = c.items;
    const firstItem = c.items[0];
    const version = c.version;
    const structureVersion = c.structureVersion;

    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } });

    expect(c.items).toBe(items);
    expect(c.items[0]).not.toBe(firstItem);
    expect(c.version).toBe(version + 1);
    expect(c.structureVersion).toBe(structureVersion);
    expect(firstAssistantText(c.items)).toBe('hello world');
  });

  it('does not bump versions for duplicate accumulated assistant chunks', () => {
    const c = new Conversation();
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
    const version = c.version;
    const structureVersion = c.structureVersion;

    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });

    expect(c.version).toBe(version);
    expect(c.structureVersion).toBe(structureVersion);
    expect(firstAssistantText(c.items)).toBe('hello');
  });

  it('repairs trimmed sentence boundaries across assistant chunks', () => {
    const c = new Conversation();
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It behaves normally.' } });
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The next step is safe.' } });

    expect(firstAssistantText(c.items)).toBe('It behaves normally. The next step is safe.');
  });

  it('does not add a second space when the next chunk already has whitespace', () => {
    const c = new Conversation();
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It behaves normally.' } });
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' The next step is safe.' } });

    expect(firstAssistantText(c.items)).toBe('It behaves normally. The next step is safe.');
  });

  it('does not repair lowercase boundaries such as file extensions', () => {
    const c = new Conversation();
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Open app.' } });
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ts for the component.' } });

    expect(firstAssistantText(c.items)).toBe('Open app.ts for the component.');
  });

  it('does not insert spaces inside open fenced code blocks', () => {
    const c = new Conversation();
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '```ts\nFoo.' } });
    c.apply({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Bar\n```' } });

    expect(firstAssistantText(c.items)).toBe('```ts\nFoo.Bar\n```');
  });
});
