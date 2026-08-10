import { describe, it, expect } from 'vitest';
import { estimateContextBreakdown } from '../services/context-breakdown.js';
import type { TimelineItem } from '../services/acp-types.js';

function msg(role: 'user' | 'assistant', text: string, id = role[0]): TimelineItem {
  return { kind: 'message', id, role, text, ts: 0 };
}

describe('estimateContextBreakdown', () => {
  it('returns null when there is no usable window', () => {
    expect(estimateContextBreakdown([], null)).toBeNull();
    expect(estimateContextBreakdown([], { used: 0, size: 200_000 })).toBeNull();
    expect(estimateContextBreakdown([], { used: 100, size: 0 })).toBeNull();
  });

  it('segments always sum to the authoritative used total', () => {
    const items: TimelineItem[] = [
      msg('user', 'a'.repeat(400), 'u1'),
      msg('assistant', 'b'.repeat(800), 'a1'),
      { kind: 'thought', id: 't1', text: 'c'.repeat(200) },
      {
        kind: 'tool', id: 'tool1',
        tool: { toolCallId: 'x', title: 'Read', rawInput: { path: '/f' }, rawOutput: 'd'.repeat(1200) },
      },
    ];
    const b = estimateContextBreakdown(items, { used: 5000, size: 200_000 })!;
    const sum = b.segments.reduce((n, s) => n + s.tokens, 0);
    expect(sum).toBe(5000);
    expect(b.segments.every((s) => s.tokens > 0)).toBe(true);
  });

  it('books the shortfall to overhead when visible content is under used', () => {
    const items: TimelineItem[] = [msg('user', 'hello world')];
    const b = estimateContextBreakdown(items, { used: 10_000, size: 200_000 })!;
    const overhead = b.segments.find((s) => s.key === 'overhead');
    expect(overhead).toBeDefined();
    // Visible content is tiny, so nearly all of `used` is unexplained overhead.
    expect(overhead!.tokens).toBeGreaterThan(9_000);
  });

  it('scales categories down when the estimate exceeds used', () => {
    // ~2500 chars of assistant text ≈ 625 est tokens, but adapter reports 100.
    const items: TimelineItem[] = [msg('assistant', 'z'.repeat(10_000))];
    const b = estimateContextBreakdown(items, { used: 100, size: 200_000 })!;
    const sum = b.segments.reduce((n, s) => n + s.tokens, 0);
    expect(sum).toBe(100);
    expect(b.segments.find((s) => s.key === 'overhead')).toBeUndefined();
  });

  it('sorts segments by token weight descending', () => {
    const items: TimelineItem[] = [
      msg('user', 'u'.repeat(100), 'u1'),
      msg('assistant', 'a'.repeat(4000), 'a1'),
    ];
    const b = estimateContextBreakdown(items, { used: 3000, size: 200_000 })!;
    for (let i = 1; i < b.segments.length; i++) {
      expect(b.segments[i - 1].tokens).toBeGreaterThanOrEqual(b.segments[i].tokens);
    }
  });

  it('attributes tool calls including nested children', () => {
    const items: TimelineItem[] = [{
      kind: 'tool', id: 'tool1',
      tool: {
        toolCallId: 'parent', title: 'Task',
        rawInput: { prompt: 'p'.repeat(400) },
        children: [
          { toolCallId: 'c1', title: 'Grep', rawOutput: 'r'.repeat(2000) },
        ],
      },
    }];
    const b = estimateContextBreakdown(items, { used: 100_000, size: 200_000 })!;
    const tools = b.segments.find((s) => s.key === 'tools')!;
    // Child output (~500 tok) must be counted, so tools far exceeds the parent
    // input alone.
    expect(tools.tokens).toBeGreaterThan(500);
  });

  it('carries cost through when present', () => {
    const b = estimateContextBreakdown([msg('user', 'hi')], { used: 1000, size: 200_000, cost: 0.42 })!;
    expect(b.cost).toBe(0.42);
  });
});
