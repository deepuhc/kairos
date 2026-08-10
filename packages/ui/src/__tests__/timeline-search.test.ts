import { describe, expect, it } from 'vitest';
import {
  collectMatches,
  countOccurrences,
  itemSearchText,
  locateMatch,
  totalMatches,
} from '../services/timeline-search.js';
import type { TimelineItem } from '../services/acp-types.js';

// Assistant text is normally markdown-stripped by the view; in tests we pass the
// markdown through verbatim so the arithmetic is what's under test.
const identity = (_id: string, md: string) => md;

const items: TimelineItem[] = [
  { kind: 'message', id: 'm1', role: 'user', text: 'fix the login bug please', ts: 0 },
  { kind: 'message', id: 'm2', role: 'assistant', text: 'The login flow calls login() twice.', ts: 0 },
  { kind: 'thought', id: 't1', text: 'checking the login handler' },
  { kind: 'tool', id: 'tool1', tool: { toolCallId: 'x', title: 'grep login' } },
  { kind: 'note', id: 'n1', text: 'session resumed' },
];

describe('countOccurrences', () => {
  it('counts non-overlapping matches, case handled by caller', () => {
    expect(countOccurrences('login login login', 'login')).toBe(3);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('nothing here', 'zzz')).toBe(0);
  });

  it('returns 0 for an empty needle', () => {
    expect(countOccurrences('anything', '')).toBe(0);
  });
});

describe('itemSearchText', () => {
  it('returns verbatim text for user messages, thoughts, and notes', () => {
    expect(itemSearchText(items[0], identity)).toBe('fix the login bug please');
    expect(itemSearchText(items[2], identity)).toBe('checking the login handler');
    expect(itemSearchText(items[4], identity)).toBe('session resumed');
  });

  it('routes assistant messages through the plain-text resolver', () => {
    const calls: string[] = [];
    itemSearchText(items[1], (id) => { calls.push(id); return 'resolved'; });
    expect(calls).toEqual(['m2']);
  });

  it('excludes tool calls and other non-conversational items', () => {
    expect(itemSearchText(items[3], identity)).toBe('');
  });
});

describe('collectMatches', () => {
  it('finds matches across message/thought/note items, case-insensitively', () => {
    const matches = collectMatches(items, 'LOGIN', identity);
    expect(matches).toEqual([
      { id: 'm1', count: 1 },
      { id: 'm2', count: 2 },
      { id: 't1', count: 1 },
    ]);
    expect(totalMatches(matches)).toBe(4);
  });

  it('returns nothing for an empty query', () => {
    expect(collectMatches(items, '', identity)).toEqual([]);
  });

  it('skips tool calls even when their title would match', () => {
    const matches = collectMatches(items, 'grep', identity);
    expect(matches).toEqual([]);
  });
});

describe('locateMatch', () => {
  const matches = collectMatches(items, 'login', identity);

  it('maps a global occurrence index to its item and local offset', () => {
    expect(locateMatch(matches, 0)).toEqual({ id: 'm1', local: 0 });
    expect(locateMatch(matches, 1)).toEqual({ id: 'm2', local: 0 });
    expect(locateMatch(matches, 2)).toEqual({ id: 'm2', local: 1 });
    expect(locateMatch(matches, 3)).toEqual({ id: 't1', local: 0 });
  });

  it('returns null when the index is out of range', () => {
    expect(locateMatch(matches, 4)).toBeNull();
    expect(locateMatch(matches, -1)).toBeNull();
  });
});
