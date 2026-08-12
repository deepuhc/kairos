import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// Durable, user-scoped overrides for sessions the UI shows: a custom title and a
// pin list. The underlying session history the CLI produces is read-only to us,
// so renames/pins can't be written back there — we persist them here and merge
// on read. Stored at ~/.kairos/session-overrides.json (override the home with
// KAIROS_HOME so tests don't touch the real dotfile).

export interface SessionOverrides {
  /** id → custom title. Absent id = use the session's own/auto title. */
  titles: Record<string, string>;
  /** Ordered list of pinned session ids (order is the display order). */
  pinned: string[];
}

const EMPTY: SessionOverrides = { titles: {}, pinned: [] };

function overridesPath(): string {
  const home = process.env.KAIROS_HOME || join(homedir(), '.kairos');
  return join(home, 'session-overrides.json');
}

/** Read the overrides file, tolerating a missing or malformed file. */
export async function readOverrides(): Promise<SessionOverrides> {
  try {
    const raw = await readFile(overridesPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SessionOverrides>;
    return {
      titles: parsed.titles && typeof parsed.titles === 'object' ? parsed.titles : {},
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { ...EMPTY, titles: {}, pinned: [] };
  }
}

/** Write overrides atomically (temp file + rename) so a crash can't truncate it. */
export async function writeOverrides(next: SessionOverrides): Promise<void> {
  const path = overridesPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await rename(tmp, path);
}

/** Read-modify-write helper that serializes concurrent mutations. */
let queue: Promise<unknown> = Promise.resolve();
export function mutateOverrides(
  fn: (o: SessionOverrides) => SessionOverrides,
): Promise<SessionOverrides> {
  const run = async (): Promise<SessionOverrides> => {
    const current = await readOverrides();
    const next = fn(current);
    await writeOverrides(next);
    return next;
  };
  const result = queue.then(run, run);
  // Keep the chain alive even if a mutation rejects, so later writes still run.
  queue = result.catch(() => undefined);
  return result;
}

// --- Pure transforms (exported for unit testing) ---

/** Set or clear a title override. An empty/blank name reverts to the auto title. */
export function applyRename(o: SessionOverrides, id: string, name: string): SessionOverrides {
  const titles = { ...o.titles };
  const trimmed = name.trim();
  if (trimmed) titles[id] = trimmed;
  else delete titles[id];
  return { ...o, titles };
}

export function applyPin(o: SessionOverrides, id: string): SessionOverrides {
  if (o.pinned.includes(id)) return o;
  return { ...o, pinned: [...o.pinned, id] };
}

export function applyUnpin(o: SessionOverrides, id: string): SessionOverrides {
  if (!o.pinned.includes(id)) return o;
  return { ...o, pinned: o.pinned.filter((x) => x !== id) };
}

/** Reorder the pin list to the given ids, keeping only ids that are still pinned. */
export function applyPinnedOrder(o: SessionOverrides, ids: string[]): SessionOverrides {
  const known = new Set(o.pinned);
  const reordered = ids.filter((id) => known.has(id));
  // Preserve any currently-pinned ids the client didn't mention (append in old order).
  const trailing = o.pinned.filter((id) => !reordered.includes(id));
  return { ...o, pinned: [...reordered, ...trailing] };
}
