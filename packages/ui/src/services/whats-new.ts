import {
  PENDING_UPDATE_NOTES_KEY,
  type PendingUpdateNotes,
} from './desktop-updater.js';
import { KAIROS_CHANGELOG } from './app-version.js';

export const LAST_SEEN_VERSION_KEY = 'kairos.lastSeenVersion';

export interface WhatsNew {
  version: string;
  notes: string;
}

// A placeholder note is the manifest fallback ("Kairos 0.1.46" / "Kairos
// v0.1.46") emitted when no real release notes were generated. We treat those
// as "no notes" so releases without generated notes don't pop an empty panel.
function isPlaceholderNotes(notes: string, version: string): boolean {
  const trimmed = notes.trim();
  if (!trimmed) return true;
  return new RegExp(`^Kairos\\s+v?${escapeRegExp(version)}$`, 'i').test(trimmed);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readPendingNotes(): PendingUpdateNotes | null {
  try {
    const raw = localStorage.getItem(PENDING_UPDATE_NOTES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'string' && typeof parsed.notes === 'string') {
      return parsed as PendingUpdateNotes;
    }
  } catch {
    /* corrupt entry — ignore. */
  }
  return null;
}

function readLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

// Pure decision: given the running version, the stashed pending notes, and the
// last version whose "What's new" was already shown, decide whether to show the
// panel and with what content. Exposed separately from localStorage so it's
// unit-testable without a DOM.
export function resolveWhatsNew(
  runtimeVersion: string,
  stored: PendingUpdateNotes | null,
  lastSeenVersion: string | null,
): WhatsNew | null {
  if (!stored) return null;
  // Only show once the install has actually landed on the stashed version.
  if (stored.version !== runtimeVersion) return null;
  // Already shown for this version.
  if (lastSeenVersion === runtimeVersion) return null;
  if (isPlaceholderNotes(stored.notes, stored.version)) return null;
  return { version: stored.version, notes: stored.notes };
}

// Read localStorage + the running version and decide whether to auto-show the
// panel (once per updated version).
export function getWhatsNew(runtimeVersion: string): WhatsNew | null {
  return resolveWhatsNew(runtimeVersion, readPendingNotes(), readLastSeenVersion());
}

// The notes to show when the user opens the panel manually, regardless of
// whether they've been seen. Prefers the per-install stashed notes (they carry
// the exact release the user updated to); otherwise falls back to the changelog
// baked in at build time (see app-version.ts) so the header button always has
// content — including on fresh installs and dev builds. Returns null only when
// there is genuinely nothing to show.
export function peekWhatsNew(runtimeVersion: string, changelog = KAIROS_CHANGELOG): WhatsNew | null {
  const stashed = resolveWhatsNew(runtimeVersion, readPendingNotes(), null);
  if (stashed) return stashed;
  const trimmed = changelog.trim();
  if (!trimmed) return null;
  return { version: runtimeVersion, notes: trimmed };
}

// Record that the user has seen the panel for this version. The stashed notes
// are kept so the manual header button can reopen them; only the auto-popup is
// suppressed via the last-seen marker.
export function markWhatsNewSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
  } catch {
    /* localStorage unavailable — nothing to persist. */
  }
}
