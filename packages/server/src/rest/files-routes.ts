import type { Express, Request, Response } from 'express';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { expandHome } from '../acp/paths.js';

// Read-only workspace file browsing the UI's Agents tab consumes (api.ts:
// listWorkspaceDir / readWorkspaceFile / listAllWorkspaceFiles). Every call is
// scoped to a session `cwd`; a `path` is always resolved *inside* that cwd and
// rejected if it escapes (path-traversal guard). The browser sends a raw cwd of
// "~", so expand it here too — otherwise folder access (Files tab, resume
// validation, the directory-exists check) fails with "could not access: ~".

const MAX_ENTRIES = 1000; // per-directory cap for the tree view
const MAX_ALL_FILES = 5000; // whole-tree cap for @-mention autocomplete
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MiB file-read cap
// Directories never worth walking for autocomplete; keeps /files/all fast.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'build', '.next', 'target', '.venv', '__pycache__']);

// Resolve `cwd` (tilde-expanded) as the root, and `rel` strictly within it.
// Returns null when the resolved path escapes the root.
function safeResolve(cwd: string, rel: string): { root: string; abs: string } | null {
  const root = resolve(expandHome(cwd));
  const abs = resolve(root, rel || '.');
  const within = abs === root || abs.startsWith(root + sep);
  return within ? { root, abs } : null;
}

async function listDir(req: Request, res: Response): Promise<void> {
  const cwd = String(req.query.cwd ?? '');
  const path = String(req.query.path ?? '');
  if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
  const loc = safeResolve(cwd, path);
  if (!loc) { res.status(400).json({ error: 'path escapes cwd' }); return; }

  try {
    const dirents = await readdir(loc.abs, { withFileTypes: true });
    const truncated = dirents.length > MAX_ENTRIES;
    const entries = dirents.slice(0, MAX_ENTRIES).map((d) => ({
      name: d.name,
      path: relative(loc.root, join(loc.abs, d.name)),
      kind: d.isDirectory() ? 'dir' as const : 'file' as const,
    }));
    // Directories first, then alphabetical — the order the tree view expects.
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    res.json({ entries, truncated });
  } catch (err) {
    res.status(404).json({ error: `Cannot access directory: ${(err as Error).message}` });
  }
}

async function readWorkspaceFile(req: Request, res: Response): Promise<void> {
  const cwd = String(req.query.cwd ?? '');
  const path = String(req.query.path ?? '');
  if (!cwd || !path) { res.status(400).json({ error: 'cwd and path are required' }); return; }
  const loc = safeResolve(cwd, path);
  if (!loc) { res.status(400).json({ error: 'path escapes cwd' }); return; }

  try {
    const info = await stat(loc.abs);
    if (!info.isFile()) { res.status(400).json({ error: 'not a file' }); return; }
    const buf = await readFile(loc.abs);
    // Heuristic binary sniff: a NUL byte in the first 8 KiB.
    const binary = buf.subarray(0, 8192).includes(0);
    if (binary) { res.json({ content: '', truncated: false, binary: true, bytes: info.size }); return; }
    const truncated = buf.length > MAX_READ_BYTES;
    res.json({
      content: buf.subarray(0, MAX_READ_BYTES).toString('utf8'),
      truncated,
      binary: false,
      bytes: info.size,
    });
  } catch (err) {
    res.status(404).json({ error: `Cannot read file: ${(err as Error).message}` });
  }
}

async function listAllFiles(req: Request, res: Response): Promise<void> {
  const cwd = String(req.query.cwd ?? '');
  if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
  const loc = safeResolve(cwd, '');
  if (!loc) { res.status(400).json({ error: 'invalid cwd' }); return; }

  const files: string[] = [];
  let truncated = false;
  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subdir — skip, don't fail the whole walk
    }
    for (const d of dirents) {
      if (truncated) return;
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        await walk(join(dir, d.name));
      } else if (d.isFile()) {
        files.push(relative(loc!.root, join(dir, d.name)));
        if (files.length >= MAX_ALL_FILES) { truncated = true; return; }
      }
    }
  }

  try {
    await stat(loc.abs); // 404 if the root itself is gone
    await walk(loc.abs);
    res.json({ files, truncated });
  } catch (err) {
    res.status(404).json({ error: `Cannot access directory: ${(err as Error).message}` });
  }
}

/**
 * Register the read-only workspace file routes. Mount BEFORE registerStubRoutes
 * so these real handlers win over the 501 catch-all.
 */
export function registerFileRoutes(app: Express): void {
  app.get('/api/files/list', listDir);
  app.get('/api/files/read', readWorkspaceFile);
  app.get('/api/files/all', listAllFiles);
}

// Exported for direct unit testing.
export { safeResolve };
