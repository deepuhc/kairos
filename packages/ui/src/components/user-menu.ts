import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getAuthStatus, login, logout, type UiUpdateStatus } from '../services/api.js';
import { KAIROS_VERSION } from '../services/app-version.js';
import { installDesktopUpdate, type DesktopUpdateStatus } from '../services/desktop-updater.js';
import { updateMonitor } from '../services/update-monitor.js';
import { tooltip } from '../directives/tooltip.js';
import { io, type Socket } from '../services/events.js';
import {
  getShowOnlineUsers,
  ONLINE_USERS_PREF_CHANGED,
  setShowOnlineUsers,
  type OnlineUsersPrefChange,
} from '../services/presence-prefs.js';

interface AuthInfo {
  loggedIn: boolean;
  user: string | null;
  expires: string | null;
}

const AVATAR_PALETTE = [
  ['#7c3aed', '#a855f7'],
  ['#6366f1', '#818cf8'],
  ['#06b6d4', '#22d3ee'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#ec4899', '#f472b6'],
  ['#f97316', '#fb923c'],
  ['#8b5cf6', '#c084fc'],
];

@customElement('kairos-user-menu')
export class DevaiUserMenu extends LitElement {
  @state() private auth: AuthInfo = { loggedIn: false, user: null, expires: null };
  @state() private uiUpdate: UiUpdateStatus | null = null;
  @state() private desktopUpdate: DesktopUpdateStatus | null = null;
  @state() private open = false;
  @state() private loggingIn = false;
  @state() private desktopUpdating = false;
  @state() private desktopUpdateProgress: string | null = null;
  @state() private showOnlineUsers = getShowOnlineUsers();

  private socket: Socket | null = null;
  private unsubscribeUpdates: (() => void) | null = null;

  static styles = css`
    :host { position: relative; display: inline-block; }

    .avatar-btn {
      position: relative;
      width: var(--header-avatar-size, 36px);
      height: var(--header-avatar-size, 36px);
      padding: 0;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      overflow: visible;
    }
    .avatar {
      position: relative;
      width: var(--header-avatar-size, 36px);
      height: var(--header-avatar-size, 36px);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-base);
      font-weight: 600;
      color: white;
      overflow: hidden;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      transition: box-shadow var(--transition-fast);
    }
    .avatar-btn:hover .avatar { box-shadow: 0 0 0 2px var(--accent-a35); }
    .avatar img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .avatar img.broken { display: none; }

    .update-dot {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--amber, #f59e0b);
      border: 2px solid var(--surface-modal, #0a0a0f);
      box-shadow: 0 0 0 3px var(--amber-a15, rgba(245, 158, 11, 0.16));
      animation: update-pulse 1.8s ease-out infinite;
    }

    .menu {
      position: absolute;
      right: 0;
      top: 100%;
      margin-top: 8px;
      width: 300px;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      z-index: 200;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .identity { display: flex; flex-direction: column; gap: 2px; }
    .identity-name { font-size: var(--font-size-lg); font-weight: 600; color: var(--bright-white); }
    .identity-detail { font-size: var(--font-size-sm); color: var(--gray); }

    .divider { height: 1px; background: var(--glass-border); margin: 12px 0; }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .row + .row { margin-top: 8px; }
    .row-label { font-size: var(--font-size-sm); color: var(--gray); min-width: 0; overflow-wrap: anywhere; }
    .version-value { font-family: var(--font-mono); font-size: var(--font-size-sm); color: var(--white); overflow-wrap: anywhere; }
    .update-msg { font-size: var(--font-size-sm); color: var(--amber, #f59e0b); margin-top: 4px; overflow-wrap: anywhere; }

    .pref-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 2px 0;
    }
    .pref-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pref-label {
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
    }
    .pref-help {
      color: var(--gray);
      font-size: var(--font-size-xs);
      line-height: 1.35;
    }
    .switch {
      position: relative;
      flex: none;
      width: 38px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--glass-border);
      border-radius: 999px;
      background: var(--w10);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .switch:hover {
      border-color: var(--accent-a35);
      background: var(--w15);
    }
    .switch .thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--gray);
      transition: all var(--transition-fast);
    }
    .switch.on {
      border-color: var(--accent-a35);
      background: var(--accent-a25);
    }
    .switch.on .thumb {
      transform: translateX(16px);
      background: var(--bright-white);
    }

    .version-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
    }
    .version-card .label {
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-weight: 500;
    }
    .version-card .version-value {
      color: var(--bright-white);
      font-weight: 600;
    }

    .update-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--amber-a25, rgba(245, 158, 11, 0.25));
      border-radius: var(--radius-lg);
      background:
        radial-gradient(circle at top right, var(--amber-a25, rgba(245, 158, 11, 0.22)), transparent 42%),
        var(--amber-a15, rgba(245, 158, 11, 0.12));
      box-shadow: var(--shadow-sm);
    }
    .update-kicker {
      color: var(--amber, #f59e0b);
      font-size: var(--font-size-xs);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .update-title {
      color: var(--bright-white);
      font-size: var(--font-size-lg);
      font-weight: 700;
      line-height: 1.2;
    }
    .update-desc {
      color: var(--white);
      font-size: var(--font-size-sm);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .update-desc.muted { color: var(--gray); }

    .btn {
      padding: 6px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .btn:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn.primary {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
      font-weight: 600;
    }
    .btn.primary:hover { background: var(--accent-a25); border-color: var(--accent); }
    .btn.block { width: 100%; text-align: center; }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes update-pulse {
      0%, 100% { box-shadow: 0 0 0 3px var(--amber-a15, rgba(245, 158, 11, 0.16)); }
      50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.socket = io();
    this.socket.on('auth:changed', async () => {
      try { this.auth = await getAuthStatus(); } catch { /* ignore */ }
    });
    this.unsubscribeUpdates = updateMonitor.subscribe((state) => {
      this.uiUpdate = state.uiUpdate;
      this.desktopUpdate = state.desktopUpdate;
    });
    window.addEventListener(ONLINE_USERS_PREF_CHANGED, this.onOnlineUsersPrefChanged);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loadAuth();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
    this.unsubscribeUpdates?.();
    this.unsubscribeUpdates = null;
    window.removeEventListener(ONLINE_USERS_PREF_CHANGED, this.onOnlineUsersPrefChanged);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onOnlineUsersPrefChanged = (e: Event) => {
    const detail = (e as CustomEvent<OnlineUsersPrefChange>).detail;
    this.showOnlineUsers = typeof detail?.show === 'boolean'
      ? detail.show
      : getShowOnlineUsers();
  };

  // Refresh auth the instant the tab regains focus so the avatar reflects an
  // overnight expiry without waiting for the menu to be opened.
  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.loadAuth();
  };

  private async loadAuth() {
    try {
      this.auth = await getAuthStatus();
    } catch { /* leave last-known auth; transient fetch errors are not logout */ }
  }

  private get hasUpdate(): boolean {
    return this.desktopUpdate?.available === true || this.uiUpdate !== null;
  }

  private get kairosVersion(): string {
    return this.desktopUpdate?.currentVersion ?? KAIROS_VERSION;
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  private avatarStyle(name: string) {
    const [a, b] = AVATAR_PALETTE[this.hash(name) % AVATAR_PALETTE.length];
    return `background: linear-gradient(135deg, ${a}, ${b});`;
  }

  private initials(name: string): string {
    const parts = name.replace(/[._-]/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  private toggle(e: Event) {
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      return;
    }
    this.open = true;
    this.loadAuth();
    // Opening the account menu is an explicit user action, so bypass the normal
    // two-hour background throttle and show the freshest update status.
    void updateMonitor.refreshNow();
    requestAnimationFrame(() => {
      document.addEventListener('click', this.close, { once: true });
    });
  }

  private close = () => { this.open = false; };

  private async handleLogin() {
    this.loggingIn = true;
    try {
      await login();
      this.auth = await getAuthStatus();
    } finally {
      this.loggingIn = false;
    }
  }

  private async handleLogout() {
    try {
      await logout();
      this.auth = await getAuthStatus();
    } catch (err: any) {
      alert(`Log out failed: ${err.message}`);
    }
  }

  private async handleDesktopUpdate() {
    this.desktopUpdating = true;
    this.desktopUpdateProgress = 'Starting download...';
    try {
      const result = await installDesktopUpdate((event) => {
        if (event.event === 'Started') {
          this.desktopUpdateProgress = event.data.contentLength
            ? `Downloading ${Math.ceil(event.data.contentLength / 1024 / 1024)} MB...`
            : 'Downloading update...';
        } else if (event.event === 'Progress') {
          this.desktopUpdateProgress = 'Downloading update...';
        } else if (event.event === 'Finished') {
          this.desktopUpdateProgress = 'Installing update...';
        }
      });
      if (result.restartRequired) {
        this.desktopUpdateProgress = 'Restart required';
        this.desktopUpdating = false;
        alert(result.message ?? 'Update installed. Close and reopen Kairos to finish.');
      }
    } catch (err: any) {
      alert(`Kairos update failed: ${err?.message ?? String(err)}`);
      this.desktopUpdateProgress = null;
      this.desktopUpdating = false;
      await updateMonitor.refreshNow();
    }
  }

  private toggleOnlineUsers = () => {
    const next = !this.showOnlineUsers;
    this.showOnlineUsers = next;
    setShowOnlineUsers(next);
  };

  private renderKairosUpdate() {
    if (this.desktopUpdate?.available) {
      return html`
        <div class="update-card">
          <div>
            <div class="update-kicker">Kairos update available</div>
            <div class="update-title">Version ${this.desktopUpdate.version ?? 'available'}</div>
          </div>
          <div class="update-desc">
            Installed ${this.kairosVersion}
            ${this.desktopUpdateProgress ? html` · ${this.desktopUpdateProgress}` : nothing}
          </div>
          <button class="btn primary block" ?disabled=${this.desktopUpdating} @click=${this.handleDesktopUpdate}>
            ${this.desktopUpdating ? html`<span class="spinner"></span>Updating` : 'Install Kairos Update'}
          </button>
        </div>
      `;
    }
    if (this.uiUpdate) {
      const commits = `${this.uiUpdate.behind} commit${this.uiUpdate.behind === 1 ? '' : 's'}`;
      return html`
        <div class="update-card">
          <div>
            <div class="update-kicker">Kairos source update available</div>
            <div class="update-title">${commits} behind</div>
          </div>
          <div class="update-desc">
            Pull and rebuild this checkout to update Kairos.
            ${this.uiUpdate.latest ? html` Latest source: <span class="version-value">${this.uiUpdate.latest}</span>` : nothing}
          </div>
        </div>
      `;
    }
    if (this.desktopUpdate?.error) {
      return html`<div class="update-msg">Kairos update check failed: ${this.desktopUpdate.error}</div>`;
    }
    return nothing;
  }

  render() {
    const name = this.auth.user || 'guest';
    const ariaLabel = this.hasUpdate ? 'Account menu, Kairos update available' : 'Account menu';
    return html`
      <button class="avatar-btn" @click=${this.toggle} ${tooltip(this.auth.loggedIn ? this.auth.user ?? 'Account' : 'Not logged in')} aria-label=${ariaLabel}>
        <span class="avatar" style=${this.avatarStyle(name)}>
          ${this.auth.loggedIn ? this.initials(name) : '?'}
        </span>
        ${this.hasUpdate ? html`<span class="update-dot"></span>` : nothing}
      </button>
      ${this.open ? html`
        <div
          class="menu"
          data-tauri-drag-region="false"
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @mousedown=${(e: Event) => e.stopPropagation()}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="identity">
            <div class="identity-name">${this.auth.loggedIn ? this.auth.user : 'Not logged in'}</div>
            ${this.auth.loggedIn && this.auth.expires
              ? html`<div class="identity-detail">Session expires: ${this.auth.expires}</div>`
              : !this.auth.loggedIn
                ? html`<div class="identity-detail">Log in to access all features</div>`
                : nothing}
          </div>
          ${this.auth.loggedIn
            ? html`<button class="btn block" style="margin-top:12px" @click=${this.handleLogout}>Log Out</button>`
            : html`<button class="btn primary block" style="margin-top:12px" ?disabled=${this.loggingIn} @click=${this.handleLogin}>
                ${this.loggingIn ? html`<span class="spinner"></span>Logging in` : 'Log In'}
              </button>`}

          <div class="divider"></div>

          <div class="pref-row">
            <div class="pref-copy">
              <div class="pref-label">Online users pill</div>
              <div class="pref-help">Show who else is using Kairos in the header.</div>
            </div>
            <button
              class="switch ${this.showOnlineUsers ? 'on' : ''}"
              role="switch"
              aria-checked=${this.showOnlineUsers ? 'true' : 'false'}
              aria-label=${this.showOnlineUsers ? 'Hide online users pill' : 'Show online users pill'}
              @click=${this.toggleOnlineUsers}
            >
              <span class="thumb"></span>
            </button>
          </div>

          <div class="divider"></div>

          <div class="version-card">
            <span class="label">Kairos</span>
            <span class="version-value">${this.kairosVersion}</span>
          </div>
          ${this.renderKairosUpdate()}
        </div>
      ` : nothing}
    `;
  }
}
