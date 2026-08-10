import { describe, it, expect } from 'vitest';
import { deriveToolOptions, shortDir, friendlyError } from '../components/sessions.js';

describe('deriveToolOptions', () => {
  it('unions used and installed agents, sorted and deduped', () => {
    expect(deriveToolOptions(['codex', 'claude'], ['claude', 'gemini'])).toEqual([
      'claude', 'codex', 'gemini',
    ]);
  });

  it('drops empty/falsy tool ids', () => {
    expect(deriveToolOptions(['', 'claude'], ['', 'codex'])).toEqual(['claude', 'codex']);
  });

  it('accumulates onto previous so narrowing the filter never drops pills', () => {
    // Second load returns only 'claude' sessions, but the previously-seen
    // 'codex'/'gemini' pills must remain offered.
    const first = deriveToolOptions(['claude', 'codex', 'gemini'], []);
    const afterNarrowing = deriveToolOptions(['claude'], [], first);
    expect(afterNarrowing).toEqual(['claude', 'codex', 'gemini']);
  });

  it('returns an empty list when nothing is used or installed', () => {
    expect(deriveToolOptions([], [])).toEqual([]);
  });
});

describe('shortDir', () => {
  it('tilde-shortens the current user home when the username is known', () => {
    expect(shortDir('/Users/ddeepak/projects/kairos', 'ddeepak')).toBe('~/projects/kairos');
  });

  it('does NOT fabricate /Users/undefined when the username is missing (regression)', () => {
    // The old `'/Users/' + user || ''` bug made home = '/Users/undefined',
    // which is truthy — this path must fall through to the regex instead.
    expect(shortDir('/Users/someone/repo', undefined)).toBe('~/repo');
    expect(shortDir('/Users/undefined/repo', undefined)).toBe('~/repo');
  });

  it('falls back to a best-effort regex for other users and linux homes', () => {
    expect(shortDir('/Users/alice/code', 'bob')).toBe('~/code');
    expect(shortDir('/home/carol/code', 'bob')).toBe('~/code');
  });

  it('leaves non-home paths untouched', () => {
    expect(shortDir('/opt/data', 'ddeepak')).toBe('/opt/data');
  });
});

describe('friendlyError', () => {
  it('reframes a bare "Not Found" as an availability message', () => {
    expect(friendlyError('Not Found')).toMatch(/unavailable/i);
    expect(friendlyError('404')).toMatch(/unavailable/i);
  });

  it('reframes network failures with a reachability hint', () => {
    expect(friendlyError('Failed to fetch')).toMatch(/reach the server/i);
  });

  it('passes through an already-meaningful message', () => {
    expect(friendlyError('Disk quota exceeded')).toBe('Disk quota exceeded');
  });

  it('treats an empty message as an availability problem', () => {
    expect(friendlyError('')).toMatch(/unavailable/i);
  });
});
