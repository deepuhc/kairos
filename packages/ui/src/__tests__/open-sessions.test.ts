import { describe, expect, it } from 'vitest';
import {
  describeOpenSessions,
  mergeOpenSessionDescriptors,
  normalizeOpenSessionDescriptors,
  openSessionToEntry,
  type OpenSessionSource,
  type PersistedOpenSession,
} from '../services/open-sessions.js';

function live(id: string, patch: Partial<OpenSessionSource> = {}): OpenSessionSource {
  return {
    id,
    agentId: 'claude',
    cwd: '/repo',
    title: `Session ${id}`,
    phase: 'ready',
    loading: false,
    items: { length: 1 },
    ...patch,
  };
}

function persisted(id: string): PersistedOpenSession {
  return {
    id,
    agentId: 'claude',
    cwd: '/repo',
    title: `Session ${id}`,
    wasThinking: false,
  };
}

describe('open session persistence helpers', () => {
  it('persists only sessions that can be resumed from disk', () => {
    expect(describeOpenSessions([
      live('blank', { items: { length: 0 } }),
      live('loading', { items: { length: 0 }, loading: true }),
      live('durable'),
      live('thinking', { phase: 'thinking' }),
    ])).toEqual([
      { id: 'loading', agentId: 'claude', cwd: '/repo', title: 'Session loading', wasThinking: false },
      { id: 'durable', agentId: 'claude', cwd: '/repo', title: 'Session durable', wasThinking: false },
      { id: 'thinking', agentId: 'claude', cwd: '/repo', title: 'Session thinking', wasThinking: true },
    ]);
  });

  it('keeps live sessions first and appends unresolved previously-open sessions', () => {
    const merged = mergeOpenSessionDescriptors(
      [persisted('live-b'), persisted('live-a')],
      [persisted('live-a'), persisted('previous')],
    );

    expect(merged.map((s) => s.id)).toEqual(['live-b', 'live-a', 'previous']);
  });

  it('normalizes stored JSON and drops malformed entries', () => {
    expect(normalizeOpenSessionDescriptors([
      { id: 'ok', agentId: 'codex', cwd: '/repo', title: 'OK', wasThinking: true },
      { id: 'bad', agentId: 'codex', cwd: '/repo' },
      null,
      { id: 'wt', agentId: 'claude', cwd: '/wt', title: 'WT', wasThinking: false, worktree: { worktreePath: '/wt', branch: 'agent/x', repoRoot: '/repo' } },
    ])).toEqual([
      { id: 'ok', agentId: 'codex', cwd: '/repo', title: 'OK', wasThinking: true },
      { id: 'wt', agentId: 'claude', cwd: '/wt', title: 'WT', wasThinking: false, worktree: { worktreePath: '/wt', branch: 'agent/x', repoRoot: '/repo' } },
    ]);
  });

  it('maps a remembered descriptor back to a resumable session entry', () => {
    expect(openSessionToEntry({
      id: 'abc',
      agentId: 'gemini',
      cwd: '/repo',
      title: 'Fix parser',
      wasThinking: false,
    })).toMatchObject({
      id: 'abc',
      tool: 'gemini',
      dir: '/repo',
      title: 'Fix parser',
      active: false,
    });
  });
});
