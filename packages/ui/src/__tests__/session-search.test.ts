import { describe, it, expect } from 'vitest';
import { matchesSessionQuery, filterSessions, orderSessionsForHistory, buildSessionSearchPrompt, findCitedSessions } from '../services/session-search.js';
import type { SessionEntry } from '../services/api.js';

function session(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: 'abc123def456',
    tool: 'claude',
    dir: '/Users/me/code/kairos-ui',
    title: 'Fix the login bug',
    firstActive: '2026-07-01T00:00:00Z',
    lastActive: '2026-07-02T00:00:00Z',
    messages: 12,
    active: false,
    firstMessage: 'The auth token expires too early and users get logged out',
    ...over,
  };
}

describe('matchesSessionQuery', () => {
  it('matches on title', () => {
    expect(matchesSessionQuery(session(), 'login')).toBe(true);
  });

  it('matches on firstMessage — the row preview, previously unsearched', () => {
    expect(matchesSessionQuery(session(), 'auth')).toBe(true);
    expect(matchesSessionQuery(session(), 'token')).toBe(true);
  });

  it('matches on dir and id', () => {
    expect(matchesSessionQuery(session(), 'kairos-ui')).toBe(true);
    expect(matchesSessionQuery(session(), 'abc123')).toBe(true);
  });

  it('requires every token but ignores word order (AND match)', () => {
    // "auth" is in the first message, "login" in the title — order irrelevant.
    expect(matchesSessionQuery(session(), 'auth login')).toBe(true);
    expect(matchesSessionQuery(session(), 'login auth')).toBe(true);
    // A token that appears nowhere fails the whole query.
    expect(matchesSessionQuery(session(), 'auth database')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesSessionQuery(session(), 'LOGIN')).toBe(true);
    expect(matchesSessionQuery(session(), 'AuTh ToKeN')).toBe(true);
  });

  it('treats an empty/whitespace query as a match-all', () => {
    expect(matchesSessionQuery(session(), '')).toBe(true);
    expect(matchesSessionQuery(session(), '   ')).toBe(true);
  });

  it('handles a missing firstMessage without throwing', () => {
    const s = session({ firstMessage: undefined });
    expect(matchesSessionQuery(s, 'login')).toBe(true);
    expect(matchesSessionQuery(s, 'auth')).toBe(false);
  });
});

describe('filterSessions', () => {
  const list = [
    session({ id: 's1', title: 'Fix login bug', firstMessage: 'auth token issue' }),
    session({ id: 's2', title: 'Add dark theme', firstMessage: 'toggle in settings' }),
    session({ id: 's3', title: 'Refactor parser', firstMessage: 'regex table detection' }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterSessions(list, '')).toHaveLength(3);
    expect(filterSessions(list, '   ')).toHaveLength(3);
  });

  it('narrows to matching sessions', () => {
    expect(filterSessions(list, 'auth').map((s) => s.id)).toEqual(['s1']);
    expect(filterSessions(list, 'theme settings').map((s) => s.id)).toEqual(['s2']);
    expect(filterSessions(list, 'nonexistent')).toHaveLength(0);
  });
});

describe('orderSessionsForHistory', () => {
  it('keeps pinned sessions before unpinned sessions', () => {
    const list = [
      session({ id: 'recent' }),
      session({ id: 'epic', pinned: true }),
      session({ id: 'bug' }),
    ];

    expect(orderSessionsForHistory(list).map((s) => s.id)).toEqual(['epic', 'recent', 'bug']);
  });

  it('preserves relative order within pinned and unpinned groups', () => {
    const list = [
      session({ id: 'a', pinned: true }),
      session({ id: 'b' }),
      session({ id: 'c', pinned: true }),
      session({ id: 'd' }),
    ];

    expect(orderSessionsForHistory(list).map((s) => s.id)).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('buildSessionSearchPrompt', () => {
  const list = [
    session({ id: 's1', title: 'Fix login bug' }),
    session({ id: 's2', title: 'Add dark theme', firstMessage: 'toggle in settings' }),
  ];

  it('embeds the query verbatim', () => {
    const p = buildSessionSearchPrompt('where did I fix that flaky test', list);
    expect(p).toContain('where did I fix that flaky test');
  });

  it('lists every candidate id so results are resume-able', () => {
    const p = buildSessionSearchPrompt('q', list);
    expect(p).toContain('id: s1');
    expect(p).toContain('id: s2');
  });

  it('tells the agent how to read transcripts and what to output', () => {
    const p = buildSessionSearchPrompt('q', list);
    expect(p).toContain('kairos sessions export');
    expect(p).toContain('--format md');
  });

  it('reports the candidate count', () => {
    expect(buildSessionSearchPrompt('q', list)).toContain('2 candidate');
  });
});

describe('findCitedSessions', () => {
  const candidates = [
    session({ id: 'aaaa1111bbbb2222', title: 'Login fix' }),
    session({ id: 'cccc3333dddd4444', title: 'Dark theme' }),
    session({ id: 'eeee5555ffff6666', title: 'Parser refactor' }),
  ];

  it('returns candidates cited by id, in the order they appear in the answer', () => {
    const answer =
      'Best match: cccc3333dddd4444 — Dark theme — you toggled it here.\n' +
      'Also possible: aaaa1111bbbb2222 — Login fix.';
    const out = findCitedSessions(answer, candidates);
    expect(out.map((s) => s.id)).toEqual(['cccc3333dddd4444', 'aaaa1111bbbb2222']);
  });

  it('ignores ids not in the candidate set (no free-form parsing)', () => {
    const answer = 'Try 9999xxxx8888yyyy — that one is not in the list.';
    expect(findCitedSessions(answer, candidates)).toEqual([]);
  });

  it('returns each cited session at most once', () => {
    const answer = 'eeee5555ffff6666 appears, and again eeee5555ffff6666.';
    const out = findCitedSessions(answer, candidates);
    expect(out.map((s) => s.id)).toEqual(['eeee5555ffff6666']);
  });

  it('handles an empty answer or empty candidate list', () => {
    expect(findCitedSessions('', candidates)).toEqual([]);
    expect(findCitedSessions('aaaa1111bbbb2222', [])).toEqual([]);
  });

  it('does not let a shorter id match inside a longer one', () => {
    const nested = [
      session({ id: 'abc' }),
      session({ id: 'abcdef123' }),
    ];
    // Only the long id is present; the short 'abc' is a substring of it but
    // shouldn't be reported as its own separate match.
    const out = findCitedSessions('The match is abcdef123.', nested);
    expect(out.map((s) => s.id)).toEqual(['abcdef123']);
  });
});
