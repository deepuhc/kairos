// Line-level diff for the tool-call diff viewer.
//
// The ACP `diff` content block gives us full `oldText`/`newText`; to render a
// readable diff (side-by-side or unified) we need them aligned line-by-line.
// This is a classic LCS diff producing a row stream that both layouts consume:
//   - 'context' rows appear in both sides (same line),
//   - 'del' rows exist only on the left (old),
//   - 'add' rows exist only on the right (new).
//
// Pure and side-effect free so it can be unit-tested directly, like jsonTokens.

export type DiffRowType = 'context' | 'add' | 'del' | 'gap';

export interface DiffRow {
  type: DiffRowType;
  // Old/new text for the row. context → both set; del → only old; add → only new.
  oldText?: string;
  newText?: string;
  // Number of unchanged lines a 'gap' row stands in for.
  count?: number;
  // The collapsed context rows a 'gap' stands in for, so it can be expanded
  // back inline without re-diffing. Length equals `count`; all type 'context'.
  hidden?: DiffRow[];
  // 1-based line numbers in each file, when the row exists on that side.
  oldLine?: number;
  newLine?: number;
}

function splitLines(text: string): string[] {
  // Drop a single trailing newline so a file ending in "\n" doesn't yield a
  // phantom empty final line.
  const t = text.endsWith('\n') ? text.slice(0, -1) : text;
  return t.length === 0 ? [] : t.split('\n');
}

// Longest-common-subsequence table over two line arrays. O(n*m) — fine for the
// edit-sized snippets that show up in tool-call diffs.
function lcs(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

// Codex can emit whole-file oldText/newText for large rewrites. After common
// edge trimming, an LCS over those unmatched middles can still build millions
// of cells and freeze the Agents tab. Above this budget, trade perfect
// line-pair alignment for bounded work: render the middle as a delete block
// followed by an add block. Add/remove stats stay exact.
const MAX_LCS_CELLS = 120_000;

function exceedsLcsBudget(a: number, b: number): boolean {
  return a > 0 && b > Math.floor(MAX_LCS_CELLS / a);
}

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const rows: DiffRow[] = [];

  // Whole-file edit payloads often differ in only a tiny middle range. Trim the
  // identical edges before LCS so a one-line edit in a 5k-line file does not
  // build a 25M-cell table just to rediscover the unchanged prefix/suffix.
  const shared = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shared && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shared - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  for (let p = 0; p < prefix; p++) {
    rows.push({ type: 'context', oldText: a[p], newText: b[p], oldLine: p + 1, newLine: p + 1 });
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  if (exceedsLcsBudget(midA.length, midB.length)) {
    let oldLine = prefix + 1;
    let newLine = prefix + 1;
    while (oldLine <= prefix + midA.length) {
      rows.push({ type: 'del', oldText: midA[oldLine - prefix - 1], oldLine: oldLine++ });
    }
    while (newLine <= prefix + midB.length) {
      rows.push({ type: 'add', newText: midB[newLine - prefix - 1], newLine: newLine++ });
    }
    for (let s = suffix; s > 0; s--) {
      const ai = a.length - s;
      const bi = b.length - s;
      rows.push({ type: 'context', oldText: a[ai], newText: b[bi], oldLine: ai + 1, newLine: bi + 1 });
    }
    return rows;
  }

  const dp = lcs(midA, midB);
  let i = 0;
  let j = 0;
  let oldLine = prefix + 1;
  let newLine = prefix + 1;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      rows.push({ type: 'context', oldText: midA[i], newText: midB[j], oldLine: oldLine++, newLine: newLine++ });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', oldText: midA[i], oldLine: oldLine++ });
      i++;
    } else {
      rows.push({ type: 'add', newText: midB[j], newLine: newLine++ });
      j++;
    }
  }
  while (i < midA.length) rows.push({ type: 'del', oldText: midA[i++], oldLine: oldLine++ });
  while (j < midB.length) rows.push({ type: 'add', newText: midB[j++], newLine: newLine++ });

  for (let s = suffix; s > 0; s--) {
    const ai = a.length - s;
    const bi = b.length - s;
    rows.push({ type: 'context', oldText: a[ai], newText: b[bi], oldLine: ai + 1, newLine: bi + 1 });
  }

  return rows;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === 'add') added++;
    else if (r.type === 'del') removed++;
  }
  return { added, removed };
}

// Collapse long runs of unchanged context into a single 'gap' row, keeping
// `context` lines of surrounding context on each side of a change — the
// standard diff-with-hunks view. Without this a whole-file diff (e.g. the
// session review panel, which diffs full git contents) renders one row per
// line: thousands of unchanged rows that bury the actual edit and tank scroll
// performance. A gap shorter than the context window on both sides is left
// inline (collapsing it would save nothing). diffStats counts add/del rows, so
// running it before this keeps the +/- totals intact.
export function collapseContext(rows: DiffRow[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'context') continue;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) { out.push(rows[i++]); continue; }
    let j = i;
    while (j < rows.length && !keep[j]) j++;
    const hidden = rows.slice(i, j);
    out.push({ type: 'gap', count: hidden.length, oldLine: rows[i].oldLine, newLine: rows[j - 1].newLine, hidden });
    i = j;
  }
  return out;
}

// Collapse the row stream into aligned left/right pairs for the split view: a
// context row fills both sides; runs of del/add line up del[i]↔add[i] and the
// shorter side pads with empties. Shared by the tool-call diff card and the
// session review panel so both render side-by-side diffs identically.
export function pairRows(rows: DiffRow[]): Array<{ left?: DiffRow; right?: DiffRow }> {
  const out: Array<{ left?: DiffRow; right?: DiffRow }> = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.type === 'context' || r.type === 'gap') {
      out.push({ left: r, right: r });
      i++;
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) out.push({ left: dels[k], right: adds[k] });
  }
  return out;
}
