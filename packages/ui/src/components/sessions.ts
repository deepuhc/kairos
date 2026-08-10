import { LitElement, html, css, nothing } from 'lit';
import { skeletonStyles, skeletonRows } from '../styles/skeleton.js';
import { emptyState, emptyStateStyles } from './empty-state.js';
import { icon } from './icons.js';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  getSessions, getAgents, exportSessionUrl, renameSession, pinSession, unpinSession, deleteSession, deleteSessions, revealInFolder,
  type SessionEntry,
} from '../services/api.js';
import { filterSessions, orderSessionsForHistory } from '../services/session-search.js';
import {
  pruneSessionSelection,
  setVisibleSessionSelection,
  toggleSessionSelection,
  visibleSelectionState,
} from '../services/session-selection.js';
import { loadLastAgent } from '../services/agent-prefs-sync.js';
import './agent-logo.js';
import { hasAgentLogo } from './agent-logo.js';
import { tooltip, overflowTooltip } from '../directives/tooltip.js';
import { renderDeleteButton, confirmDeleteStyles } from './confirm-delete.js';
import './session-preview.js';

// The tool filter is always-available 'all' plus a data-driven set of agent
// ids: those the user has actually used (present in session history) unioned
// with those currently installed. A hardcoded roster would list agents the
// user has neither run nor installed, so we derive it at runtime instead.
type ToolFilter = string;

const SINCE_OPTIONS = ['1d', '7d', '30d', '90d'] as const;
type Since = typeof SINCE_OPTIONS[number];

function relativeTime(iso: string): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Map a raw fetch/error message to something a user can act on. The standalone
// dev server has no /api/sessions route, so a bare "Not Found" is common and
// meaningless on its own — reframe it as an availability problem. Pure/exported.
export function friendlyError(message: string): string {
  const m = (message || '').trim();
  if (!m || /not found|404/i.test(m)) {
    return 'Session history is unavailable right now. It may not be supported by this server.';
  }
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "Couldn't reach the server. Check that it's running and try again.";
  }
  return m;
}

// Compute the tool-filter pill set (excluding the always-present 'all'): the
// union of agents seen in session history (`used`) and installed agents. It
// accumulates onto `previous` so pills never vanish when the user narrows the
// list by tool — otherwise filtering to one agent would drop every other pill.
// Pure and exported for unit testing.
export function deriveToolOptions(
  used: Iterable<string>,
  installed: Iterable<string>,
  previous: Iterable<string> = [],
): string[] {
  const set = new Set<string>(previous);
  for (const t of used) if (t) set.add(t);
  for (const id of installed) if (id) set.add(id);
  return [...set].sort();
}

// Exported for unit testing. `user` is the current OS username (window.USER at
// runtime); when it's known we tilde-shorten that exact home dir first, then
// fall back to a best-effort regex for any other user's home.
export function shortDir(dir: string, user?: string): string {
  const home = user ? '/Users/' + user : '';
  if (home && dir.startsWith(home)) return '~' + dir.slice(home.length);
  // Best-effort tilde-shortening
  return dir.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

@customElement('kairos-sessions')
export class DevaiSessions extends LitElement {
  @state() private sessions: SessionEntry[] = [];
  @state() private loading = true;
  @state() private filter = '';
  @state() private toolFilter: ToolFilter = 'all';
  // Agent ids to offer as filter pills, beyond the always-present 'all'. Union
  // of used (seen in history) and installed agents; populated once on connect.
  @state() private toolOptions: string[] = [];
  @state() private since: Since = '7d';
  @state() private activeOnly = false;
  @state() private cwdOnly = false;
  @state() private error: string | null = null;
  @state() private unsupported = false;
  // Id of the row being renamed inline, and its working text.
  @state() private renamingId: string | null = null;
  @state() private renameValue = '';
  // Two-step delete: id armed for confirmation, and the id mid-delete.
  @state() private confirmingDeleteId: string | null = null;
  @state() private deletingId: string | null = null;
  @state() private selectedIds = new Set<string>();
  @state() private confirmingBulkDelete = false;
  @state() private bulkDeleting = false;
  @state() private pinningId: string | null = null;
  // Session shown in the read-only preview modal, or null when closed.
  @state() private previewing: SessionEntry | null = null;

  // Memoize the filtered+ordered list: render() recomputes it every render and
  // filterSessions rebuilds a lowercased haystack per session each pass. Cache
  // on (sessions identity, filter) so a keystroke filters once and unrelated
  // state changes (rename, delete-confirm) don't re-scan.
  private orderedCache: { sessions: SessionEntry[]; filter: string; value: SessionEntry[] } | null = null;

  private orderedSessions(): SessionEntry[] {
    const cache = this.orderedCache;
    if (cache && cache.sessions === this.sessions && cache.filter === this.filter) return cache.value;
    const value = orderSessionsForHistory(filterSessions(this.sessions, this.filter));
    this.orderedCache = { sessions: this.sessions, filter: this.filter, value };
    return value;
  }
  // Most-recently-used agent id, for the "Search with <agent>" button. Read once
  // at construction from the same store the Agents tab uses.
  private lastAgent = loadLastAgent();

  static styles = [skeletonStyles, emptyStateStyles, confirmDeleteStyles, css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
    }
    .subtitle {
      color: var(--gray);
      margin: 4px 0 18px;
      font-size: var(--font-size-base);
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
    }
    input.search {
      flex: 1;
      min-width: 200px;
      padding: 8px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
    }
    input.search:focus { outline: none; border-color: var(--accent-a35); }
    input[type="checkbox"] {
      accent-color: var(--accent);
    }
    .pill-group {
      display: flex;
      gap: 4px;
    }
    .pill-btn {
      padding: 6px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-base);
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .pill-btn:hover { background: var(--w10); color: var(--white); }
    .pill-btn.active { background: var(--accent-a25); border-color: var(--accent-a35); color: var(--purple-light); }
    .pill-btn.search-agent {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--white);
      border-color: var(--accent-a35);
    }
    .pill-btn.search-agent:hover:not(:disabled) { background: var(--accent-a25); }
    .pill-btn.search-agent:disabled { opacity: 0.45; cursor: default; }
    .bulk-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: -4px 0 14px;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--surface-raised);
    }
    .bulk-left, .bulk-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .bulk-check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--white);
      font-size: var(--font-size-sm);
      cursor: pointer;
      user-select: none;
    }
    .bulk-count {
      color: var(--gray);
      font-size: var(--font-size-sm);
    }
    .bulk-btn {
      padding: 6px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: var(--font);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .bulk-btn:hover:not(:disabled) {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .bulk-btn.danger {
      color: var(--red);
      border-color: var(--red-a25);
      background: var(--red-a15);
    }
    .bulk-btn.danger:hover:not(:disabled) {
      color: var(--bright-white);
      background: var(--red);
      border-color: var(--red);
    }
    .bulk-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 3fr) auto minmax(0, 1.5fr) auto auto;
      gap: 12px;
      padding: 12px 14px;
      align-items: center;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      transition: all var(--transition-fast);
    }
    .row:hover { border-color: var(--glass-border-hover); background: var(--glass-bg-hover); }
    .row.selected {
      border-color: var(--accent-a35);
      background: var(--accent-a10);
    }
    @media (max-width: 720px) {
      .row { grid-template-columns: 1fr; }
    }
    .select-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      cursor: pointer;
    }
    .title-cell { min-width: 0; }
    .title-line {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .pinned-marker {
      flex-shrink: 0;
      display: inline-flex;
      color: var(--amber);
    }
    .title {
      font-size: var(--font-size-md);
      color: var(--bright-white);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    /* Hover-revealed pencil to rename a session inline. */
    .edit {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm, 5px);
      opacity: 0;
      transition: all var(--transition-fast);
    }
    .row:hover .edit { opacity: 1; }
    .edit:hover { color: var(--bright-white); background: var(--w8); }
    .edit svg { display: block; }
    .rename-input {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      padding: 2px 6px;
      border: 1px solid var(--accent-a35);
      border-radius: 4px;
      background: var(--w5);
      color: var(--bright-white);
      font-size: var(--font-size-md);
      font-weight: 600;
      font-family: var(--font);
      outline: none;
    }
    /* First-message preview — richer context than the compact sidebar rows. */
    .preview {
      font-size: var(--font-size-sm);
      color: var(--gray);
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      margin-top: 2px;
      font-family: var(--font-mono);
    }
    .tool-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 10px;
      border-radius: 99px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      background: var(--w8);
      color: var(--gray);
    }
    .tool-pill.claude { background: var(--accent-a15); color: var(--purple-light); }
    .tool-pill.codex { background: var(--green-a15); color: var(--emerald); }
    .tool-pill.gemini { background: var(--amber-a25); color: var(--amber); }
    .active-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 6px var(--green-a30);
    }
    .dir {
      font-family: var(--font-mono);
      color: var(--purple-light);
      font-size: var(--font-size-sm);
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dir:hover { color: var(--bright-white); }
    .when {
      font-size: var(--font-size-sm);
      color: var(--gray);
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 6px;
    }
    .actions button, .actions a {
      padding: 5px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      cursor: pointer;
      text-decoration: none;
      transition: all var(--transition-fast);
    }
    .actions button:hover, .actions a:hover {
      background: var(--accent-a15);
      color: var(--bright-white);
      border-color: var(--accent-a35);
    }
    .actions button.primary {
      background: var(--accent-a25);
      border-color: var(--accent-a35);
      color: var(--purple-light);
    }
    .actions button.primary:hover { background: var(--accent-a35); color: var(--bright-white); }
    .actions button.icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 8px;
    }
    .actions button.icon-btn svg { display: block; }
    .actions button.pin.pinned {
      color: var(--amber);
      border-color: color-mix(in srgb, var(--amber) 35%, var(--glass-border));
      background: color-mix(in srgb, var(--amber) 10%, var(--glass-bg));
    }
    .actions button.pin:hover:not(:disabled) {
      color: var(--amber);
      border-color: color-mix(in srgb, var(--amber) 40%, var(--glass-border));
      background: color-mix(in srgb, var(--amber) 12%, var(--glass-bg));
    }
    .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .actions button.danger { color: var(--red); }
    .actions button.danger:hover:not(:disabled) {
      background: var(--red-a15, rgba(239,68,68,0.12));
      border-color: var(--red);
      color: var(--red);
    }
    .err {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      background: var(--red-a15);
      color: var(--red);
      border: 1px solid var(--red-a25);
      border-radius: var(--radius-lg);
      margin-bottom: 12px;
    }
    .err-retry {
      flex-shrink: 0;
      padding: 5px 14px;
      border: 1px solid var(--red-a25);
      border-radius: var(--radius);
      background: var(--red-a15);
      color: var(--red);
      font-family: var(--font);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .err-retry:hover { background: var(--red); color: var(--bright-white); border-color: var(--red); }
    .loading, .empty {
      padding: 32px;
      text-align: center;
      color: var(--gray);
    }
    /* Pushed to the right edge on wide rows; wraps as one atomic group when the
       header runs out of horizontal room, so Refresh is never clipped. */
    .toolbar-right {
      margin-left: auto;
    }
    .delete-backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--overlay-scrim, rgba(0, 0, 0, 0.5));
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }
    .delete-dialog {
      width: min(440px, 100%);
      background: var(--surface-modal);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.45));
      padding: 18px 18px 16px;
      animation: pop-in 0.16s ease-out;
    }
    @keyframes pop-in {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }
    .dd-title {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
      margin-bottom: 8px;
    }
    .dd-body {
      font-size: var(--font-size-sm);
      color: var(--gray);
      line-height: 1.5;
    }
    .dd-list {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: var(--radius);
      background: var(--w5);
      border: 1px solid var(--w8);
      color: var(--bright-white);
    }
    .dd-item {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dd-more {
      margin-top: 2px;
      color: var(--neutral-gray);
    }
    .dd-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 18px;
    }
    .dd-btn {
      padding: 7px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: var(--font);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .dd-btn:hover:not(:disabled) { border-color: var(--glass-border-hover); background: var(--w8); }
    .dd-btn.danger {
      background: var(--red-a15);
      border-color: var(--red-a25, var(--red));
      color: var(--red);
      font-weight: 600;
    }
    .dd-btn.danger:hover:not(:disabled) { background: var(--red); color: var(--bright-white); border-color: var(--red); }
    .dd-btn:disabled { opacity: 0.5; cursor: default; }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.load();
    this.loadInstalledAgents();
  }

  // The installed-agents baseline for the tool-filter pills. Fetched once,
  // best-effort — a failure just means pills come only from used history. Kept
  // separate from `load()` so it survives re-filtering (installed agents should
  // stay offered even when the current filter matches no sessions).
  private installedAgents: string[] = [];

  private async loadInstalledAgents() {
    try {
      const { agents } = await getAgents();
      this.installedAgents = agents.filter((a) => a.installed).map((a) => a.id);
      this.refreshToolOptions();
    } catch {
      // No installed baseline — pills fall back to used-history only.
    }
  }

  // Recompute the pill set from the currently-loaded sessions plus the installed
  // baseline, accumulating onto the existing options so narrowing by tool never
  // drops pills. Cheap; called after each load and after the agents fetch.
  private refreshToolOptions() {
    const used = this.sessions.map((s) => s.tool);
    this.toolOptions = deriveToolOptions(used, this.installedAgents, this.toolOptions);
  }

  private async load() {
    this.loading = true;
    this.error = null;
    this.unsupported = false;
    try {
      const res = await getSessions({
        active: this.activeOnly,
        cwdOnly: this.cwdOnly,
        apps: this.toolFilter === 'all' ? undefined : this.toolFilter,
        since: this.since,
      });
      this.sessions = res.sessions;
      this.refreshToolOptions();
      this.selectedIds = pruneSessionSelection(this.selectedIds, res.sessions);
      if (this.selectedIds.size === 0) this.confirmingBulkDelete = false;
    } catch (err: any) {
      this.error = err.message;
      this.unsupported = err.unsupported === true;
    } finally {
      this.loading = false;
    }
  }

  private resume(s: SessionEntry) {
    // Hand off to the Agents tab — it replays history inline when the agent
    // supports loadSession and falls back to a terminal resume when it doesn't.
    this.dispatchEvent(new CustomEvent('resume-in-agents', {
      detail: s,
      bubbles: true,
      composed: true,
    }));
  }

  // Open the OS file explorer at the folder holding this session's transcript —
  // a rare "let me poke around the .jsonl on disk" escape hatch. The backend
  // reveals the directory containing the file it resolves from the session id.
  private async revealFile(s: SessionEntry) {
    if (!s.filePath) return;
    try {
      await revealInFolder(s.filePath);
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to open session folder';
    }
  }

  // ── Inline rename ──────────────────────────────────────────────────────────
  // The durable write goes to the backend override map (the kairos CLI can't
  // rename); mirrors the Agents sidebar's inline-rename interaction.
  private startRename(id: string, currentTitle: string) {
    this.renamingId = id;
    this.renameValue = currentTitle;
    this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>('.rename-input');
      input?.focus();
      input?.select();
    });
  }

  private async commitRename(id: string, currentTitle: string) {
    const newName = this.renameValue.trim();
    if (this.renamingId !== id) return;
    this.renamingId = null;
    if (newName === currentTitle) return;
    try {
      await renameSession(id, newName);
      await this.load();
    } catch {
      // network/disk error — leave the existing title in place
    }
  }

  private cancelRename() {
    this.renamingId = null;
  }

  private async togglePin(s: SessionEntry) {
    this.pinningId = s.id;
    try {
      if (s.pinned) {
        await unpinSession(s.id);
      } else {
        await pinSession(s.id);
      }
      await this.load();
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to update pinned session';
    } finally {
      this.pinningId = null;
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  // Permanent — the backend unlinks the session's transcript from disk. Guarded
  // by the shared two-step confirm so a stray click can't wipe a chat.
  private async confirmDelete(id: string) {
    this.deletingId = id;
    try {
      await deleteSession(id);
      this.sessions = this.sessions.filter((s) => s.id !== id);
      this.selectedIds = new Set([...this.selectedIds].filter((selectedId) => selectedId !== id));
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to delete session';
    } finally {
      this.deletingId = null;
      this.confirmingDeleteId = null;
    }
  }

  private toggleSelection(id: string) {
    this.selectedIds = toggleSessionSelection(this.selectedIds, id);
    if (this.selectedIds.size === 0) this.confirmingBulkDelete = false;
  }

  private toggleVisibleSelection(visible: SessionEntry[]) {
    const state = visibleSelectionState(this.selectedIds, visible);
    this.selectedIds = setVisibleSessionSelection(this.selectedIds, visible, !state.allVisibleSelected);
    if (this.selectedIds.size === 0) this.confirmingBulkDelete = false;
  }

  private clearSelection() {
    this.selectedIds = new Set();
    this.confirmingBulkDelete = false;
  }

  private selectedSessions(): SessionEntry[] {
    return this.sessions.filter((session) => this.selectedIds.has(session.id));
  }

  private selectionLabel(count = this.selectedIds.size): string {
    return `${count} session${count === 1 ? '' : 's'}`;
  }

  private sessionTitle(s: SessionEntry): string {
    return s.title || s.firstMessage || s.id.slice(0, 8);
  }

  private friendlyError(message: string): string {
    return friendlyError(message);
  }

  private formatBulkFailureMessage(deleted: number, failures: Array<{ id: string; error: string }>): string {
    const prefix = deleted > 0 ? `Deleted ${this.selectionLabel(deleted)}. ` : '';
    const shown = failures
      .slice(0, 3)
      .map((failure) => `${failure.id.slice(0, 8)}: ${failure.error}`)
      .join('; ');
    const more = failures.length > 3 ? `; ${failures.length - 3} more` : '';
    return `${prefix}${failures.length} session${failures.length === 1 ? '' : 's'} failed to delete${shown ? ` (${shown}${more})` : ''}.`;
  }

  private async deleteSelectedSessions() {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    this.bulkDeleting = true;
    try {
      const result = await deleteSessions(ids);
      const deleted = new Set(result.deleted);
      if (deleted.size > 0) {
        this.sessions = this.sessions.filter((session) => !deleted.has(session.id));
        this.selectedIds = new Set([...this.selectedIds].filter((id) => !deleted.has(id)));
      }
      if (result.failures.length > 0) {
        this.error = this.formatBulkFailureMessage(result.deleted.length, result.failures);
      } else {
        this.error = null;
        this.confirmingBulkDelete = false;
      }
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to delete selected sessions';
    } finally {
      this.bulkDeleting = false;
      if (this.selectedIds.size === 0) this.confirmingBulkDelete = false;
    }
  }

  private renderRenameInput(id: string, currentTitle: string) {
    return html`<input
      class="rename-input"
      type="text"
      .value=${this.renameValue}
      @click=${(e: Event) => e.stopPropagation()}
      @input=${(e: Event) => { this.renameValue = (e.target as HTMLInputElement).value; }}
      @keydown=${(e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.commitRename(id, currentTitle);
        if (e.key === 'Escape') this.cancelRename();
      }}
      @blur=${() => this.commitRename(id, currentTitle)}
    />`;
  }

  // Readable name for the MRU agent (title-cased id — the picker's full label
  // lives in the Agents tab; this button just needs something legible).
  private agentDisplayName(): string {
    const id = this.lastAgent;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  // Opt-in deep search: hand the current query plus the visible session corpus
  // to the MRU agent, which reads transcripts to find the session the user
  // means. The Agents tab (via app.ts) launches the agent and auto-sends the
  // prompt. We pass the already-fetched, already-filtered list so the agent
  // sees exactly what's on screen and we avoid a second fetch.
  private searchWithAgent() {
    const query = this.filter.trim();
    if (!query) return;
    // Prefer the metadata-filtered subset, but if the built-in search found
    // nothing (the whole point of escalating to the agent), hand it everything.
    const narrowed = filterSessions(this.sessions, this.filter);
    const sessions = narrowed.length > 0 ? narrowed : this.sessions;
    // `sessions` is the corpus shown to the agent (kept narrow to bound the
    // prompt); `allSessions` is the full History list the agent's cited ids are
    // matched against for resume chips — the whole point of deep search is to
    // surface sessions the metadata filter missed, which live outside `sessions`.
    this.dispatchEvent(new CustomEvent('search-with-agent', {
      detail: { query, sessions, allSessions: this.sessions },
      bubbles: true,
      composed: true,
    }));
  }

  private navigateToWorkspace(dir: string) {
    // Cross-link to the VSCode tab, hint the path so the picker can highlight.
    this.dispatchEvent(new CustomEvent('navigate', {
      detail: 'vscode',
      bubbles: true,
      composed: true,
    }));
    // Best-effort: emit a global event the workspace-picker can listen for.
    window.dispatchEvent(new CustomEvent('focus-workspace', { detail: { path: dir } }));
  }

  private renderBulkBar(filtered: SessionEntry[]) {
    const state = visibleSelectionState(this.selectedIds, filtered);
    const selectedCount = this.selectedIds.size;
    return html`
      <div class="bulk-bar">
        <div class="bulk-left">
          <label class="bulk-check">
            <input
              type="checkbox"
              .checked=${state.allVisibleSelected}
              .indeterminate=${state.someVisibleSelected && !state.allVisibleSelected}
              ?disabled=${state.visibleCount === 0 || this.bulkDeleting}
              @change=${() => this.toggleVisibleSelection(filtered)}
            />
            Select all visible
          </label>
          <span class="bulk-count">
            ${selectedCount > 0
              ? `${this.selectionLabel(selectedCount)} selected`
              : `${state.visibleCount} visible`}
          </span>
        </div>
        <div class="bulk-actions">
          ${selectedCount > 0
            ? html`<button class="bulk-btn" ?disabled=${this.bulkDeleting} @click=${() => this.clearSelection()}>Clear selection</button>`
            : nothing}
          <button
            class="bulk-btn danger"
            ?disabled=${selectedCount === 0 || this.bulkDeleting}
            @click=${() => { this.confirmingBulkDelete = true; }}
          >
            Delete selected
          </button>
        </div>
      </div>
    `;
  }

  private renderBulkDeleteDialog() {
    if (!this.confirmingBulkDelete) return nothing;
    const selected = this.selectedSessions();
    const count = this.selectedIds.size;
    if (count === 0) return nothing;
    const preview = selected.slice(0, 5);
    const hiddenCount = Math.max(0, count - preview.length);
    return html`
      <div
        class="delete-backdrop"
        @click=${() => { if (!this.bulkDeleting) this.confirmingBulkDelete = false; }}
      >
        <div
          class="delete-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label="Delete selected sessions"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="dd-title">Delete ${this.selectionLabel(count)}?</div>
          <div class="dd-body">
            This permanently deletes the selected conversation transcripts from disk. This cannot be undone.
            <div class="dd-list">
              ${preview.map((session) => html`<div class="dd-item">${this.sessionTitle(session)}</div>`)}
              ${hiddenCount > 0 ? html`<div class="dd-more">and ${hiddenCount} more</div>` : nothing}
            </div>
          </div>
          <div class="dd-actions">
            <button class="dd-btn" ?disabled=${this.bulkDeleting} @click=${() => { this.confirmingBulkDelete = false; }}>Cancel</button>
            <button class="dd-btn danger" ?disabled=${this.bulkDeleting} @click=${() => this.deleteSelectedSessions()}>
              ${this.bulkDeleting ? 'Deleting...' : `Delete ${count}`}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`
        <h2>History</h2>
        <div class="subtitle">Browse, search, and resume every AI coding session across all projects.</div>
        ${skeletonRows(6)}
      `;
    }
    if (this.unsupported) {
      return html`
        <h2>History</h2>
        <div class="subtitle">Browse, search, and resume every AI coding session across all projects.</div>
        <div class="empty">${this.error}</div>
      `;
    }
    const filtered = this.orderedSessions();

    return html`
      <h2>History</h2>
      <div class="subtitle">Browse, search, and resume every AI coding session across all projects.</div>
      ${this.error
        ? html`<div class="err">
            <span>${this.friendlyError(this.error)}</span>
            <button class="err-retry" @click=${() => this.load()}>Retry</button>
          </div>`
        : ''}
      <div class="header">
        <input
          class="search"
          placeholder="Filter by title, message, dir, or id..."
          .value=${this.filter}
          @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}
        />
        <button
          class="pill-btn search-agent"
          ?disabled=${!this.filter.trim()}
          ${tooltip(`Hand this query to ${this.agentDisplayName()} — it reads the transcripts to find the session you mean`)}
          @click=${() => this.searchWithAgent()}
        >
          ${hasAgentLogo(this.lastAgent) ? html`<agent-logo .agent=${this.lastAgent} .size=${13}></agent-logo>` : icon.star(13)}
          Search with ${this.agentDisplayName()}
        </button>
        <div class="pill-group">
          ${['all', ...this.toolOptions].map((t) => html`
            <button
              class="pill-btn ${this.toolFilter === t ? 'active' : ''}"
              @click=${async () => { this.toolFilter = t; await this.load(); }}
            >${t}</button>
          `)}
        </div>
        <div class="pill-group">
          ${SINCE_OPTIONS.map((s) => html`
            <button
              class="pill-btn ${this.since === s ? 'active' : ''}"
              ${tooltip(`Show sessions from the last ${s}`)}
              @click=${async () => { this.since = s; await this.load(); }}
            >${s}</button>
          `)}
        </div>
        <div class="pill-group toolbar-right">
          <button
            class="pill-btn ${this.activeOnly ? 'active' : ''}"
            ${tooltip('Only sessions with running processes')}
            @click=${async () => { this.activeOnly = !this.activeOnly; await this.load(); }}
          >Active</button>
          <button
            class="pill-btn ${this.cwdOnly ? 'active' : ''}"
            ${tooltip("Only show sessions in the server's current directory")}
            @click=${async () => { this.cwdOnly = !this.cwdOnly; await this.load(); }}
          >Here</button>
          <button class="pill-btn" @click=${() => this.load()}>Refresh</button>
        </div>
      </div>
        ${filtered.length > 0 || this.selectedIds.size > 0 ? this.renderBulkBar(filtered) : nothing}
        ${filtered.length === 0
          ? this.error
            ? nothing
            : this.filter.trim() || this.cwdOnly
            ? emptyState({
                icon: icon.circle(22),
                title: 'No matching sessions',
                message: 'No sessions match your filter. Clear it to see everything.',
                actionLabel: 'Clear filter',
                onAction: () => { this.filter = ''; if (this.cwdOnly) { this.cwdOnly = false; this.load(); } },
              })
            : emptyState({
                icon: icon.circle(22),
                title: 'No sessions yet',
                message: 'Sessions you start in the Agents tab show up here, ready to resume any time.',
              })
          : html`<div class="grid">${repeat(filtered, (s) => s.id, (s) => this.renderRow(s))}</div>`}
        ${this.previewing
          ? html`<kairos-session-preview
              .session=${this.previewing}
              @close=${() => { this.previewing = null; }}
              @resume=${(e: CustomEvent<SessionEntry>) => { this.previewing = null; this.resume(e.detail); }}
            ></kairos-session-preview>`
          : ''}
        ${this.renderBulkDeleteDialog()}
      `;
    }

    private renderRow(s: SessionEntry) {
      const displayTitle = this.sessionTitle(s);
      // Show the first message as a preview only when it isn't already the title.
      const preview = s.firstMessage && s.firstMessage !== displayTitle ? s.firstMessage : '';
      const selected = this.selectedIds.has(s.id);
      return html`
        <div class="row ${selected ? 'selected' : ''}">
          <label class="select-cell" @click=${(e: Event) => e.stopPropagation()}>
            <input
              type="checkbox"
              .checked=${selected}
              aria-label=${`Select ${displayTitle}`}
              @change=${() => this.toggleSelection(s.id)}
            />
          </label>
          <div class="title-cell">
            <div class="title-line">
              ${this.renamingId === s.id
                ? this.renderRenameInput(s.id, displayTitle)
                : html`
                    ${s.pinned ? html`<span class="pinned-marker" ${tooltip('Pinned')}>${icon.pin(13)}</span>` : nothing}
                    <div class="title" ${overflowTooltip()}>${displayTitle}</div>
                    <button
                      class="edit"
                      ${tooltip('Rename')}
                      aria-label="Rename session"
                      @click=${(e: Event) => { e.stopPropagation(); this.startRename(s.id, displayTitle); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11.5 2.5l2 2L6 12l-2.5.5.5-2.5 7.5-7.5z"/>
                      </svg>
                    </button>
                  `}
            </div>
            ${preview ? html`<div class="preview" ${tooltip(preview)}>${preview}</div>` : ''}
            <div class="meta">${s.id.slice(0, 8)} · ${s.messages} message${s.messages === 1 ? '' : 's'}</div>
          </div>
          <span class="tool-pill ${s.tool}" ${tooltip(s.tool)}>
            ${s.active ? html`<span class="active-dot"></span>` : ''}
            ${hasAgentLogo(s.tool) ? html`<agent-logo .agent=${s.tool} .size=${13}></agent-logo>` : nothing} ${s.tool}
          </span>
          <span class="dir" ${tooltip(s.dir)} @click=${() => this.navigateToWorkspace(s.dir)}>${shortDir(s.dir, (window as any).USER)}</span>
          <span class="when" ${tooltip(s.lastActive)}>${relativeTime(s.lastActive)}</span>
          <div class="actions">
            <button
              class="icon-btn pin ${s.pinned ? 'pinned' : ''}"
              ?disabled=${this.pinningId === s.id}
              ${tooltip(s.pinned ? 'Unpin from top' : 'Pin to top')}
              aria-label=${s.pinned ? 'Unpin session' : 'Pin session'}
              @click=${() => this.togglePin(s)}
            >
              ${icon.pin(15)}
            </button>
            <button ${tooltip('Preview the transcript without downloading')} @click=${() => { this.previewing = s; }}>
              Preview
            </button>
            <button class="primary" ${tooltip('Resume in the Agents tab')} @click=${() => this.resume(s)}>
              Resume
            </button>
            <a href=${exportSessionUrl(s.id, 'html')} target="_blank" rel="noopener" ${tooltip('Export as HTML')}>HTML</a>
            <a href=${exportSessionUrl(s.id, 'md')} target="_blank" rel="noopener" ${tooltip('Export as Markdown')}>MD</a>
            ${s.filePath
              ? html`<button
                  class="icon-btn"
                  ${tooltip('Show the transcript file in your file manager')}
                  aria-label="Open containing folder"
                  @click=${() => this.revealFile(s)}
                >${icon.folder(15)}</button>`
              : nothing}
            ${renderDeleteButton({
              confirming: this.confirmingDeleteId === s.id,
              saving: this.deletingId === s.id,
              onArm: () => { this.confirmingDeleteId = s.id; },
              onConfirm: () => this.confirmDelete(s.id),
              onCancel: () => { this.confirmingDeleteId = null; },
            })}
          </div>
        </div>
      `;
    }
}
