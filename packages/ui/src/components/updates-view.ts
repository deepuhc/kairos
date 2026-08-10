import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getAppsStatus, getPluginsStatus, getSkillsStatus, getSelfUpdateStatus, getVersion, getConfigKey, setConfigKey, execute } from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';
import { io, type Socket } from '../services/events.js';

interface StatusSummary {
  installed: number;
  updatesAvailable: number;
}

@customElement('kairos-updates')
export class DevaiUpdates extends LitElement {
  @state() private apps: StatusSummary = { installed: 0, updatesAvailable: 0 };
  @state() private plugins: StatusSummary = { installed: 0, updatesAvailable: 0 };
  @state() private skills: StatusSummary = { installed: 0, updatesAvailable: 0 };
  @state() private version = '';
  @state() private selfUpdateAvailable = false;
  @state() private selfUpdateMessage: string | null = null;
  @state() private selfUpdating = false;
  @state() private updateChannel: string | null = null;
  @state() private updateChannelSaving = false;
  @state() private updatingAll = false;
  @state() private loading = true;

  private socket: Socket | null = null;

  static styles = css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
      margin: 0 0 4px;
    }
    .subtitle {
      color: var(--gray);
      font-size: var(--font-size-sm);
      margin-bottom: 20px;
    }
    .loading { color: var(--gray); padding: 24px 0; }

    .update-all-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 20px;
      border: 1px solid var(--amber-a25, rgba(245, 158, 11, 0.25));
      border-radius: var(--radius-lg);
      background: var(--amber-a10, rgba(245, 158, 11, 0.1));
      box-shadow: var(--widget-shadow);
      cursor: pointer;
      transition: all var(--transition-base);
    }
    .update-all-card:hover {
      background: var(--amber-a15, rgba(245, 158, 11, 0.15));
      border-color: var(--amber-a35, rgba(245, 158, 11, 0.35));
      box-shadow: var(--widget-shadow-hover);
    }
    .update-all-card.disabled { opacity: 0.6; pointer-events: none; }
    .update-all-card.up-to-date {
      background: var(--glass-bg);
      border-color: var(--glass-border);
    }
    .card-left { display: flex; flex-direction: column; gap: 4px; }
    .card-title { font-size: var(--font-size-lg); font-weight: 600; color: var(--bright-white); }
    .card-desc { font-size: var(--font-size-base); color: var(--gray); }
    .card-right { display: flex; gap: 8px; align-items: center; }
    .tool-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px;
      margin-top: 14px;
      margin-bottom: 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      box-shadow: var(--widget-shadow);
    }
    .tool-card.update {
      border-color: var(--amber-a25, rgba(245, 158, 11, 0.25));
      background: var(--amber-a15, rgba(245, 158, 11, 0.12));
    }
    .tool-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .tool-title {
      display: flex;
      align-items: baseline;
      gap: 8px;
      color: var(--bright-white);
      font-size: var(--font-size-lg);
      font-weight: 600;
      flex-wrap: wrap;
    }
    .version-value {
      color: var(--white);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      font-weight: 500;
    }
    .tool-desc {
      color: var(--gray);
      font-size: var(--font-size-sm);
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .status-pill {
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--w8);
      color: var(--gray);
      font-size: var(--font-size-xs);
      font-weight: 600;
    }
    .status-pill.warn {
      background: var(--amber-a25, rgba(245, 158, 11, 0.24));
      color: var(--amber, #d29922);
    }
    .update-all-badge {
      padding: 8px 20px;
      border-radius: var(--radius);
      background: var(--amber, #f59e0b);
      color: #0a0a0f;
      font-size: var(--font-size-md);
      font-weight: 600;
      pointer-events: none;
    }
    .update-all-badge.muted { background: var(--w8, rgba(255,255,255,0.08)); color: var(--gray); }

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
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }

    .channel-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid var(--glass-border);
    }
    .channel-label { font-size: var(--font-size-md); color: var(--white); font-weight: 500; }
    .channel-hint { font-size: var(--font-size-sm); color: var(--gray); }
    .channel-select {
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: var(--font);
      cursor: pointer;
    }
    .channel-select:disabled { opacity: 0.5; }
    .channel-select option { background: var(--surface-raised); color: var(--white); }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.socket = io();
    this.loadData();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
  }

  private async loadData() {
    this.loading = true;
    try {
      const [appsRes, pluginsRes, skillsRes, versionRes, selfUpdateRes] = await Promise.allSettled([
        getAppsStatus(),
        getPluginsStatus(),
        getSkillsStatus(),
        getVersion(),
        getSelfUpdateStatus(),
      ]);

      if (appsRes.status === 'fulfilled') {
        const items = appsRes.value.items;
        this.apps = { installed: items.length, updatesAvailable: items.filter((i) => i.updateAvailable).length };
      }
      if (pluginsRes.status === 'fulfilled') {
        const items = pluginsRes.value.items;
        this.plugins = { installed: items.length, updatesAvailable: items.filter((i: any) => i.updateAvailable).length };
      }
      if (skillsRes.status === 'fulfilled') {
        const items = skillsRes.value.items;
        this.skills = { installed: items.length, updatesAvailable: items.filter((i) => i.updateAvailable).length };
      }
      if (versionRes.status === 'fulfilled') {
        this.version = versionRes.value.version;
      }
      if (selfUpdateRes.status === 'fulfilled') {
        this.selfUpdateAvailable = selfUpdateRes.value.available;
        this.selfUpdateMessage = selfUpdateRes.value.message ?? null;
      } else {
        this.selfUpdateAvailable = false;
        this.selfUpdateMessage = null;
      }
      try {
        const channel = await getConfigKey('update-channel');
        this.updateChannel = channel.value;
      } catch { /* older devai may not have config command */ }
    } finally {
      this.loading = false;
    }
  }

  private get totalUpdates(): number {
    return this.apps.updatesAvailable + this.plugins.updatesAvailable + this.skills.updatesAvailable;
  }

  private get hasAnyUpdate(): boolean {
    return this.totalUpdates > 0 || this.selfUpdateAvailable;
  }

  private get updateAllDescription(): string {
    if (this.updatingAll) return 'Updating everything...';
    const parts: string[] = [];
    if (this.selfUpdateAvailable) {
      parts.push(this.selfUpdateMessage ? `devai: ${this.selfUpdateMessage}` : 'devai self-update available');
    }
    if (this.totalUpdates > 0) {
      parts.push(`${this.totalUpdates} component update${this.totalUpdates !== 1 ? 's' : ''} available`);
    }
    return parts.length > 0 ? parts.join(' • ') : 'Everything is up to date';
  }

  private async handleUpdateChannelChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    if (!value || value === this.updateChannel) return;
    this.updateChannelSaving = true;
    try {
      await setConfigKey('update-channel', value);
      this.updateChannel = value;
    } catch (err: any) {
      alert(`Failed to set update channel: ${err.message}`);
    } finally {
      this.updateChannelSaving = false;
    }
  }

  private handleUpdateAll() {
    return this.runUpdateAll(false);
  }

  private handleForceUpdateAll(e: Event) {
    e.stopPropagation();
    if (!confirm('Force re-resolve installed apps to their currently-promoted versions?\n\nThis may DOWNGRADE apps whose installed version is ahead of the promoted version.')) {
      return;
    }
    return this.runUpdateAll(true);
  }

  private async runUpdateAll(force: boolean) {
    this.updatingAll = true;
    const args = force ? ['update', '--force'] : ['update'];
    const { operationId } = await execute(args);
    window.dispatchEvent(new CustomEvent('kairos-operation', { detail: { operationId, args } }));

    this.socket?.on(`done:${operationId}`, () => {
      this.socket?.off(`done:${operationId}`);
      this.updatingAll = false;
      this.loadData();
    });
  }

  private async handleSelfUpdate(e: Event) {
    e.stopPropagation();
    this.selfUpdating = true;
    const args = ['self-update'];
    try {
      const { operationId } = await execute(args);
      window.dispatchEvent(new CustomEvent('kairos-operation', { detail: { operationId, args } }));

      this.socket?.on(`done:${operationId}`, () => {
        this.socket?.off(`done:${operationId}`);
        this.selfUpdating = false;
        this.loadData();
      });
    } catch (err: any) {
      this.selfUpdating = false;
      alert(`devai self-update failed: ${err.message}`);
    }
  }

  render() {
    return html`
      <h2>Updates</h2>
      <div class="subtitle">Update devai and every installed app, plugin, and skill — and choose which devai release channel to track.</div>
      ${this.loading
        ? html`<div class="loading">Loading update status...</div>`
        : html`
            <div
              class="update-all-card ${!this.hasAnyUpdate && !this.updatingAll ? 'disabled up-to-date' : this.updatingAll ? 'disabled' : ''}"
              @click=${this.handleUpdateAll}
            >
              <div class="card-left">
                <div class="card-title">Update All</div>
                <div class="card-desc">${this.updateAllDescription}</div>
              </div>
              <div class="card-right">
                <button
                  class="btn"
                  ?disabled=${this.updatingAll}
                  ${tooltip('Re-resolve to promoted versions, downgrading anything ahead (devai update --force)')}
                  @click=${this.handleForceUpdateAll}
                >Force re-resolve</button>
                <span class="update-all-badge ${!this.hasAnyUpdate && !this.updatingAll ? 'muted' : ''}">
                  ${this.updatingAll ? html`<span class="spinner"></span>Updating` : this.hasAnyUpdate ? 'Update' : 'Up to date'}
                </span>
              </div>
            </div>

            <div class="tool-card ${this.selfUpdateAvailable ? 'update' : ''}">
              <div class="tool-meta">
                <div class="tool-title">
                  <span>devai CLI</span>
                  ${this.version ? html`<span class="version-value">${this.version}</span>` : ''}
                  <span class="status-pill ${this.selfUpdateAvailable ? 'warn' : ''}">
                    ${this.selfUpdateAvailable ? 'Update available' : 'Installed'}
                  </span>
                </div>
                <div class="tool-desc">
                  ${this.selfUpdateMessage ?? 'Run devai self-update to refresh the CLI on the selected release channel.'}
                </div>
              </div>
              <button class="btn" ?disabled=${this.selfUpdating} @click=${this.handleSelfUpdate}>
                ${this.selfUpdating ? html`<span class="spinner"></span>Updating` : 'Self-Update'}
              </button>
            </div>

            ${this.updateChannel !== null ? html`
              <div class="channel-row">
                <span class="channel-label">Update channel</span>
                <select
                  class="channel-select"
                  ?disabled=${this.updateChannelSaving}
                  ${tooltip('devai update-channel')}
                  @change=${this.handleUpdateChannelChange}
                >
                  ${['stable', 'beta', 'main'].map((c) => html`
                    <option value=${c} ?selected=${this.updateChannel === c}>${c}</option>
                  `)}
                </select>
                <span class="channel-hint">Which devai release stream to pull updates from.</span>
              </div>
            ` : ''}
          `}
    `;
  }
}
