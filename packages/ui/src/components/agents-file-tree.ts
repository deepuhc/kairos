// Read-only file browser for the Agents-tab session. Fills the two gaps the
// rest of the session UI leaves: discovering files the agent hasn't touched
// (so you don't need to know a path to @-mention it) and inspecting arbitrary
// files to sanity-check the agent's context. Strictly read-only — the agent is
// the thing that edits files, so there's no save/create/edit here, which keeps
// this out of "IDE" territory.
//
// Renders in agents-view's resizable right side-panel (shared with the Review
// panel; the two are mutually exclusive). Directories lazy-load on expand;
// clicking a file previews it with the same highlighting the diff cards use.
// All filesystem access is confined to the session cwd by the backend.

import { LitElement, html, css, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { AgentSession } from '../services/agents-session.js';
import { listWorkspaceDir, readWorkspaceFile, type DirEntry } from '../services/api.js';
import { isMarkdownFilePath } from '../services/file-preview.js';
import { highlightCode, hljsTheme } from './code-highlight.js';
import { langFromPath } from './agents-tool-call.js';
import { markdownStyles, renderMarkdownCached } from './markdown.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';

interface Preview {
  content: string;
  truncated: boolean;
  binary: boolean;
  bytes: number;
}

interface SelectedPathRequest {
  path: string;
  nonce: number;
}

const TREE_WIDTH_KEY = 'kairos-agents:file-tree-width';
const TREE_WIDTH_MIN = 180;
const TREE_WIDTH_MAX = 640;
const TREE_WIDTH_DEFAULT = 220;
const TREE_PREVIEW_MIN = 220;
const TREE_SPLITTER_WIDTH = 7;

const folderIcon = svg`<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3.1a1.5 1.5 0 0 1 1.06.44l.9.9A.5.5 0 0 0 8.92 4.5H12.5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" fill="none" stroke="currentColor" stroke-width="1.3"/>`;
const fileIcon = svg`<path d="M4 2.5h5L12 5.5V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13zM9 2.5V5a.5.5 0 0 0 .5.5H12" fill="none" stroke="currentColor" stroke-width="1.3"/>`;

function clampTreeWidth(px: number): number {
  return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(px)));
}

function loadTreeWidth(): number {
  try {
    const raw = Number(localStorage.getItem(TREE_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampTreeWidth(raw) : TREE_WIDTH_DEFAULT;
  } catch {
    return TREE_WIDTH_DEFAULT;
  }
}

function saveTreeWidth(px: number) {
  try {
    localStorage.setItem(TREE_WIDTH_KEY, String(px));
  } catch { /* quota / disabled — ignore */ }
}

@customElement('agents-file-tree')
export class AgentsFileTree extends LitElement {
  @property({ attribute: false }) session!: AgentSession;
  @property({ attribute: false }) selectedPathRequest: SelectedPathRequest | null = null;

  // Fetched directory contents, keyed by relative dir path ('' = root).
  @state() private dirCache = new Map<string, DirEntry[]>();
  @state() private expanded = new Set<string>();
  @state() private loading = new Set<string>();
  @state() private truncatedDirs = new Set<string>();
  @state() private selectedPath: string | null = null;
  @state() private preview: Preview | null = null;
  @state() private previewLoading = false;
  @state() private error: string | null = null;
  @state() private treeWidth = loadTreeWidth();
  @state() private treeResizing = false;

  // Track which session/cwd we've loaded so a session switch re-fetches.
  private loadedCwd: string | null = null;
  private appliedPathRequestNonce = 0;
  private treeResizeStartX = 0;
  private treeResizeStartW = 0;

  connectedCallback() {
    super.connectedCallback();
    this.ensureRoot();
  }

  updated(_changed: PropertyValues<this>) {
    this.ensureRoot();
    this.applySelectedPathRequest();
  }

  disconnectedCallback() {
    if (this.treeResizing) this.endTreeResize();
    super.disconnectedCallback();
  }

  // Session's working directory — the isolated worktree when one is in use,
  // else the session cwd. Mirrors agents-view/agents-review sessionWorkdir.
  private sessionWorkdir(): string {
    return this.session.worktree?.worktreePath ?? this.session.cwd;
  }

  private ensureRoot() {
    const cwd = this.sessionWorkdir();
    if (this.loadedCwd === cwd) return;
    this.loadedCwd = cwd;
    this.dirCache = new Map();
    this.expanded = new Set();
    this.truncatedDirs = new Set();
    this.selectedPath = null;
    this.preview = null;
    this.error = null;
    this.appliedPathRequestNonce = 0;
    this.fetchDir('');
  }

  private async fetchDir(relDir: string) {
    if (this.dirCache.has(relDir) || this.loading.has(relDir)) return;
    this.loading = new Set(this.loading).add(relDir);
    const cwd = this.sessionWorkdir();
    try {
      const { entries, truncated } = await listWorkspaceDir(cwd, relDir);
      // Bail if the session changed out from under us mid-fetch.
      if (cwd !== this.sessionWorkdir()) return;
      this.dirCache = new Map(this.dirCache).set(relDir, entries);
      if (truncated) this.truncatedDirs = new Set(this.truncatedDirs).add(relDir);
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to list directory';
    } finally {
      const next = new Set(this.loading);
      next.delete(relDir);
      this.loading = next;
    }
  }

  private toggleDir(relDir: string) {
    const next = new Set(this.expanded);
    if (next.has(relDir)) {
      next.delete(relDir);
    } else {
      next.add(relDir);
      this.fetchDir(relDir);
    }
    this.expanded = next;
  }

  private async selectFile(relPath: string) {
    if (this.selectedPath === relPath) return;
    this.selectedPath = relPath;
    this.preview = null;
    this.previewLoading = true;
    const cwd = this.sessionWorkdir();
    try {
      const res = await readWorkspaceFile(cwd, relPath);
      if (cwd !== this.sessionWorkdir() || this.selectedPath !== relPath) return;
      this.preview = res;
    } catch (err: any) {
      if (this.selectedPath !== relPath) return;
      this.preview = { content: `Couldn't read this file: ${err?.message ?? 'unknown error'}`, truncated: false, binary: false, bytes: 0 };
    } finally {
      this.previewLoading = false;
    }
  }

  private applySelectedPathRequest() {
    const req = this.selectedPathRequest;
    if (!req || req.nonce === this.appliedPathRequestNonce) return;
    this.appliedPathRequestNonce = req.nonce;
    this.expandParents(req.path);
    void this.selectFile(req.path);
  }

  private expandParents(relPath: string) {
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length <= 1) return;
    const next = new Set(this.expanded);
    let dir = '';
    for (const part of parts.slice(0, -1)) {
      dir = dir ? `${dir}/${part}` : part;
      next.add(dir);
      void this.fetchDir(dir);
    }
    this.expanded = next;
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private startTreeResize = (e: PointerEvent) => {
    e.preventDefault();
    this.treeResizing = true;
    this.treeResizeStartX = e.clientX;
    this.treeResizeStartW = this.treeWidth;
    this.setAttribute('data-tree-resizing', '');
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', this.onTreeResizeMove);
    window.addEventListener('pointerup', this.onTreeResizeEnd);
  };

  private onTreeResizeMove = (e: PointerEvent) => {
    if (!this.treeResizing) return;
    const raw = this.treeResizeStartW + (e.clientX - this.treeResizeStartX);
    const body = this.renderRoot.querySelector('.body') as HTMLElement | null;
    const maxByBody = body
      ? Math.max(TREE_WIDTH_MIN, body.clientWidth - TREE_PREVIEW_MIN - TREE_SPLITTER_WIDTH)
      : TREE_WIDTH_MAX;
    const max = Math.min(TREE_WIDTH_MAX, maxByBody);
    this.treeWidth = Math.min(max, clampTreeWidth(raw));
  };

  private onTreeResizeEnd = () => {
    if (!this.treeResizing) return;
    this.endTreeResize();
    saveTreeWidth(this.treeWidth);
  };

  private endTreeResize() {
    this.treeResizing = false;
    this.removeAttribute('data-tree-resizing');
    window.removeEventListener('pointermove', this.onTreeResizeMove);
    window.removeEventListener('pointerup', this.onTreeResizeEnd);
  }

  private resetTreeWidth = () => {
    this.treeWidth = TREE_WIDTH_DEFAULT;
    saveTreeWidth(this.treeWidth);
  };

  static styles = [hljsTheme, markdownStyles, css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    /* Shadow DOM doesn't inherit the app's global scrollbar styling. */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--w8); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--w15); }

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
    .cwd {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      max-width: 45%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      text-align: left;
    }
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

    .body { flex: 1; min-height: 0; display: flex; flex-direction: row; }
    .tree {
      flex: 0 0 auto;
      box-sizing: border-box;
      min-width: ${TREE_WIDTH_MIN}px;
      overflow: auto;
      padding: 8px 8px 10px;
    }
    .splitter {
      position: relative;
      flex: 0 0 ${TREE_SPLITTER_WIDTH}px;
      cursor: col-resize;
      touch-action: none;
      z-index: 2;
    }
    .splitter::after {
      content: '';
      position: absolute;
      top: 0;
      left: 3px;
      width: 1px;
      height: 100%;
      background: var(--glass-border);
      transition: background var(--transition-fast);
    }
    .splitter:hover::after,
    :host([data-tree-resizing]) .splitter::after { background: var(--accent); }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: var(--radius);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      color: var(--gray);
      white-space: nowrap;
      overflow: hidden;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .row:hover { background: var(--w4); color: var(--white); }
    .row.selected { background: var(--accent-a15); color: var(--white); }
    .chev {
      flex-shrink: 0;
      display: inline-flex;
      width: 12px;
      color: var(--neutral-gray);
      transition: transform var(--transition-fast);
    }
    .chev svg { display: block; }
    .chev.open { transform: rotate(90deg); }
    .chev.leaf { visibility: hidden; }
    .icon { flex-shrink: 0; width: 15px; height: 15px; color: var(--neutral-gray); }
    .name { overflow: hidden; text-overflow: ellipsis; }
    .more {
      padding: 3px 6px 3px 8px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
    }
    .spin { padding: 4px 8px; font-size: var(--font-size-xs); color: var(--neutral-gray); }

    .preview { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
    .preview-head {
      position: sticky;
      top: 0;
      background: var(--surface-modal, var(--bg));
      padding: 8px 14px;
      border-bottom: 1px solid var(--w8);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--gray);
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .preview-head .ppath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .badge { color: var(--amber); flex-shrink: 0; }
    pre.code {
      margin: 0;
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      white-space: pre;
      color: var(--white);
    }
    .markdown-preview {
      padding: 18px 20px 28px;
      color: var(--white);
      font-size: var(--font-size-sm);
      line-height: 1.6;
      max-width: 860px;
    }
    .markdown-preview .md {
      max-width: 100%;
    }
    .markdown-preview .md h1 {
      margin-top: 0;
      font-size: var(--font-size-xl);
    }
    .markdown-preview .md h2 { font-size: var(--font-size-lg); }
    .markdown-preview .md h3 { font-size: var(--font-size-md); }
    .markdown-preview .md table {
      border-collapse: collapse;
      width: 100%;
      margin: 10px 0;
      font-size: var(--font-size-sm);
    }
    .markdown-preview .md th,
    .markdown-preview .md td {
      border: 1px solid var(--w10);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    .markdown-preview .md th {
      color: var(--white);
      background: var(--w5);
      font-weight: 650;
    }
    .placeholder {
      margin: auto;
      padding: 40px 20px;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
    }
    .error { color: var(--red); padding: 10px 14px; font-size: var(--font-size-sm); }
  `];

  render() {
    return html`
      <div class="head">
        <h2>Files</h2>
        <span class="cwd" ${tooltip(this.sessionWorkdir())}>${this.sessionWorkdir()}</span>
        <button class="close" ${tooltip('Close files')} @click=${() => this.close()}>${icon.close(15)}</button>
      </div>
      <div class="body">
        <div class="tree" style="width:${this.treeWidth}px">
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
          ${this.renderLevel('', 0)}
        </div>
        <div
          class="splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file tree"
          aria-valuemin=${TREE_WIDTH_MIN}
          aria-valuemax=${TREE_WIDTH_MAX}
          aria-valuenow=${this.treeWidth}
          @pointerdown=${this.startTreeResize}
          @dblclick=${this.resetTreeWidth}
        ></div>
        ${this.renderPreview()}
      </div>
    `;
  }

  private renderLevel(relDir: string, depth: number): TemplateResult | typeof nothing {
    const entries = this.dirCache.get(relDir);
    if (!entries) {
      return this.loading.has(relDir) ? html`<div class="spin" style="padding-left:${depth * 14 + 8}px">Loading…</div>` : nothing;
    }
    return html`
      ${entries.map((e) => this.renderRow(e, depth))}
      ${this.truncatedDirs.has(relDir)
        ? html`<div class="more" style="padding-left:${depth * 14 + 20}px">… more files not shown</div>`
        : nothing}
    `;
  }

  private renderRow(e: DirEntry, depth: number): TemplateResult {
    const isDir = e.kind === 'dir';
    const open = isDir && this.expanded.has(e.path);
    const selected = e.path === this.selectedPath;
    return html`
      <button
        class="row ${selected ? 'selected' : ''}"
        style="padding-left:${depth * 14 + 6}px"
        ${tooltip(e.path)}
        @click=${() => (isDir ? this.toggleDir(e.path) : this.selectFile(e.path))}
      >
        <span class="chev ${isDir ? (open ? 'open' : '') : 'leaf'}">${icon.chevronRight(12)}</span>
        <svg class="icon" viewBox="0 0 16 16">${isDir ? folderIcon : fileIcon}</svg>
        <span class="name">${e.name}</span>
      </button>
      ${open ? this.renderLevel(e.path, depth + 1) : nothing}
    `;
  }

  private renderPreview() {
    if (this.previewLoading) return html`<div class="preview"><div class="placeholder">Loading…</div></div>`;
    if (!this.selectedPath || !this.preview) {
      return html`<div class="preview"><div class="placeholder">Select a file to preview.</div></div>`;
    }
    const p = this.preview;
    return html`
      <div class="preview">
        <div class="preview-head">
          <span class="ppath" ${tooltip(this.selectedPath)}>${this.selectedPath}</span>
          ${p.truncated ? html`<span class="badge">truncated</span>` : nothing}
        </div>
        ${p.binary
          ? html`<div class="placeholder">Binary file — no preview.</div>`
          : this.renderTextPreview(p.content)}
      </div>
    `;
  }

  private renderTextPreview(content: string) {
    if (this.selectedPath && isMarkdownFilePath(this.selectedPath)) {
      const node = renderMarkdownCached(`files:${this.sessionWorkdir()}:${this.selectedPath}`, content);
      node.classList.add('md');
      return html`<div class="markdown-preview">${node}</div>`;
    }
    return html`<pre class="code">${unsafeHTML(highlightCode(content, langFromPath(this.selectedPath ?? '')).value)}</pre>`;
  }
}
