// Read-only git panel for an Agents-tab session. It shows the git
// working tree for the session's effective cwd (isolated worktree when present)
// and delegates file opening back to the existing Files panel.

import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AgentSession } from '../services/agents-session.js';
import { getGitStatus, type GitStatus, type GitStatusChange, type GitChangeState } from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';

type ChangeGroupId = 'conflicted' | 'staged' | 'unstaged' | 'untracked';

interface ChangeGroup {
  id: ChangeGroupId;
  title: string;
  changes: GitStatusChange[];
}

const STATUS_LABEL: Record<GitChangeState, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  unmerged: 'Conflict',
  untracked: 'Untracked',
  typechange: 'Type changed',
  unknown: 'Changed',
};

const STATUS_BADGE: Record<GitChangeState, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  unmerged: 'U',
  untracked: '?',
  typechange: 'T',
  unknown: '*',
};

function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/');
  return i === -1 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

function changeKind(change: GitStatusChange, group: ChangeGroupId): GitChangeState {
  if (group === 'conflicted') return 'unmerged';
  if (group === 'untracked') return 'untracked';
  if (group === 'staged') return change.index ?? change.kind ?? 'unknown';
  return change.workingTree ?? change.kind ?? 'unknown';
}

@customElement('agents-source-control')
export class AgentsSourceControl extends LitElement {
  @property({ attribute: false }) session!: AgentSession;
  @property({ type: Number }) refreshToken = 0;

  @state() private status: GitStatus | null = null;
  @state() private loading = false;
  @state() private error = '';

  private loadedKey = '';

  connectedCallback() {
    super.connectedCallback();
    void this.ensureStatus(true);
  }

  updated(changed: PropertyValues<this>) {
    if (changed.has('session') || changed.has('refreshToken')) {
      void this.ensureStatus(changed.has('refreshToken'));
    }
  }

  private sessionWorkdir(): string {
    return this.session.worktree?.worktreePath ?? this.session.cwd;
  }

  private statusKey(): string {
    return `${this.session.id}\0${this.sessionWorkdir()}\0${this.refreshToken}`;
  }

  private async ensureStatus(force = false) {
    const key = this.statusKey();
    if (!force && this.loadedKey === key) return;
    this.loadedKey = key;
    await this.loadStatus();
  }

  private async loadStatus() {
    const cwd = this.sessionWorkdir();
    this.loading = true;
    this.error = '';
    try {
      const status = await getGitStatus(cwd);
      if (cwd !== this.sessionWorkdir()) return;
      this.status = status;
      this.emitStatus(status);
    } catch (err: any) {
      if (cwd !== this.sessionWorkdir()) return;
      this.error = err?.message ?? 'Failed to load git status';
      this.status = null;
      this.emitStatus(null);
    } finally {
      if (cwd === this.sessionWorkdir()) this.loading = false;
    }
  }

  private emitStatus(status: GitStatus | null) {
    this.dispatchEvent(new CustomEvent('source-status', {
      bubbles: true,
      composed: true,
      detail: {
        sessionId: this.session.id,
        cwd: this.sessionWorkdir(),
        isRepo: !!status?.isRepo,
        branch: status?.branch ?? status?.currentBranch ?? '',
        changes: status?.changes.length ?? 0,
      },
    }));
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private openFile(path: string) {
    this.dispatchEvent(new CustomEvent('open-file', {
      bubbles: true,
      composed: true,
      detail: { path },
    }));
  }

  private groups(): ChangeGroup[] {
    const changes = this.status?.changes ?? [];
    const conflicted = changes.filter((c) => c.conflicted);
    return [
      { id: 'conflicted', title: 'Merge conflicts', changes: conflicted },
      { id: 'staged', title: 'Staged changes', changes: changes.filter((c) => c.staged && !c.conflicted) },
      { id: 'unstaged', title: 'Changes', changes: changes.filter((c) => c.unstaged && !c.untracked && !c.conflicted) },
      { id: 'untracked', title: 'Untracked files', changes: changes.filter((c) => c.untracked) },
    ].filter((group) => group.changes.length > 0);
  }

  private syncText() {
    const status = this.status;
    if (!status?.isRepo) return '';
    const parts = [];
    if (status.ahead) parts.push(`${status.ahead} ahead`);
    if (status.behind) parts.push(`${status.behind} behind`);
    return parts.join(', ');
  }

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
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
    .branch {
      max-width: 42%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 2px 7px;
      border: 1px solid var(--accent-a25);
      border-radius: var(--radius-sm);
      background: var(--accent-a10);
      color: var(--accent-light, var(--accent));
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
    }
    .icon-action, .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .icon-action:hover, .close:hover { color: var(--white); background: var(--w5); }
    .icon-action:disabled { opacity: 0.5; cursor: default; }
    .icon-action svg, .close svg { display: block; }

    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 12px 12px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .stat {
      padding: 8px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w4);
      min-width: 0;
    }
    .stat-num {
      display: block;
      color: var(--bright-white);
      font-family: var(--font-mono);
      font-size: var(--font-size-md);
      font-weight: 650;
    }
    .stat-label {
      display: block;
      margin-top: 2px;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sync {
      padding: 8px 10px;
      border: 1px solid var(--accent-a25);
      border-radius: var(--radius);
      background: var(--accent-a10);
      color: var(--gray);
      font-size: var(--font-size-sm);
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .group-title {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 4px;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .group-count {
      color: var(--gray);
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 7px;
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--gray);
      font-family: var(--font);
      text-align: left;
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .row:hover { background: var(--w5); color: var(--white); }
    .badge {
      flex-shrink: 0;
      width: 17px;
      height: 17px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      border: 1px solid var(--glass-border);
      font-size: 10px;
      font-weight: 750;
      color: var(--accent-light, var(--accent));
      background: var(--accent-a10);
    }
    .badge.added, .badge.untracked { color: var(--emerald); border-color: var(--green-a25); background: var(--green-a10); }
    .badge.deleted { color: var(--red); border-color: var(--red-a25); background: var(--red-a15); }
    .badge.unmerged { color: var(--amber); border-color: var(--amber-a35); background: var(--amber-a15); }
    .file {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      overflow: hidden;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
    }
    .base {
      flex-shrink: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--white);
    }
    .dir {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      margin-left: 6px;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
    }
    .rename {
      flex-shrink: 0;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
    }
    .empty, .error, .loading {
      margin: auto;
      padding: 36px 18px;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      line-height: 1.45;
    }
    .error { color: var(--red); }
  `;

  render() {
    const status = this.status;
    const branch = status?.branch || status?.currentBranch || 'HEAD';
    return html`
      <div class="head">
        <h2>Git Changes</h2>
        ${status?.isRepo ? html`<span class="branch" ${tooltip(this.sessionWorkdir())}>${branch}</span>` : nothing}
        <button class="icon-action" @click=${() => this.loadStatus()} ?disabled=${this.loading} ${tooltip('Refresh git status')} aria-label="Refresh git changes">
          ${icon.refresh(15)}
        </button>
        <button class="close" ${tooltip('Close git changes')} @click=${() => this.close()} aria-label="Close git changes">${icon.close(15)}</button>
      </div>
      <div class="body">
        ${this.renderBody()}
      </div>
    `;
  }

  private renderBody() {
    if (this.loading && !this.status) return html`<div class="loading">Loading git status...</div>`;
    if (this.error) return html`<div class="error">${this.error}</div>`;
    const status = this.status;
    if (!status) return nothing;
    if (!status.isRepo) {
      return html`<div class="empty">This session's working directory is not inside a git repository.</div>`;
    }
    const groups = this.groups();
    const staged = status.changes.filter((c) => c.staged && !c.conflicted).length;
    const unstaged = status.changes.filter((c) => c.unstaged && !c.untracked && !c.conflicted).length;
    const untracked = status.changes.filter((c) => c.untracked).length;
    const sync = this.syncText();
    return html`
      <div class="summary">
        <div class="stat"><span class="stat-num">${staged}</span><span class="stat-label">staged</span></div>
        <div class="stat"><span class="stat-num">${unstaged}</span><span class="stat-label">changed</span></div>
        <div class="stat"><span class="stat-num">${untracked}</span><span class="stat-label">untracked</span></div>
      </div>
      ${sync ? html`<div class="sync">${sync}${status.upstream ? html` vs ${status.upstream}` : nothing}</div>` : nothing}
      ${groups.length === 0
        ? html`<div class="empty">Working tree clean.</div>`
        : groups.map((group) => this.renderGroup(group))}
    `;
  }

  private renderGroup(group: ChangeGroup) {
    return html`
      <section class="group">
        <div class="group-title">
          <span>${group.title}</span>
          <span class="group-count">${group.changes.length}</span>
        </div>
        ${group.changes.map((change) => this.renderChange(change, group.id))}
      </section>
    `;
  }

  private renderChange(change: GitStatusChange, group: ChangeGroupId) {
    const kind = changeKind(change, group);
    const { dir, name } = splitPath(change.path);
    const deleted = kind === 'deleted';
    const label = STATUS_LABEL[kind] ?? STATUS_LABEL.unknown;
    return html`
      <button
        class="row"
        @click=${() => { if (!deleted) this.openFile(change.path); }}
        ${tooltip(deleted ? `${label}: ${change.path}` : `${label}: open ${change.path}`)}
        aria-label=${`${label}: ${change.path}`}
      >
        <span class="badge ${kind}" ${tooltip(label)}>${STATUS_BADGE[kind] ?? STATUS_BADGE.unknown}</span>
        <span class="file">
          <span class="base">${name}</span>
          ${dir ? html`<span class="dir">${dir}</span>` : nothing}
        </span>
        ${change.originalPath ? html`<span class="rename" ${tooltip(change.originalPath)}>from</span>` : nothing}
      </button>
    `;
  }
}
