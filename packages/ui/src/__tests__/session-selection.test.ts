import { describe, expect, it } from 'vitest';
import type { SessionEntry } from '../services/api.js';
import {
  pruneSessionSelection,
  setVisibleSessionSelection,
  toggleSessionSelection,
  visibleSelectionState,
} from '../services/session-selection.js';

function session(id: string): SessionEntry {
  return {
    id,
    tool: 'claude',
    dir: '/repo',
    title: id,
    firstActive: '2026-07-01T00:00:00Z',
    lastActive: '2026-07-01T00:00:00Z',
    messages: 1,
    active: false,
  };
}

describe('session selection helpers', () => {
  it('toggles one id without mutating the existing selection', () => {
    const selected = new Set(['a']);
    const added = toggleSessionSelection(selected, 'b');
    const removed = toggleSessionSelection(selected, 'a');

    expect([...selected]).toEqual(['a']);
    expect([...added].sort()).toEqual(['a', 'b']);
    expect([...removed]).toEqual([]);
  });

  it('selects and clears only visible sessions', () => {
    const visible = [session('b'), session('c')];
    const selected = new Set(['a']);

    const withVisible = setVisibleSessionSelection(selected, visible, true);
    const withoutVisible = setVisibleSessionSelection(withVisible, visible, false);

    expect([...withVisible].sort()).toEqual(['a', 'b', 'c']);
    expect([...withoutVisible]).toEqual(['a']);
  });

  it('drops selected ids no longer present after reload', () => {
    const pruned = pruneSessionSelection(new Set(['a', 'stale']), [session('a'), session('b')]);

    expect([...pruned]).toEqual(['a']);
  });

  it('reports visible select-all state', () => {
    const visible = [session('a'), session('b')];

    expect(visibleSelectionState(new Set(['a']), visible)).toEqual({
      visibleCount: 2,
      selectedVisibleCount: 1,
      allVisibleSelected: false,
      someVisibleSelected: true,
    });
    expect(visibleSelectionState(new Set(['a', 'b', 'hidden']), visible)).toEqual({
      visibleCount: 2,
      selectedVisibleCount: 2,
      allVisibleSelected: true,
      someVisibleSelected: true,
    });
  });
});
