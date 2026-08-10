import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  getWorkspaces,
  addWorkspace,
  removeWorkspace,
  hideWorkspace,
  unhideWorkspace,
  updateWorkspaceConfig,
  pinWorkspace,
  unpinWorkspace,
  renameWorkspace,
  recordWorkspaceOpen,
  setWorkspaceSort,
  launchApp,
  execute,
  revealInFolder,
  openTerminal,
  type WorkspaceEntry,
  type WorkspaceConfig,
  type DiscoverySource,
  type SortBy,
} from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';

@customElement('kairos-workspace-picker')
export class DevaiWorkspacePicker extends LitElement {
  @state() private workspaces: WorkspaceEntry[] = [];
  @state() private config: WorkspaceConfig = { discoverySources: [], searchDepth: 4, excludePatterns: [], hiddenPaths: [] };
  @state() private menuOpenId: string | null = null;
  @state() private warnings: string[] = [];
  @state() private loading = false;
  @state() private filter = '';
  @state() private showAddForm = false;
  @state() private showConfigForm = false;
  @state() private addPath = '';
  @state() private addName = '';
  @state() private configSourcesText = '';
  @state() private configDepth = 4;
  @state() private configExcludePatterns: string[] = [];
  @state() private excludeInput = '';
  @state() private showHelp = false;
  @state() private showExcludeHelp = false;
  @state() private showHiddenHelp = false;
  @state() private error = '';
  @state() private sortBy: SortBy = 'name';
  @state() private renamingId: string | null = null;
  @state() private renameValue = '';

  static styles = css`
    :host {
      display: block;
      position: relative;
      z-index: 1;
    }

    .section {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--widget-shadow);
      animation: card-fade-in 0.2s cubic-bezier(0.2, 0, 0, 1) both;
    }
    .section:hover {
      border-color: var(--glass-border-hover);
      box-shadow: var(--widget-shadow-hover);
    }

    @keyframes card-fade-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .header-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--bright-white);
    }
    .header-desc {
      font-size: var(--font-size-base);
      color: var(--gray);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .launch-badge {
      padding: 8px 20px;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--on-accent);
      font-size: var(--font-size-md);
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .launch-badge:hover { background: var(--purple); }

    .body {
      border-top: 1px solid var(--w8);
      padding: 12px 20px 20px;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      align-items: center;
    }

    .filter-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-base);
      font-family: var(--font);
      outline: none;
      transition: border-color var(--transition-fast);
    }
    .filter-input:focus { border-color: var(--accent-a35); }
    .filter-input::placeholder { color: var(--neutral-gray); }

    .icon-btn {
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-base);
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .icon-btn:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }

    .sort-select {
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-base);
      font-family: var(--font);
      cursor: pointer;
      transition: all var(--transition-fast);
      outline: none;
    }
    .sort-select:hover, .sort-select:focus {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .sort-select option {
      background: var(--surface-raised);
      color: var(--white);
    }

    .workspace-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ws-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: var(--radius);
      transition: background var(--transition-fast);
    }
    .ws-row:hover { background: var(--w8); }
    .ws-row.missing > *:not(.ws-menu-wrap) { opacity: 0.45; }

    .ws-name {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
      white-space: nowrap;
    }
    .ws-path {
      flex: 1;
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      color: var(--neutral-gray);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      direction: rtl;
      text-align: left;
    }
    .ws-badge {
      font-size: var(--font-size-xs);
      padding: 1px 6px;
      border-radius: 99px;
      background: var(--w8);
      color: var(--gray);
      white-space: nowrap;
    }
    .ws-badge.manual { background: var(--accent-a15); color: var(--accent); }

    .ws-launch {
      padding: 3px 10px;
      border: 1px solid var(--accent-a25);
      border-radius: var(--radius);
      background: var(--accent-a15);
      color: var(--accent);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .ws-launch:hover {
      background: var(--accent);
      color: var(--on-accent);
      border-color: var(--accent);
    }

    .ws-menu-wrap {
      position: relative;
    }
    .ws-kebab {
      padding: 2px 6px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--neutral-gray);
      font-size: var(--font-size-md);
      cursor: pointer;
      transition: all var(--transition-fast);
      line-height: 1;
      letter-spacing: 2px;
    }
    .ws-kebab:hover { background: var(--w10); color: var(--bright-white); }

    .ws-dropdown {
      position: absolute;
      right: 0;
      top: 100%;
      margin-top: 4px;
      min-width: 140px;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-md);
      z-index: 10;
      padding: 4px 0;
    }
    .ws-dropdown-item {
      display: block;
      width: 100%;
      padding: 6px 12px;
      border: none;
      background: none;
      color: var(--white);
      font-size: var(--font-size-base);
      font-family: var(--font);
      text-align: left;
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .ws-dropdown-item:hover { background: var(--w8); }
    .ws-dropdown-item.danger { color: var(--red); }
    .ws-dropdown-item.danger:hover { background: var(--red-a15); }

    .pin-icon {
      color: var(--accent);
      font-size: var(--font-size-sm);
      flex-shrink: 0;
    }

    .rename-input {
      padding: 2px 6px;
      border: 1px solid var(--accent-a35);
      border-radius: 4px;
      background: var(--w5);
      color: var(--bright-white);
      font-size: var(--font-size-md);
      font-weight: 600;
      font-family: var(--font);
      outline: none;
      min-width: 80px;
      max-width: 200px;
    }

    .missing-label {
      font-size: var(--font-size-xs);
      color: var(--red);
    }

    .empty {
      padding: 24px;
      text-align: center;
      color: var(--gray);
      font-size: var(--font-size-base);
    }

    .form {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w3);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .form-label {
      font-size: var(--font-size-sm);
      color: var(--gray);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-base);
      font-family: var(--font-mono);
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--accent-a35); }
    .form-input.name { font-family: var(--font); }
    .form-input::placeholder { color: var(--neutral-gray); }

    .form-row {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .form-textarea {
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-base);
      font-family: var(--font-mono);
      outline: none;
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      min-height: 60px;
    }
    .form-textarea:focus { border-color: var(--accent-a35); }
    .form-textarea::placeholder { color: var(--neutral-gray); }

    .btn {
      padding: 6px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-base);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .btn:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .btn.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--on-accent);
    }
    .btn.primary:hover { background: var(--purple); }

    .error {
      font-size: var(--font-size-sm);
      color: var(--red);
      padding: 4px 0;
    }

    .depth-input {
      width: 60px;
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-base);
      outline: none;
    }
    .depth-input:focus { border-color: var(--accent-a35); }

    .depth-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .warnings {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    .warning {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 6px 10px;
      border-radius: var(--radius);
      background: var(--amber-a15);
      border: 1px solid var(--amber-a25);
      font-size: var(--font-size-sm);
      color: var(--amber);
      line-height: 1.4;
    }
    .warning-icon {
      flex-shrink: 0;
      font-size: var(--font-size-md);
    }
    .warning-text {
      flex: 1;
    }
    .warning-action {
      padding: 2px 8px;
      border: 1px solid var(--amber-a25);
      border-radius: 4px;
      background: transparent;
      color: var(--amber);
      font-size: var(--font-size-xs);
      font-family: var(--font);
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .warning-action:hover {
      background: var(--amber-a15);
    }
    .warning-action.danger {
      color: var(--red);
      border-color: var(--red-a25, rgba(239,68,68,0.25));
    }
    .warning-action.danger:hover {
      background: var(--red-a15, rgba(239,68,68,0.15));
    }

    .hidden-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .hidden-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--w3);
    }
    .hidden-item-path {
      flex: 1;
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      color: var(--neutral-gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      text-align: left;
    }
    .unhide-btn {
      padding: 2px 8px;
      border: 1px solid var(--glass-border);
      border-radius: 4px;
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .unhide-btn:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .hidden-empty {
      font-size: var(--font-size-sm);
      color: var(--neutral-gray);
      padding: 4px 0;
    }

    .form-label-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .help-btn {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1px solid var(--glass-border);
      background: var(--w5);
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 1;
      transition: all var(--transition-fast);
      flex-shrink: 0;
    }
    .help-btn:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .help-panel {
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w3);
      font-size: var(--font-size-sm);
      color: var(--gray);
      line-height: 1.6;
    }
    .help-panel p { margin: 0 0 8px; }
    .help-panel code {
      background: var(--w8);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
    }
    .help-section {
      margin-bottom: 8px;
    }
    .help-section:last-child { margin-bottom: 0; }

    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 8px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      min-height: 32px;
      align-items: center;
      cursor: text;
    }
    .tag-list:focus-within { border-color: var(--accent-a35); }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--w10);
      color: var(--white);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      white-space: nowrap;
      line-height: 1.6;
    }
    .tag-remove {
      border: none;
      background: none;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      cursor: pointer;
      padding: 0 1px;
      line-height: 1;
      transition: color var(--transition-fast);
    }
    .tag-remove:hover { color: var(--red); }
    .tag-input {
      flex: 1;
      min-width: 80px;
      border: none;
      background: transparent;
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      outline: none;
      padding: 0 2px;
    }
    .tag-input::placeholder { color: var(--neutral-gray); }

  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadWorkspaces();
    window.addEventListener('focus-workspace', this.handleFocusWorkspace as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('focus-workspace', this.handleFocusWorkspace as EventListener);
  }

  private handleFocusWorkspace = (e: Event) => {
    const path = (e as CustomEvent<{ path: string }>).detail?.path;
    if (!path) return;
    this.filter = path;
    // Scroll the matching workspace card into view if it's rendered.
    requestAnimationFrame(() => {
      const match = this.shadowRoot?.querySelector(`[data-ws-path="${CSS.escape(path)}"]`);
      if (match) match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  private async loadWorkspaces(refresh = false) {
    this.loading = true;
    try {
      const result = await getWorkspaces(refresh);
      this.workspaces = result.workspaces;
      this.config = result.config;
      this.warnings = result.warnings ?? [];
      this.sortBy = result.sortBy ?? 'name';
    } catch {
      // empty list is fine
    } finally {
      this.loading = false;
      this.dispatchEvent(new CustomEvent('workspace-changed', { bubbles: true, composed: true }));
    }
  }

  // `filtered` is read three times per render; recomputing means a filter pass
  // plus a full sort (and, for 'recent', re-parsing every lastOpened date O(n
  // log n) times inside the comparator) each time. Memoize on the identity of
  // its inputs so a render evaluates it once and a keystroke sorts once.
  private filteredCache: { workspaces: WorkspaceEntry[]; filter: string; sortBy: SortBy; value: WorkspaceEntry[] } | null = null;

  private get filtered(): WorkspaceEntry[] {
    const cache = this.filteredCache;
    if (cache && cache.workspaces === this.workspaces && cache.filter === this.filter && cache.sortBy === this.sortBy) {
      return cache.value;
    }
    const value = this.computeFiltered();
    this.filteredCache = { workspaces: this.workspaces, filter: this.filter, sortBy: this.sortBy, value };
    return value;
  }

  private computeFiltered(): WorkspaceEntry[] {
    let list = this.workspaces;
    if (this.filter) {
      const q = this.filter.toLowerCase();
      list = list.filter(
        (w) => w.name.toLowerCase().includes(q) || w.path.toLowerCase().includes(q),
      );
    }
    // Precompute lastOpened timestamps once so the 'recent' comparator doesn't
    // re-parse the same dates on every comparison.
    const openedAt = this.sortBy === 'recent'
      ? new Map(list.map((w) => [w, w.lastOpened ? new Date(w.lastOpened).getTime() : 0]))
      : null;
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (this.sortBy) {
        case 'source':
          if (a.source !== b.source) return a.source === 'manual' ? -1 : 1;
          return a.name.localeCompare(b.name);
        case 'path':
          return a.path.localeCompare(b.path);
        case 'recent': {
          const ta = openedAt!.get(a)!;
          const tb = openedAt!.get(b)!;
          if (ta !== tb) return tb - ta;
          return a.name.localeCompare(b.name);
        }
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }

  private async handleLaunchDefault(e: Event) {
    e.stopPropagation();
    const { operationId } = await execute(['launch', '--', 'code']);
    window.dispatchEvent(new CustomEvent('kairos-operation', {
      detail: { operationId, args: ['launch', '--', 'code'] },
    }));
  }

  private async handleLaunchWorkspace(ws: WorkspaceEntry) {
    if (!ws.exists) return;
    await launchApp(['--', 'code', ws.path]);
    recordWorkspaceOpen(ws.id).catch(() => {});
  }

  private async handleAdd() {
    this.error = '';
    if (!this.addPath.trim()) {
      this.error = 'Path is required';
      return;
    }
    try {
      await addWorkspace(this.addPath.trim(), this.addName.trim() || undefined);
      this.addPath = '';
      this.addName = '';
      this.showAddForm = false;
      await this.loadWorkspaces();
    } catch (err: any) {
      this.error = err.message;
    }
  }

  private closeMenu = () => {
    this.menuOpenId = null;
  };

  private toggleMenu(ws: WorkspaceEntry, e: Event) {
    e.stopPropagation();
    if (this.menuOpenId === ws.id) {
      this.menuOpenId = null;
      return;
    }
    this.menuOpenId = ws.id;
    requestAnimationFrame(() => {
      document.addEventListener('click', this.closeMenu, { once: true });
    });
  }

  private async handleUnhide(wsPath: string) {
    try {
      await unhideWorkspace(wsPath);
      this.config = { ...this.config, hiddenPaths: this.config.hiddenPaths.filter((p) => p !== wsPath) };
      await this.loadWorkspaces();
    } catch {
      // silently fail
    }
  }

  private handleSortChange(e: Event) {
    this.sortBy = (e.target as HTMLSelectElement).value as SortBy;
    setWorkspaceSort(this.sortBy).catch(() => {});
  }

  private async handleReveal(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    try {
      await revealInFolder(ws.path);
    } catch {
      // silently fail
    }
  }

  private async handleCopyPath(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    try {
      await navigator.clipboard.writeText(ws.path);
    } catch {
      // silently fail
    }
  }

  private async handleOpenTerminal(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    const dir = ws.path.replace(/[\\/][^\\/]+$/, '');
    try {
      await openTerminal(dir);
    } catch {
      // silently fail
    }
  }

  private async handlePin(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    try {
      if (ws.pinned) {
        await unpinWorkspace(ws.id);
      } else {
        await pinWorkspace(ws.id);
      }
      await this.loadWorkspaces();
    } catch {
      // silently fail
    }
  }

  private startRename(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    this.renamingId = ws.id;
    this.renameValue = ws.name;
    this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>('.rename-input')?.focus();
    });
  }

  private async commitRename(ws: WorkspaceEntry) {
    const newName = this.renameValue.trim();
    this.renamingId = null;
    if (!newName || newName === ws.name) return;
    try {
      await renameWorkspace(ws.id, newName);
      await this.loadWorkspaces();
    } catch {
      // silently fail
    }
  }

  private cancelRename() {
    this.renamingId = null;
  }

  private async handleHide(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    try {
      await hideWorkspace(ws.path);
      await this.loadWorkspaces();
    } catch {
      // silently fail
    }
  }

  private async handleRemove(ws: WorkspaceEntry) {
    this.menuOpenId = null;
    try {
      await removeWorkspace(ws.id);
      await this.loadWorkspaces();
    } catch {
      // silently fail
    }
  }

  private async handleRescan() {
    await this.loadWorkspaces(true);
  }

  private openConfigForm() {
    this.configSourcesText = this.config.discoverySources.map(serializeSource).join('\n');
    this.configDepth = this.config.searchDepth;
    this.configExcludePatterns = [...this.config.excludePatterns];
    this.excludeInput = '';
    this.showConfigForm = true;
    this.showAddForm = false;
    this.showHelp = false;
    this.showExcludeHelp = false;
    this.showHiddenHelp = false;
    this.error = '';
  }

  private async handleSaveConfig() {
    this.error = '';

    let sources: DiscoverySource[];
    try {
      sources = this.configSourcesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseSource);
    } catch (err: any) {
      this.error = err.message;
      return;
    }

    try {
      await updateWorkspaceConfig({ discoverySources: sources, searchDepth: this.configDepth, excludePatterns: this.configExcludePatterns });
      this.showConfigForm = false;
      await this.loadWorkspaces();
    } catch (err: any) {
      this.error = err.message;
    }
  }

  private openAddForm() {
    this.showAddForm = true;
    this.showConfigForm = false;
    this.error = '';
    this.addPath = '';
    this.addName = '';
  }

  private get headerDesc(): string {
    if (this.workspaces.length > 0) {
      return `Open VSCode · ${this.workspaces.length} workspace${this.workspaces.length !== 1 ? 's' : ''} available`;
    }
    return 'Open Visual Studio Code with devai tools in PATH';
  }

  render() {
    return html`
      <div class="section">
        <div class="header">
          <div class="header-left">
            <div class="header-title">Launch VSCode</div>
            <div class="header-desc">${this.headerDesc}</div>
          </div>
          <div class="header-right">
            <button class="launch-badge" @click=${this.handleLaunchDefault}>Launch</button>
          </div>
        </div>

        <div class="body">
            <div class="toolbar">
              ${this.workspaces.length > 5
                ? html`<input
                    class="filter-input"
                    type="text"
                    placeholder="Filter workspaces..."
                    .value=${this.filter}
                    @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}
                  />`
                : html`<span style="flex:1"></span>`}
              <button class="icon-btn" @click=${this.openAddForm} ${tooltip('Add workspace manually')}>+ Add</button>
              <select class="sort-select" .value=${this.sortBy} @change=${this.handleSortChange} ${tooltip('Sort workspaces')}>
                <option value="name">A-Z</option>
                <option value="source">Source</option>
                <option value="path">Path</option>
                <option value="recent">Recent</option>
              </select>
              <button class="icon-btn" @click=${this.openConfigForm} ${tooltip('Configure search roots')}>&#9881; Config</button>
              <button class="icon-btn" @click=${this.handleRescan} ${tooltip('Rescan')}>&#8635;</button>
            </div>

            ${this.warnings.length > 0 ? html`
              <div class="warnings">
                ${this.warnings.map((w) => html`
                  <div class="warning">
                    <span class="warning-icon">&#9888;</span>
                    <span class="warning-text">${w}</span>
                  </div>
                `)}
              </div>
            ` : nothing}

            ${this.loading
              ? html`<div class="empty">Scanning...</div>`
              : this.filtered.length === 0 && this.workspaces.length === 0
                ? html`<div class="empty">
                    No workspaces found.
                    ${this.config.discoverySources.length === 0
                      ? html`<br/>Click <strong>Config</strong> to add discovery sources, or <strong>Add</strong> to register a workspace manually.`
                      : nothing}
                  </div>`
                : this.filtered.length === 0
                  ? html`<div class="empty">No workspaces match "${this.filter}"</div>`
                  : html`
                    <div class="workspace-list">
                      ${repeat(this.filtered, (ws) => ws.id, (ws) => html`
                        <div class="ws-row ${ws.exists ? '' : 'missing'}" data-ws-path=${ws.path}>
                          ${ws.pinned ? html`<span class="pin-icon" ${tooltip('Pinned')}>&#9733;</span>` : nothing}
                          ${this.renamingId === ws.id
                            ? html`<input
                                class="rename-input"
                                type="text"
                                .value=${this.renameValue}
                                @input=${(e: Event) => { this.renameValue = (e.target as HTMLInputElement).value; }}
                                @keydown=${(e: KeyboardEvent) => {
                                  if (e.key === 'Enter') this.commitRename(ws);
                                  if (e.key === 'Escape') this.cancelRename();
                                }}
                                @blur=${() => this.commitRename(ws)}
                              />`
                            : html`<span class="ws-name">${ws.name}</span>`}
                          <span class="ws-path">${ws.path}</span>
                          ${!ws.exists ? html`<span class="missing-label">missing</span>` : nothing}
                          <span class="ws-badge ${ws.source}">${ws.source}</span>
                          ${ws.exists
                            ? html`<button class="ws-launch" @click=${() => this.handleLaunchWorkspace(ws)}>Open</button>`
                            : nothing}
                          <div class="ws-menu-wrap">
                            <button class="ws-kebab" @click=${(e: Event) => this.toggleMenu(ws, e)} ${tooltip('More options')}>&#8942;</button>
                            ${this.menuOpenId === ws.id ? html`
                              <div class="ws-dropdown">
                                <button class="ws-dropdown-item" @click=${() => this.handlePin(ws)}>${ws.pinned ? 'Unpin' : 'Pin to top'}</button>
                                <button class="ws-dropdown-item" @click=${() => this.startRename(ws)}>Rename</button>
                                <button class="ws-dropdown-item" @click=${() => this.handleCopyPath(ws)}>Copy path</button>
                                ${ws.exists ? html`
                                  <button class="ws-dropdown-item" @click=${() => this.handleReveal(ws)}>Show in folder</button>
                                  <button class="ws-dropdown-item" @click=${() => this.handleOpenTerminal(ws)}>Open terminal</button>
                                ` : nothing}
                                <button class="ws-dropdown-item" @click=${() => this.handleHide(ws)}>Hide</button>
                                ${ws.source === 'manual'
                                  ? html`<button class="ws-dropdown-item danger" @click=${() => this.handleRemove(ws)}>Remove</button>`
                                  : nothing}
                              </div>
                            ` : nothing}
                          </div>
                        </div>
                      `)}
                    </div>
                  `}

            ${this.showAddForm ? html`
              <div class="form">
                <div class="form-label">Add Workspace</div>
                <input
                  class="form-input"
                  type="text"
                  placeholder="Path to .code-workspace file"
                  .value=${this.addPath}
                  @input=${(e: Event) => { this.addPath = (e.target as HTMLInputElement).value; }}
                  @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.handleAdd(); }}
                />
                <input
                  class="form-input name"
                  type="text"
                  placeholder="Display name (optional)"
                  .value=${this.addName}
                  @input=${(e: Event) => { this.addName = (e.target as HTMLInputElement).value; }}
                  @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.handleAdd(); }}
                />
                ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
                <div class="form-row">
                  <button class="btn" @click=${() => { this.showAddForm = false; }}>Cancel</button>
                  <button class="btn primary" @click=${this.handleAdd}>Add</button>
                </div>
              </div>
            ` : nothing}

            ${this.showConfigForm ? html`
              <div class="form">
                <div class="form-label-row">
                  <span class="form-label">Discovery Sources (one per line)</span>
                  <button class="help-btn" @click=${() => { this.showHelp = !this.showHelp; }} ${tooltip('Help')}>?</button>
                </div>
                ${this.showHelp ? html`
                  <div class="help-panel">
                    <p>Each line defines where to find <code>.code-workspace</code> files. Both <code>/</code> and <code>\\</code> work, trailing slashes are optional.</p>
                    <div class="help-section">
                      <strong>Bare path</strong> &mdash; looks for <code>.code-workspace</code> files directly in that directory only (no subdirectories).<br/>
                      <code>W:/git</code>
                    </div>
                    <div class="help-section">
                      <strong>Recursive</strong> &mdash; append <code>/**</code> to scan subdirectories up to <em>Max Depth</em>, skipping directories in the exclude list.<br/>
                      <code>W:/git/**</code>
                    </div>
                    <div class="help-section">
                      <strong>Multi-root</strong> &mdash; wrap multiple roots in <code>{}</code>. Add a subpath after to narrow the search.<br/>
                      <code>{C:/projects, D:/work}/vscode/**</code>
                    </div>
                    <div class="help-section">
                      <strong>Comments</strong> &mdash; prefix a line with <code>#</code> to disable it without removing it.<br/>
                      <code># ~/projects/**</code>
                    </div>
                  </div>
                ` : nothing}
                <textarea
                  class="form-textarea"
                  placeholder="~/projects/**&#10;/home/user/repos/**"
                  .value=${this.configSourcesText}
                  @input=${(e: Event) => { this.configSourcesText = (e.target as HTMLTextAreaElement).value; }}
                ></textarea>
                <div class="depth-row">
                  <span class="form-label" style="margin:0">Max Depth</span>
                  <input
                    class="depth-input"
                    type="number"
                    min="1"
                    max="10"
                    .value=${String(this.configDepth)}
                    @input=${(e: Event) => { this.configDepth = parseInt((e.target as HTMLInputElement).value) || 4; }}
                  />
                </div>
                <div class="form-label-row" style="margin-top:8px">
                  <span class="form-label" style="margin:0">Exclude Patterns</span>
                  <button class="help-btn" @click=${() => { this.showExcludeHelp = !this.showExcludeHelp; }} ${tooltip('Help')}>?</button>
                </div>
                ${this.showExcludeHelp ? html`
                  <div class="help-panel">
                    <p>Directory names to skip during recursive (<code>/**</code>) scans. Matching is case-insensitive and applies to directory names only, not full paths.</p>
                    <p style="margin:0">Type a name and press <strong>Enter</strong> or <strong>,</strong> to add. Press <strong>Backspace</strong> in an empty input to remove the last entry.</p>
                  </div>
                ` : nothing}
                <div class="tag-list">
                  ${this.configExcludePatterns.map((pat, i) => html`
                    <span class="tag">
                      ${pat}
                      <button class="tag-remove" @click=${() => {
                        this.configExcludePatterns = this.configExcludePatterns.filter((_, j) => j !== i);
                      }}>&times;</button>
                    </span>
                  `)}
                  <input
                    class="tag-input"
                    type="text"
                    placeholder="Add pattern..."
                    .value=${this.excludeInput}
                    @input=${(e: Event) => { this.excludeInput = (e.target as HTMLInputElement).value; }}
                    @keydown=${(e: KeyboardEvent) => {
                      if ((e.key === 'Enter' || e.key === ',') && this.excludeInput.trim()) {
                        e.preventDefault();
                        const vals = this.excludeInput.split(',').map((s) => s.trim()).filter(Boolean);
                        const existing = new Set(this.configExcludePatterns.map((s) => s.toLowerCase()));
                        const newPats = vals.filter((v) => !existing.has(v.toLowerCase()));
                        if (newPats.length) this.configExcludePatterns = [...this.configExcludePatterns, ...newPats];
                        this.excludeInput = '';
                      } else if (e.key === 'Backspace' && !this.excludeInput && this.configExcludePatterns.length) {
                        this.configExcludePatterns = this.configExcludePatterns.slice(0, -1);
                      }
                    }}
                  />
                </div>
                <div class="form-label-row" style="margin-top:8px">
                  <span class="form-label" style="margin:0">Hidden Workspaces</span>
                  <button class="help-btn" @click=${() => { this.showHiddenHelp = !this.showHiddenHelp; }} ${tooltip('Help')}>?</button>
                </div>
                ${this.showHiddenHelp ? html`
                  <div class="help-panel">
                    <p style="margin:0">Workspaces hidden from the list via the <strong>Hide</strong> option in the kebab menu (<code>&#8942;</code>). Hidden workspaces are still on disk — unhide them here to make them visible again.</p>
                  </div>
                ` : nothing}
                ${this.config.hiddenPaths.length > 0 ? html`
                  <div class="hidden-list">
                    ${this.config.hiddenPaths.map((p) => html`
                      <div class="hidden-item">
                        <span class="hidden-item-path">${p}</span>
                        <button class="unhide-btn" @click=${() => this.handleUnhide(p)}>Unhide</button>
                      </div>
                    `)}
                  </div>
                ` : html`<div class="hidden-empty">No hidden workspaces</div>`}
                ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
                <div class="form-row">
                  <button class="btn" @click=${() => { this.showConfigForm = false; }}>Cancel</button>
                  <button class="btn primary" @click=${this.handleSaveConfig}>Save & Rescan</button>
                </div>
              </div>
            ` : nothing}
        </div>
      </div>
    `;
  }
}

function serializeSource(src: DiscoverySource): string {
  const suffix = src.recursive ? '/**' : '';
  let text: string;
  if (src.roots.length === 1 && !src.subpath) {
    text = `${src.roots[0]}${suffix}`;
  } else {
    const rootsPart = src.roots.length === 1 ? src.roots[0] : src.roots.join(', ');
    const base = `{${rootsPart}}`;
    text = src.subpath ? `${base}/${src.subpath}${suffix}` : `${base}${suffix}`;
  }
  return src.disabled ? `# ${text}` : text;
}

function parseSource(line: string): DiscoverySource {
  let disabled = false;
  let s = line;
  if (s.startsWith('#')) {
    disabled = true;
    s = s.slice(1).trim();
  }

  s = s.replace(/\\/g, '/').replace(/\/+$/, '');

  let recursive = false;
  if (s.endsWith('/**')) {
    recursive = true;
    s = s.slice(0, -3);
  }

  if (s.startsWith('{')) {
    const close = s.indexOf('}');
    if (close === -1) throw new Error(`Missing closing "}" in: ${line}`);
    const rootsPart = s.slice(1, close);
    const rest = s.slice(close + 1).replace(/^\//, '');

    const roots = rootsPart.split(',').map((r) => r.trim()).filter(Boolean);
    if (roots.length === 0) throw new Error(`Empty roots in: ${line}`);
    return { roots, subpath: rest, recursive, ...(disabled && { disabled }) };
  }

  return { roots: [s], subpath: '', recursive, ...(disabled && { disabled }) };
}
