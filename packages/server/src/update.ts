import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Git-based self-update. Kairos installed from a clone can update itself in
// place: fetch the latest commit on the tracked branch, fast-forward to it, and
// let the supervisor launcher rebuild + restart. This works identically on
// macOS, Linux, and Windows because it only shells out to `git` — no signed
// installers, no per-platform release feed. See packages/desktop supervisor
// scripts for the rebuild/restart half (triggered by exit code 42).
//
// When Kairos runs from the packaged single-file bundle (no .git alongside it),
// there is no repo to update, so every function here degrades to
// `supported: false` and the UI hides the update affordance.

const execFileAsync = promisify(execFile);

/** Exit code the server uses to ask its supervisor to rebuild + relaunch. */
export const RESTART_EXIT_CODE = 42;

// import.meta.url is undefined once this module is inlined into the CommonJS
// desktop bundle; there is no repo there, so cwd is a fine (unused) fallback.
const moduleDir = import.meta.url ? dirname(fileURLToPath(import.meta.url)) : process.cwd();

let cachedRoot: string | null | undefined;

/** Resolve the git repo root, or null if we're not inside a working clone. */
async function repoRoot(): Promise<string | null> {
  if (cachedRoot !== undefined) return cachedRoot;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: moduleDir });
    cachedRoot = stdout.trim() || null;
  } catch {
    cachedRoot = null;
  }
  return cachedRoot;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, timeout: 60_000 });
  return stdout.trim();
}

export interface UpdateStatus {
  /** True only when running from a git clone with an `origin` remote. */
  supported: boolean;
  branch?: string;
  currentCommit?: string;
  currentCommitShort?: string;
  /** How many commits behind the remote tracking branch (0 = up to date). */
  behind?: number;
  latestCommit?: string;
  latestCommitShort?: string;
  /** Subject line of the newest remote commit, for a human-readable notice. */
  latestSubject?: string;
  /** Present when the check itself failed (offline, detached HEAD, etc.). */
  error?: string;
}

/**
 * Check whether a newer commit exists on the tracked remote branch. Performs a
 * `git fetch` so `behind` reflects the remote's true state. Never throws — a
 * failure comes back as `{ supported: true, error }` so the UI can show why the
 * check didn't run rather than crashing.
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const root = await repoRoot();
  if (!root) return { supported: false };

  try {
    const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') {
      return { supported: true, branch, error: 'Detached HEAD — cannot track a remote branch.' };
    }
    const currentCommit = await git(root, ['rev-parse', 'HEAD']);

    // Confirm the branch actually tracks a remote before fetching.
    let upstream: string;
    try {
      upstream = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    } catch {
      return { supported: true, branch, currentCommit, currentCommitShort: currentCommit.slice(0, 7), error: 'No upstream branch is configured.' };
    }

    await git(root, ['fetch', '--quiet']);
    const latestCommit = await git(root, ['rev-parse', upstream]);
    const behindStr = await git(root, ['rev-list', '--count', `HEAD..${upstream}`]);
    const behind = parseInt(behindStr, 10) || 0;
    const latestSubject = behind > 0 ? await git(root, ['log', '-1', '--format=%s', upstream]) : undefined;

    return {
      supported: true,
      branch,
      currentCommit,
      currentCommitShort: currentCommit.slice(0, 7),
      behind,
      latestCommit,
      latestCommitShort: latestCommit.slice(0, 7),
      latestSubject,
    };
  } catch (err) {
    return { supported: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ApplyUpdateResult {
  ok: boolean;
  /** True when a fast-forward actually moved HEAD (a rebuild/restart follows). */
  updated: boolean;
  fromCommit?: string;
  toCommit?: string;
  message: string;
}

/**
 * Fast-forward the working clone to the latest remote commit. Uses
 * `--ff-only` so a diverged local history fails loudly instead of creating a
 * merge commit. Does NOT rebuild or restart — the caller triggers that (by
 * exiting with RESTART_EXIT_CODE) once this reports `updated: true`, so the
 * long-running `npm install && npm run build` happens in the supervisor while
 * the client polls for the server to come back.
 */
export async function applyUpdate(): Promise<ApplyUpdateResult> {
  const root = await repoRoot();
  if (!root) {
    return { ok: false, updated: false, message: 'Self-update is only available when running from a git clone.' };
  }
  try {
    const fromCommit = await git(root, ['rev-parse', 'HEAD']);
    await git(root, ['fetch', '--quiet']);
    const before = await git(root, ['rev-parse', 'HEAD']);
    const upstream = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const target = await git(root, ['rev-parse', upstream]);
    if (before === target) {
      return { ok: true, updated: false, fromCommit, toCommit: fromCommit, message: 'Already up to date.' };
    }
    await git(root, ['merge', '--ff-only', upstream]);
    const toCommit = await git(root, ['rev-parse', 'HEAD']);
    return {
      ok: true,
      updated: true,
      fromCommit,
      toCommit,
      message: `Updated ${fromCommit.slice(0, 7)} → ${toCommit.slice(0, 7)}. Rebuilding and restarting…`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The most common failure is a non-fast-forward (local edits/divergence).
    const hint = /not possible to fast-forward|Not possible|diverg/i.test(message)
      ? 'Local changes diverge from the remote. Resolve or discard them, then update again.'
      : message;
    return { ok: false, updated: false, message: hint };
  }
}
