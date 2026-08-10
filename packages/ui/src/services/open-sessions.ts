import type { SessionEntry } from './api.js';

export interface PersistedOpenSession {
  id: string;
  agentId: string;
  cwd: string;
  title: string;
  wasThinking: boolean;
  /** Provenance for an app-created worktree, so restore can adopt/clean it. */
  worktree?: { worktreePath: string; branch: string; repoRoot: string };
}

export interface OpenSessionSource {
  id: string;
  agentId: string;
  cwd: string;
  title: string;
  phase: string;
  loading: boolean;
  items: { length: number };
  worktree?: PersistedOpenSession['worktree'];
}

function validWorktree(value: unknown): PersistedOpenSession['worktree'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const wt = value as Record<string, unknown>;
  return typeof wt.worktreePath === 'string'
    && typeof wt.branch === 'string'
    && typeof wt.repoRoot === 'string'
    ? { worktreePath: wt.worktreePath, branch: wt.branch, repoRoot: wt.repoRoot }
    : undefined;
}

export function normalizeOpenSessionDescriptors(value: unknown): PersistedOpenSession[] {
  if (!Array.isArray(value)) return [];
  const out: PersistedOpenSession[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (
      typeof p.id !== 'string'
      || typeof p.agentId !== 'string'
      || typeof p.cwd !== 'string'
      || typeof p.title !== 'string'
    ) {
      continue;
    }
    const worktree = validWorktree(p.worktree);
    out.push({
      id: p.id,
      agentId: p.agentId,
      cwd: p.cwd,
      title: p.title,
      wasThinking: p.wasThinking === true,
      ...(worktree ? { worktree } : {}),
    });
  }
  return out;
}

export function describeOpenSessions(sessions: OpenSessionSource[]): PersistedOpenSession[] {
  return sessions
    .filter((s) => s.items.length > 0 || s.loading)
    .map((s) => {
      const descriptor: PersistedOpenSession = {
        id: s.id,
        agentId: s.agentId,
        cwd: s.cwd,
        title: s.title,
        wasThinking: s.phase === 'thinking',
      };
      if (s.worktree) descriptor.worktree = s.worktree;
      return descriptor;
    });
}

export function mergeOpenSessionDescriptors(
  live: PersistedOpenSession[],
  remembered: PersistedOpenSession[],
): PersistedOpenSession[] {
  const seen = new Set<string>();
  const merged: PersistedOpenSession[] = [];
  for (const p of [...live, ...remembered]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }
  return merged;
}

export function openSessionToEntry(p: PersistedOpenSession): SessionEntry {
  return {
    id: p.id,
    tool: p.agentId,
    dir: p.cwd,
    title: p.title,
    firstActive: '',
    lastActive: '',
    messages: 0,
    active: false,
  };
}
