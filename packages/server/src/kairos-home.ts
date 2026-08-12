import { writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';

// The single user-scoped state home for Kairos. Everything durable the server
// owns — session overrides, orchestrator state — lives under one directory so
// there's one place to find (or wipe) local state, not a scattering of dotfiles.
//
// Default: ~/.kairos. Override the whole home with KAIROS_HOME (tests point it
// at a temp dir so they never touch the real dotfile). Both session-overrides.ts
// and the orchestrator state store resolve their paths through kairosPath().

/** Absolute path to the Kairos home dir (honoring KAIROS_HOME). */
export function kairosHome(): string {
  return process.env.KAIROS_HOME || join(homedir(), '.kairos');
}

/** Resolve a file inside the Kairos home dir. */
export function kairosPath(...segments: string[]): string {
  return join(kairosHome(), ...segments);
}

/**
 * Write a file atomically: write a unique temp sibling then rename over the
 * target, so a crash mid-write can never leave a truncated/corrupt file, and two
 * concurrent writers to the same target can't stomp each other's temp file. The
 * temp name is pid+random tagged (unique per call), so the helper is safe to use
 * standalone — not only behind a serialized mutate queue. Creates the parent dir
 * as needed. Rename stays on the same filesystem (temp is a sibling), so no EXDEV.
 */
export async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}

/**
 * Build a serialized read-modify-write mutator over a single file's state. All
 * mutations run one-at-a-time through an internal promise chain, so concurrent
 * callers can't interleave a read/write and lose an update (last-writer-wins on
 * a torn read). The chain survives a rejected mutation so later writes still run.
 *
 * `read` loads current state (tolerating a missing file); `write` persists it.
 */
export function createSerializedMutator<T>(
  read: () => Promise<T>,
  write: (next: T) => Promise<void>,
): (fn: (current: T) => T) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = async (): Promise<T> => {
      const current = await read();
      const next = fn(current);
      await write(next);
      return next;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}
