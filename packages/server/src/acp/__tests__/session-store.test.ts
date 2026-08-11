import { describe, it, expect } from 'vitest';
import { SessionStore } from '../session-store.js';

describe('SessionStore', () => {
  it('creates sessions with unique, monotonically increasing ids', () => {
    const store = new SessionStore();
    const a = store.create();
    const b = store.create();
    expect(a.sessionId).toBe('sess-1');
    expect(b.sessionId).toBe('sess-2');
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('starts a created session with empty history', () => {
    const store = new SessionStore();
    const { sessionId } = store.create();
    expect(store.has(sessionId)).toBe(true);
    expect(store.get(sessionId)).toEqual([]);
  });

  it('load() returns the live history array for an existing session', () => {
    const store = new SessionStore();
    const { sessionId } = store.create();
    store.set(sessionId, [{ role: 'user', content: 'hi' }]);
    expect(store.load(sessionId)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('load() creates an empty session for an unknown id (resume-after-restart)', () => {
    const store = new SessionStore();
    expect(store.has('sess-99')).toBe(false);
    expect(store.load('sess-99')).toEqual([]);
    expect(store.has('sess-99')).toBe(true);
  });

  it('get() returns undefined for a session that was never created', () => {
    const store = new SessionStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('set() replaces a session history', () => {
    const store = new SessionStore();
    const { sessionId } = store.create();
    store.set(sessionId, [{ role: 'assistant', content: 'done' }]);
    expect(store.get(sessionId)).toEqual([{ role: 'assistant', content: 'done' }]);
  });
});
