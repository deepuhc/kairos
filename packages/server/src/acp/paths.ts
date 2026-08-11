import { homedir } from 'node:os';
import { join } from 'node:path';

// Expand a leading `~` (or `~/…`) to the user's home directory. The browser
// client deliberately sends a raw cwd of "~" and relies on the backend to
// resolve it (see ui getDefaultCwd). Two places need this: the subprocess spawn
// cwd (spawn() does no tilde expansion, so an unexpanded "~" is a nonexistent
// relative dir → immediate ENOENT exit), and the `cwd` field inside forwarded
// session/new & session/load params (the Claude adapter rejects a non-absolute
// cwd with "must be an absolute path").
export function expandHome(dir: string): string {
  if (dir === '~') return homedir();
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2));
  return dir;
}

// Return a shallow copy of params with any string `cwd` field tilde-expanded.
// Non-string / absent cwd is left untouched.
export function normalizeParamsCwd(
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof params.cwd !== 'string') return params;
  return { ...params, cwd: expandHome(params.cwd) };
}
