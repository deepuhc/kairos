import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getWorkspaces, type WorkspaceEntry } from '../services/api.js';

@customElement('kairos-launch-picker')
export class DevaiLaunchPicker extends LitElement {
  @property() appName = '';
  @state() private workspaces: WorkspaceEntry[] = [];
  @state() private loading = true;
  @state() private filter = '';
  @state() private customPath = '';
  @state() private showCustomInput = false;

  static styles = css`
    :host { display: block; }
    .backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      animation: fade-in 0.15s ease-out;
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .dialog {
      width: min(560px, 90vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
    }
    .header {
      padding: 18px 20px 12px;
      border-bottom: 1px solid var(--w8);
    }
    .title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--bright-white);
    }
    .subtitle {
      font-size: var(--font-size-base);
      color: var(--gray);
      margin-top: 4px;
    }
    .body {
      padding: 12px 20px;
      overflow-y: auto;
      flex: 1;
    }
    .filter-input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-base);
      font-family: var(--font);
      outline: none;
      margin-bottom: 12px;
      transition: border-color var(--transition-fast);
    }
    .filter-input:focus { border-color: var(--accent-a35); }
    .filter-input::placeholder { color: var(--neutral-gray); }
    .ws-list {
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
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      text-align: left;
      width: 100%;
      transition: all var(--transition-fast);
    }
    .ws-row:hover {
      background: var(--accent-a15);
      border-color: var(--accent-a35);
    }
    .ws-row.missing { opacity: 0.45; cursor: not-allowed; }
    .ws-row.missing:hover { background: transparent; border-color: transparent; }
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
    .empty {
      padding: 24px;
      text-align: center;
      color: var(--gray);
      font-size: var(--font-size-base);
    }
    .footer {
      padding: 12px 20px 16px;
      border-top: 1px solid var(--w8);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .custom-row {
      display: flex;
      gap: 8px;
      flex: 1;
    }
    .custom-row input {
      flex: 1;
      padding: 6px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-base);
      font-family: var(--font-mono);
      outline: none;
    }
    .custom-row input:focus { border-color: var(--accent-a35); }
    .btn {
      padding: 6px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-base);
      cursor: pointer;
      white-space: nowrap;
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
    .btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.link {
      background: transparent;
      border-color: transparent;
      color: var(--purple-light);
    }
    .btn.link:hover { color: var(--bright-white); background: transparent; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadWorkspaces();
    document.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private async loadWorkspaces() {
    this.loading = true;
    try {
      const result = await getWorkspaces();
      this.workspaces = (result.workspaces || []).filter((w) => w.exists);
      this.workspaces.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const ta = a.lastOpened ? new Date(a.lastOpened).getTime() : 0;
        const tb = b.lastOpened ? new Date(b.lastOpened).getTime() : 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name);
      });
    } catch {
      this.workspaces = [];
    } finally {
      this.loading = false;
    }
  }

  private get filtered(): WorkspaceEntry[] {
    if (!this.filter) return this.workspaces;
    const q = this.filter.toLowerCase();
    return this.workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || w.path.toLowerCase().includes(q),
    );
  }

  private close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  }

  private pick(cwd: string) {
    this.dispatchEvent(new CustomEvent('pick', { detail: { cwd }, bubbles: true, composed: true }));
  }

  private handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this.close();
  }

  private workspaceDir(ws: WorkspaceEntry): string {
    if (ws.root) return ws.root;
    // .code-workspace files: launch from the directory containing them
    return ws.path.replace(/\/[^/]+\.code-workspace$/, '').replace(/\\[^\\]+\.code-workspace$/, '');
  }

  render() {
    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="header">
            <div class="title">Launch ${this.appName}</div>
            <div class="subtitle">Choose a working directory. Coding agents can't run from your home directory.</div>
          </div>
          <div class="body">
            ${this.loading
              ? html`<div class="empty">Loading VS Code workspaces...</div>`
              : this.workspaces.length === 0
                ? html`<div class="empty">No VS Code workspaces found. Enter a path below.</div>`
                : html`
                    ${this.workspaces.length > 5 ? html`
                      <input
                        class="filter-input"
                        type="text"
                        placeholder="Filter VS Code workspaces..."
                        .value=${this.filter}
                        autofocus
                        @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}
                      />
                    ` : nothing}
                    ${this.filtered.length === 0
                      ? html`<div class="empty">No VS Code workspaces match "${this.filter}"</div>`
                      : html`
                        <div class="ws-list">
                          ${this.filtered.map((ws) => html`
                            <button class="ws-row" @click=${() => this.pick(this.workspaceDir(ws))}>
                              <span class="ws-name">${ws.name}</span>
                              <span class="ws-path">${this.workspaceDir(ws)}</span>
                            </button>
                          `)}
                        </div>
                      `}
                  `}
          </div>
          <div class="footer">
            ${this.showCustomInput
              ? html`
                <div class="custom-row">
                  <input
                    type="text"
                    placeholder="/absolute/path/to/dir"
                    .value=${this.customPath}
                    autofocus
                    @input=${(e: Event) => { this.customPath = (e.target as HTMLInputElement).value; }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter' && this.customPath.trim()) this.pick(this.customPath.trim());
                    }}
                  />
                  <button class="btn primary" ?disabled=${!this.customPath.trim()}
                    @click=${() => this.pick(this.customPath.trim())}>Launch</button>
                </div>
              `
              : html`
                <button class="btn link" @click=${() => { this.showCustomInput = true; }}>Use other path...</button>
                <button class="btn" @click=${() => this.close()}>Cancel</button>
              `}
          </div>
        </div>
      </div>
    `;
  }
}
