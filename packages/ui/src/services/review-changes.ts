// Collect + coalesce the file changes an agent reported across a session, for
// the aggregate "Review changes" panel. The agent streams a `diff` content
// block per edit inside its tool calls; over a session the same file can be
// edited several times, so this folds them into one entry per path (the file's
// state at session start → its final state).
//
// Pure and DOM-free (only ACP value types) so it can be unit-tested directly,
// like diffLines.

import type { DiffContent, TimelineItem, ToolKind } from './acp-types.js';
import { diffLines, diffStats } from '../components/line-diff.js';

export type ChangeKind = 'added' | 'modified' | 'removed';

export interface FileChange {
  path: string;
  /** File contents at the start of the session ('' when created this session). */
  oldText: string;
  /** File contents after the last edit this session. */
  newText: string;
  /** How many edit tool calls touched this file. */
  edits: number;
  kind: ChangeKind;
  added: number;
  removed: number;
}

export interface SessionChanges {
  files: FileChange[];
  filesChanged: number;
  totalAdded: number;
  totalRemoved: number;
}

interface DraftFileChange {
  path: string;
  oldText: string;
  newText: string;
  edits: number;
  removed: boolean;
}

interface DraftSessionChanges {
  files: DraftFileChange[];
  paths: string[];
}

interface VersionedCache<T> {
  version: number;
  value: T;
}

const draftCache = new WeakMap<TimelineItem[], VersionedCache<DraftSessionChanges>>();
const fullCache = new WeakMap<TimelineItem[], VersionedCache<SessionChanges>>();

// Tool kinds that delete a file outright (vs. editing it in place).
function isRemoval(kind: ToolKind | undefined): boolean {
  return kind === 'delete';
}

function collectDraftChanges(items: TimelineItem[], version: number): DraftSessionChanges {
  const cached = draftCache.get(items);
  if (cached && cached.version === version) return cached.value;

  // Per path, in first-seen order: the very first oldText (session-start state),
  // the latest newText, an edit counter, and whether any touch was a deletion.
  const order: string[] = [];
  const byPath = new Map<string, { oldText: string; newText: string; edits: number; removed: boolean }>();

  for (const item of items) {
    if (item.kind !== 'tool') continue;
    const tool = item.tool;

    for (const block of tool.content ?? []) {
      if (block.type !== 'diff') continue;
      const d = block as DiffContent;
      const old = d.oldText ?? '';
      const next = d.newText ?? '';
      const existing = byPath.get(d.path);
      if (existing) {
        existing.newText = next;
        existing.edits += 1;
        if (isRemoval(tool.kind)) existing.removed = true;
      } else {
        order.push(d.path);
        byPath.set(d.path, { oldText: old, newText: next, edits: 1, removed: isRemoval(tool.kind) });
      }
    }
  }

  const files = order.map((path) => ({ path, ...byPath.get(path)! }));
  const result = { files, paths: order };
  draftCache.set(items, { version, value: result });
  return result;
}

// Render-path helpers: count/list touched files without running line diffs.
// Typing in a long session re-renders chrome like the rail and session bar; full
// add/remove stats belong in the Review panel, not those hot paths.
export function countSessionChangedFiles(items: TimelineItem[], version: number): number {
  return collectDraftChanges(items, version).paths.length;
}

export function collectSessionChanges(items: TimelineItem[], version: number): SessionChanges {
  const cached = fullCache.get(items);
  if (cached && cached.version === version) return cached.value;

  const files: FileChange[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const e of collectDraftChanges(items, version).files) {
    const { added, removed } = diffStats(diffLines(e.oldText, e.newText));
    const kind: ChangeKind = e.removed
      ? 'removed'
      : e.oldText.length === 0
        ? 'added'
        : 'modified';
    files.push({ path: e.path, oldText: e.oldText, newText: e.newText, edits: e.edits, kind, added, removed });
    totalAdded += added;
    totalRemoved += removed;
  }

  const result = {
    files,
    filesChanged: files.length,
    totalAdded,
    totalRemoved,
  };
  fullCache.set(items, { version, value: result });
  return result;
}
