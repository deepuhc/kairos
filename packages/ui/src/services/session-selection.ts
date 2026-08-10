import type { SessionEntry } from './api.js';

export interface VisibleSelectionState {
  visibleCount: number;
  selectedVisibleCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}

export function toggleSessionSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function setVisibleSessionSelection(
  selected: ReadonlySet<string>,
  visibleSessions: SessionEntry[],
  select: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const session of visibleSessions) {
    if (select) {
      next.add(session.id);
    } else {
      next.delete(session.id);
    }
  }
  return next;
}

export function pruneSessionSelection(
  selected: ReadonlySet<string>,
  sessions: SessionEntry[],
): Set<string> {
  const valid = new Set(sessions.map((session) => session.id));
  return new Set([...selected].filter((id) => valid.has(id)));
}

export function visibleSelectionState(
  selected: ReadonlySet<string>,
  visibleSessions: SessionEntry[],
): VisibleSelectionState {
  const visibleCount = visibleSessions.length;
  const selectedVisibleCount = visibleSessions.filter((session) => selected.has(session.id)).length;
  return {
    visibleCount,
    selectedVisibleCount,
    allVisibleSelected: visibleCount > 0 && selectedVisibleCount === visibleCount,
    someVisibleSelected: selectedVisibleCount > 0,
  };
}
