import { beforeEach, describe, expect, it } from 'vitest';
import {
  getWhatsNew,
  LAST_SEEN_VERSION_KEY,
  markWhatsNewSeen,
  peekWhatsNew,
  resolveWhatsNew,
} from '../services/whats-new.js';
import { PENDING_UPDATE_NOTES_KEY, type PendingUpdateNotes } from '../services/desktop-updater.js';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

const realNotes: PendingUpdateNotes = {
  version: '0.1.2',
  notes: "## What's Changed in v0.1.2\n\n### Features\n- shiny",
};

describe('resolveWhatsNew', () => {
  it('shows notes when the install landed on the running version and it is unseen', () => {
    expect(resolveWhatsNew('0.1.2', realNotes, null)).toEqual({
      version: '0.1.2',
      notes: realNotes.notes,
    });
  });

  it('returns null when there is no stored entry', () => {
    expect(resolveWhatsNew('0.1.2', null, null)).toBeNull();
  });

  it('returns null when the stored version does not match the running version', () => {
    expect(resolveWhatsNew('0.1.1', realNotes, null)).toBeNull();
  });

  it('returns null when the version was already seen', () => {
    expect(resolveWhatsNew('0.1.2', realNotes, '0.1.2')).toBeNull();
  });

  it('rejects placeholder notes (no real release notes generated)', () => {
    expect(resolveWhatsNew('0.1.2', { version: '0.1.2', notes: 'Kairos 0.1.2' }, null)).toBeNull();
    expect(resolveWhatsNew('0.1.2', { version: '0.1.2', notes: 'Kairos v0.1.2' }, null)).toBeNull();
    expect(resolveWhatsNew('0.1.2', { version: '0.1.2', notes: '   ' }, null)).toBeNull();
  });
});

describe('getWhatsNew + markWhatsNewSeen (localStorage-backed)', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = createLocalStorageStub();
  });

  it('reads a stashed pending entry and surfaces it', () => {
    localStorage.setItem(PENDING_UPDATE_NOTES_KEY, JSON.stringify(realNotes));
    expect(getWhatsNew('0.1.2')).toEqual({ version: '0.1.2', notes: realNotes.notes });
  });

  it('ignores a corrupt pending entry', () => {
    localStorage.setItem(PENDING_UPDATE_NOTES_KEY, '{not json');
    expect(getWhatsNew('0.1.2')).toBeNull();
  });

  it('does not auto-surface after markWhatsNewSeen, but keeps the notes for manual reopen', () => {
    localStorage.setItem(PENDING_UPDATE_NOTES_KEY, JSON.stringify(realNotes));
    expect(getWhatsNew('0.1.2')).not.toBeNull();

    markWhatsNewSeen('0.1.2');

    expect(localStorage.getItem(LAST_SEEN_VERSION_KEY)).toBe('0.1.2');
    // Notes are retained so the manual header button can reopen them.
    expect(localStorage.getItem(PENDING_UPDATE_NOTES_KEY)).not.toBeNull();
    // Auto-popup is suppressed...
    expect(getWhatsNew('0.1.2')).toBeNull();
    // ...but the manual peek still returns them.
    expect(peekWhatsNew('0.1.2', '')).toEqual({ version: '0.1.2', notes: realNotes.notes });
  });

  it('peekWhatsNew prefers stashed per-install notes over the build-time changelog', () => {
    localStorage.setItem(PENDING_UPDATE_NOTES_KEY, JSON.stringify(realNotes));
    expect(peekWhatsNew('0.1.2', '## Changelog\n\n### Fixes\n- baked in')).toEqual({
      version: '0.1.2',
      notes: realNotes.notes,
    });
  });

  it('peekWhatsNew falls back to the build-time changelog when there are no stashed notes', () => {
    const changelog = "## What's Changed in v0.1.2\n\n### Features\n- baked in";
    expect(peekWhatsNew('0.1.2', changelog)).toEqual({ version: '0.1.2', notes: changelog });
    // Stashed notes for a different version don't apply; still falls back.
    localStorage.setItem(
      PENDING_UPDATE_NOTES_KEY,
      JSON.stringify({ version: '0.1.1', notes: realNotes.notes }),
    );
    expect(peekWhatsNew('0.1.2', changelog)).toEqual({ version: '0.1.2', notes: changelog });
  });

  it('peekWhatsNew returns null only when there are neither stashed notes nor a changelog', () => {
    expect(peekWhatsNew('0.1.2', '')).toBeNull();
    expect(peekWhatsNew('0.1.2', '   ')).toBeNull();
  });
});
