// Aggregate "everything this agent changed" review panel — the surface Cursor's
// review interface and Antigravity's Artifacts lead with. Kairos otherwise
// shows diffs only inside individual tool cards scattered down the timeline;
// this folds them into one review view with summary stats. The narrative
// summary lives in its own sibling panel (agents-summary.ts).
//
// Master-detail layout mirroring agents-file-tree: the changed files list on the
// left, the selected file's diff on the right. Picking a file swaps the detail
// pane — no more scrolling a tall stack of every diff to reach one file.
//
// Source of truth is the ACP tool diffs the agent already streamed (UI-only,
// zero backend), coalesced by `collectSessionChanges`. All diff/highlight
// rendering is reused from the tool-card path so a file's diff here looks
// identical to how it appeared inline.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { AgentSession } from '../services/agents-session.js';
import { diffLines, diffStats, collapseContext, pairRows, type DiffRow } from './line-diff.js';
import { highlightLine, hljsTheme } from './code-highlight.js';
import { langFromPath } from './agents-tool-call.js';
import { collectSessionChanges, type FileChange } from '../services/review-changes.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';
import { diffCheckpointFile } from '../services/api.js';

// Mirror the tool card: below this width two columns can't both stay readable,
// so diffs render unified regardless of preference.
const SIDE_BY_SIDE_MIN_WIDTH = 620;
const REVIEW_GIT_DIFF_CACHE_CAP = 50;
const REVIEW_DIFF_ROW_PREVIEW_LIMIT = 800;

// Full word for the hover tooltip; single letter for the compact badge that
// leads each row (VS Code Source Control convention — A/M/D, not a wide pill).
const KIND_LABEL: Record<FileChange['kind'], string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
};
const KIND_BADGE: Record<FileChange['kind'], string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
};

type GitDiff = { oldText: string; newText: string };

const reviewGitDiffCache = new Map<string, GitDiff>();
const reviewGitDiffPending = new Map<string, Promise<GitDiff>>();

function rememberGitDiff(key: string, value: GitDiff) {
  reviewGitDiffCache.delete(key);
  reviewGitDiffCache.set(key, value);
  if (reviewGitDiffCache.size > REVIEW_GIT_DIFF_CACHE_CAP) {
    const oldest = reviewGitDiffCache.keys().next().value;
    if (oldest !== undefined) reviewGitDiffCache.delete(oldest);
  }
}

// Split a path into its directory prefix and basename. The basename is what the
// user scans for, so the row shows it in full and truncates the dir instead.
function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/');
  return i === -1 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

@customElement('agents-review')
export class AgentsReview extends LitElement {
  @property({ attribute: false }) session!: AgentSession;
  // Which file's diff is shown in the detail pane. Null until the first file is
  // picked (or auto-selected on first render).
  @state() private selectedPath: string | null = null;
  // Gaps the user has expanded to reveal hidden context, keyed by gapKey().
  @state() private expandedGaps = new Set<string>();
  @state() private fullDiffPaths = new Set<string>();
  @state() private splitPref: boolean | null = null;
  // Start unified until measured. The default side panel is narrower than the
  // split threshold; optimistic split causes an immediate second render of the
  // selected full-file diff after ResizeObserver reports the real width.
  @state() private fitsSplit = false;
  // Real before/after fetched from git for each path, keyed by `${sha}:${path}`.
  // ACP `diff` blocks carry only per-edit hunks (2-8 lines); the session's first
  // checkpoint sha is the true session-start baseline, so we read it from git
  // and show the complete diff with context. Stays empty until the first fetch
  // resolves — until then renderFile falls back to the snippet path.
  @state() private gitDiffs = new Map<string, { oldText: string; newText: string }>();
  // Paths whose git fetch has failed so we don't retry every render.
  private failedFetches = new Set<string>();
  private diffMemo: {
    oldText: string;
    newText: string;
    collapse: boolean;
    rows: DiffRow[];
    added: number;
    removed: number;
  } | null = null;

  @query('.detail') private detailEl?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private observedEl?: HTMLElement;

  connectedCallback() {
    super.connectedCallback();
    // Measure the detail pane (where the diff actually renders), not the host —
    // the list column takes ~38% of the width, so the host would overestimate
    // the room a side-by-side diff has.
    this.resizeObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (!w) return;
      const nextFits = w >= SIDE_BY_SIDE_MIN_WIDTH;
      if (nextFits !== this.fitsSplit) this.fitsSplit = nextFits;
    });
  }

  updated() {
    // The detail pane only exists once there are changes to show; (re)observe it
    // whenever it appears or is replaced.
    if (this.detailEl && this.detailEl !== this.observedEl) {
      if (this.observedEl) this.resizeObserver?.unobserve(this.observedEl);
      this.observedEl = this.detailEl;
      this.resizeObserver?.observe(this.detailEl);
    }
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.observedEl = undefined;
    super.disconnectedCallback();
  }

  static styles = [hljsTheme, css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border);
      flex-shrink: 0;
    }
    .head h2 {
      margin: 0;
      flex: 1;
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--white);
    }
    .totals {
      display: inline-flex;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
    }
    .stat-add { color: var(--emerald); }
    .stat-del { color: var(--red); }
    .close {
      border: none;
      background: none;
      color: var(--neutral-gray);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius);
    }
    .close:hover { color: var(--white); background: var(--w5); }
    .close svg { display: block; }
    /* Shadow DOM doesn't inherit the app's global scrollbar styling. */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--w8); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--w15); }

    /* Master-detail split, mirroring agents-file-tree: file list on the left,
       the selected file's diff on the right. */
    .body { flex: 1; min-height: 0; display: flex; flex-direction: row; }
    .list {
      flex: 0 0 38%;
      max-width: 340px;
      min-width: 190px;
      overflow: auto;
      padding: 8px;
      border-right: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .detail {
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
    }
    .filelist { display: flex; flex-direction: column; gap: 2px; }
    .filerow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-radius: var(--radius);
      cursor: pointer;
      text-align: left;
      border: none;
      background: none;
      width: 100%;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      color: var(--gray);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .filerow:hover { background: var(--w4); color: var(--white); }
    .filerow.selected { background: var(--accent-a15); color: var(--white); }
    /* Filename in full; directory prefix dimmed and truncated from the left so
       the basename (what the user scans for) is never the part that's clipped. */
    .fname { flex: 1; min-width: 0; display: flex; align-items: baseline; overflow: hidden; }
    .fname .base { flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .fname .dir {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      margin-left: 6px;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
    }
    .chip {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      border: 1px solid var(--glass-border);
    }
    .chip.added { color: var(--emerald); border-color: var(--green-a25); background: var(--green-a10); }
    .chip.modified { color: var(--accent); border-color: var(--accent-a25); background: var(--accent-a10); }
    .chip.removed { color: var(--red); border-color: var(--red-a25); background: var(--red-a15); }
    .fstat { flex-shrink: 0; display: inline-flex; gap: 6px; font-size: var(--font-size-xs); }

    .empty {
      margin: auto;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      padding: 40px 20px;
    }
    .placeholder {
      margin: auto;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      padding: 40px 20px;
    }

    /* Diff chrome — kept in lockstep with agents-tool-call.ts so a file's diff
       reads identically here and inline. */
    .diff {
      border: 1px solid var(--w8);
      border-radius: var(--radius);
      overflow: hidden;
      scroll-margin-top: 8px;
      /* .detail is a flex column; overflow:hidden lets browsers compute our
         min-content as 0, so without this we shrink and .diff-body becomes its
         own internal scroller (and the outer panel scroll feels capped). */
      flex-shrink: 0;
    }
    .diff-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px 6px 10px;
      background: var(--w5);
      border-bottom: 1px solid var(--w8);
      user-select: none;
    }
    .diff-path {
      flex: 1;
      min-width: 0;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: text;
    }
    .diff-stat { display: inline-flex; gap: 6px; font-family: var(--font-mono); font-size: var(--font-size-xs); flex-shrink: 0; }
    .diff-layout {
      flex-shrink: 0;
      padding: 2px 9px;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-xs);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .diff-layout:hover { border-color: var(--accent-a35); background: var(--accent-a15); color: var(--white); }
    .diff-body { overflow-x: auto; }
    .drow, .dcell {
      display: grid;
      align-items: baseline;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      min-height: calc(var(--font-size-sm) * 1.5);
    }
    .drow { grid-template-columns: auto auto 1fr; }
    .gutter {
      padding: 0 7px;
      text-align: right;
      color: var(--neutral-gray);
      opacity: 0.6;
      user-select: none;
      font-variant-numeric: tabular-nums;
    }
    .code { white-space: pre-wrap; word-break: break-word; padding: 0 10px; color: var(--white); }
    .add { background: var(--green-a10); box-shadow: inset 2px 0 0 var(--emerald); }
    .del { background: var(--red-a15); box-shadow: inset 2px 0 0 var(--red); }
    .gap {
      display: block;
      width: 100%;
      padding: 2px 10px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      text-align: left;
      color: var(--neutral-gray);
      background: var(--w3);
      border: none;
      border-top: 1px solid var(--w8);
      border-bottom: 1px solid var(--w8);
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .gap:hover { color: var(--white); background: var(--w4); }
    .diff-note {
      padding: 4px 10px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      background: var(--w3);
      border-bottom: 1px solid var(--w8);
    }
    .diff-note button {
      margin-left: 8px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--accent);
      font: inherit;
      cursor: pointer;
    }
    .diff-note button:hover { color: var(--bright-white); text-decoration: underline; }
    .diff-body.split { display: grid; grid-template-columns: 1fr 1fr; }
    .dcell { grid-template-columns: auto 1fr; border-bottom: 0; }
    .dcell:nth-child(odd) { border-right: 1px solid var(--w8); }
    .dcell.empty { background: var(--w3); }
  `];

  private selectFile(path: string) {
    if (this.selectedPath === path) return;
    this.selectedPath = path;
  }

  // Stable key for a gap within a file: its bounding line numbers are
  // deterministic for a given diff and unique within the file, so the key
  // survives the row-array reshaping that expanding an earlier gap causes.
  private gapKey(path: string, r: DiffRow): string {
    return `${path}@${r.oldLine ?? ''}-${r.newLine ?? ''}`;
  }

  private expandGapAt(path: string, r: DiffRow) {
    const next = new Set(this.expandedGaps);
    next.add(this.gapKey(path, r));
    this.expandedGaps = next;
  }

  private showFullDiff(path: string) {
    const next = new Set(this.fullDiffPaths);
    next.add(path);
    this.fullDiffPaths = next;
  }

  render() {
    const changes = collectSessionChanges(this.session.items, this.session.itemsVersion);
    // Do not auto-select a file. Opening the Review panel should be cheap even
    // for huge sessions; rendering an actual diff is an explicit user action.
    if (this.selectedPath !== null && !changes.files.some((f) => f.path === this.selectedPath)) {
      this.selectedPath = null;
    }
    const selected = changes.files.find((f) => f.path === this.selectedPath);
    return html`
      <div class="head">
        <h2>Review changes</h2>
        ${changes.filesChanged
          ? html`<span class="totals">
              <span>${changes.filesChanged} ${changes.filesChanged === 1 ? 'file' : 'files'}</span>
              ${changes.totalAdded ? html`<span class="stat-add">+${changes.totalAdded}</span>` : nothing}
              ${changes.totalRemoved ? html`<span class="stat-del">−${changes.totalRemoved}</span>` : nothing}
            </span>`
          : nothing}
        <button class="close" ${tooltip('Close review')} @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>${icon.close(18)}</button>
      </div>
      ${changes.filesChanged === 0
        ? html`<div class="empty">This agent hasn't changed any files yet.</div>`
        : html`
            <div class="body">
              <div class="list">
                <div class="filelist">
                  ${changes.files.map((f) => {
                    const { dir, name } = splitPath(f.path);
                    return html`
                    <button class="filerow ${f.path === this.selectedPath ? 'selected' : ''}" ${tooltip(f.path)} @click=${() => this.selectFile(f.path)}>
                      <span class="chip ${f.kind}" ${tooltip(KIND_LABEL[f.kind])}>${KIND_BADGE[f.kind]}</span>
                      <span class="fname">
                        <span class="base">${name}</span>
                        ${dir ? html`<span class="dir">${dir}</span>` : nothing}
                      </span>
                      <span class="fstat">
                        ${f.added ? html`<span class="stat-add">+${f.added}</span>` : nothing}
                        ${f.removed ? html`<span class="stat-del">−${f.removed}</span>` : nothing}
                      </span>
                    </button>
                  `;
                  })}
                </div>
              </div>
              <div class="detail">
                ${selected
                  ? this.renderFile(selected)
                  : html`<div class="placeholder">Select a file to render its diff.</div>`}
              </div>
            </div>
          `}
    `;
  }

  // Session's working directory — the isolated worktree when one is in use,
  // else the session cwd. Mirrors agents-view.sessionWorkdir.
  private sessionWorkdir(): string {
    return this.session.worktree?.worktreePath ?? this.session.cwd;
  }

  // The session-start checkpoint sha if any. First checkpoint is the snapshot
  // taken before the first user prompt, so it's the true baseline for "what
  // this session changed". Returns undefined for non-git cwds.
  private baselineSha(): string | undefined {
    return this.session.checkpoints[0]?.sha;
  }

  private gitDiffKey(path: string, sha: string): string {
    return `${this.sessionWorkdir()}\0${sha}\0${path}`;
  }

  private fetchGitDiff(path: string, sha: string) {
    const key = this.gitDiffKey(path, sha);
    if (this.gitDiffs.has(key) || this.failedFetches.has(key)) return;
    if (reviewGitDiffCache.has(key)) return;
    // Mark as pending so the request only fires once per (sha, path).
    this.failedFetches.add(key);
    let pending = reviewGitDiffPending.get(key);
    if (!pending) {
      pending = diffCheckpointFile(this.sessionWorkdir(), sha, path)
        .then((res) => {
          rememberGitDiff(key, res);
          reviewGitDiffPending.delete(key);
          return res;
        })
        .catch((err) => {
          reviewGitDiffPending.delete(key);
          throw err;
        });
      reviewGitDiffPending.set(key, pending);
    }
    pending
      .then((res) => {
        this.failedFetches.delete(key);
        this.gitDiffs = new Map(this.gitDiffs).set(key, res);
      })
      .catch(() => {
        // Leave it in failedFetches so renderFile falls back to the snippet.
      });
  }

  private computeDiff(oldText: string, newText: string, collapse: boolean) {
    const memo = this.diffMemo;
    if (memo && memo.oldText === oldText && memo.newText === newText && memo.collapse === collapse) {
      return memo;
    }
    const allRows = diffLines(oldText, newText);
    const { added, removed } = diffStats(allRows);
    const rows = collapse ? collapseContext(allRows) : allRows;
    this.diffMemo = { oldText, newText, collapse, rows, added, removed };
    return this.diffMemo;
  }

  private renderFile(f: FileChange) {
    const sha = this.baselineSha();
    const key = sha ? this.gitDiffKey(f.path, sha) : '';
    const real = key ? this.gitDiffs.get(key) ?? reviewGitDiffCache.get(key) : undefined;
    if (sha && !real) this.fetchGitDiff(f.path, sha);
    // Prefer the git-backed full file contents; fall back to the ACP snippet
    // path when no checkpoint exists (non-git cwd) or the fetch hasn't resolved.
    const oldText = real?.oldText ?? f.oldText;
    const newText = real?.newText ?? f.newText;

    // The git-backed diff is the whole file; collapse unchanged context to
    // hunks so the actual edit isn't buried (and the DOM stays small). When we
    // only have the ACP snippet there's nothing to collapse — it's already an
    // edit-sized hunk — and skipping keeps it byte-identical to the inline card.
    const { rows, added, removed } = this.computeDiff(oldText, newText, !!real);
    // Splice back any gaps the user has expanded; the gap carries its own
    // hidden context rows so this needs no re-diff.
    const shownRows = rows.flatMap((r) =>
      r.type === 'gap' && this.expandedGaps.has(this.gapKey(f.path, r))
        ? r.hidden ?? [r]
        : [r]);
    const fullDiff = this.fullDiffPaths.has(f.path);
    const previewingLargeDiff = !fullDiff && shownRows.length > REVIEW_DIFF_ROW_PREVIEW_LIMIT;
    const renderRows = previewingLargeDiff
      ? shownRows.slice(0, REVIEW_DIFF_ROW_PREVIEW_LIMIT)
      : shownRows;
    const lang = langFromPath(f.path);
    // A git-backed full-file diff was expected (sha present) but isn't available
    // — the fetch is pending or failed, so we're showing only the ACP per-edit
    // snippet. Flag that for modified files (added/removed snippets are the
    // whole file anyway).
    const partial = !real && !!sha && f.kind === 'modified';
    const wantSplit = this.splitPref ?? this.fitsSplit;
    const split = !previewingLargeDiff && wantSplit && this.fitsSplit && oldText.length > 0;

    return html`
      <div class="diff" data-file=${f.path}>
        <div class="diff-head">
          <span class="diff-path" ${tooltip(f.path)}>${f.path}${f.edits > 1 ? html` · ${f.edits} edits` : nothing}</span>
          <span class="diff-stat">
            ${added ? html`<span class="stat-add">+${added}</span>` : nothing}
            ${removed ? html`<span class="stat-del">−${removed}</span>` : nothing}
          </span>
          ${oldText.length > 0 && this.fitsSplit ? html`
            <button
              class="diff-layout"
              ${tooltip(split ? 'Switch to unified view' : 'Switch to side-by-side view')}
              @click=${() => { this.splitPref = !split; }}
            >${split ? 'Unified' : 'Split'}</button>
          ` : nothing}
        </div>
        ${partial
          ? html`<div class="diff-note">Showing the edited snippet only — full-file diff unavailable.</div>`
          : nothing}
        ${previewingLargeDiff
          ? html`<div class="diff-note">
              Showing first ${REVIEW_DIFF_ROW_PREVIEW_LIMIT} of ${shownRows.length} diff rows.
              <button @click=${() => this.showFullDiff(f.path)}>Show full diff</button>
            </div>`
          : nothing}
        ${split ? this.renderDiffSplit(f.path, renderRows, lang) : this.renderDiffUnified(f.path, renderRows, lang)}
      </div>
    `;
  }

  private renderDiffUnified(path: string, rows: DiffRow[], lang?: string) {
    return html`
      <div class="diff-body unified">
        ${rows.map((r) => {
          if (r.type === 'gap') return this.gapRow(path, r, 3);
          const text = r.type === 'del' ? r.oldText! : r.newText ?? r.oldText ?? '';
          return html`<div class="drow ${r.type}">
            <span class="gutter">${r.oldLine ?? ''}</span>
            <span class="gutter">${r.newLine ?? ''}</span>
            <span class="code">${this.hl(text, lang)}</span>
          </div>`;
        })}
      </div>
    `;
  }

  private renderDiffSplit(path: string, rows: DiffRow[], lang?: string) {
    const pairs = pairRows(rows);
    return html`
      <div class="diff-body split">
        ${pairs.map((p) => p.left?.type === 'gap'
          ? this.gapRow(path, p.left, 2)
          : html`
          <div class="dcell ${p.left ? p.left.type : 'empty'}">
            <span class="gutter">${p.left?.oldLine ?? ''}</span>
            <span class="code">${p.left ? this.hl(p.left.oldText ?? '', lang) : nothing}</span>
          </div>
          <div class="dcell ${p.right ? p.right.type : 'empty'}">
            <span class="gutter">${p.right?.newLine ?? ''}</span>
            <span class="code">${p.right ? this.hl(p.right.newText ?? '', lang) : nothing}</span>
          </div>
        `)}
      </div>
    `;
  }

  // Collapsed-context marker standing in for `r.count` unchanged lines. `cols`
  // is the grid column span (4 in unified, 2 dcells × the split grid).
  private gapRow(path: string, r: DiffRow, cols: number) {
    const n = r.count ?? 0;
    return html`<button
      class="gap"
      style="grid-column: span ${cols}"
      ${tooltip('Expand hidden lines')}
      @click=${() => this.expandGapAt(path, r)}
    >⋯ Expand ${n} unchanged ${n === 1 ? 'line' : 'lines'}</button>`;
  }

  private hl(text: string, lang?: string) {
    if (text === '') return html`<br />`;
    return unsafeHTML(highlightLine(text, lang));
  }
}
