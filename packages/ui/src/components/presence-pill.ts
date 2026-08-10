import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getPresence, getSystemUser } from '../services/api.js';
import {
  getShowOnlineUsers,
  ONLINE_USERS_PREF_CHANGED,
  setShowOnlineUsers,
  type OnlineUsersPrefChange,
} from '../services/presence-prefs.js';
import { avatarStyle, initials, avatarImg, avatarStyles } from './avatar.js';

// Header "who's here" pill. Kairos is self-hosted per user, but every instance
// reads/writes the same shared usage_log, so this shows who else is active in
// Kairos right now — presence, not analytics. Usage writes are based on real
// foreground interaction only. Faces + names only, no hostnames. Renders nothing
// when the feed is empty or unreachable, so it never becomes broken chrome.

interface Present {
  username: string;
  last_seen: string;
}

const POLL_MS = 5 * 60_000;
const MAX_FACES = 4;
export const SHARE_URL = '';

@customElement('kairos-presence-pill')
export class DevaiPresencePill extends LitElement {
  @state() private present: Present[] = [];
  @state() private me = '';
  @state() private open = false;
  @state() private now = Date.now();
  @state() private copied = false;
  @state() private showOnlineUsers = getShowOnlineUsers();

  private pollTimer: number | undefined;
  private copiedTimer: number | undefined;

  static styles = [avatarStyles, css`
    :host { position: relative; display: inline-block; }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: var(--header-control-size, 36px);
      padding: 0 var(--header-pill-pad-x, 12px) 0 8px;
      border: 1px solid var(--header-control-border, var(--glass-border));
      border-radius: 999px;
      background: var(--header-control-bg, var(--glass-bg));
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .pill:hover {
      border-color: var(--header-control-border-hover, var(--accent-a35));
      background: var(--header-control-bg-hover, var(--accent-a15));
      color: var(--bright-white);
    }

    .stack { display: inline-flex; align-items: center; }
    .stack .avatar {
      --avatar-size: 22px;
      --avatar-font: 9px;
      border: 2px solid var(--bg-base);
      margin-left: -8px;
    }
    .stack .avatar:first-child { margin-left: 0; }

    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
      flex-shrink: 0;
    }
    .count { white-space: nowrap; }

    .menu {
      position: absolute;
      right: 0;
      top: 100%;
      margin-top: 8px;
      width: 280px;
      max-height: min(460px, calc(100vh - 80px));
      overflow-y: auto;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      z-index: 200;
      padding: 8px;
    }
    .menu-head {
      padding: 6px 8px 10px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--neutral-gray);
    }

    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 8px;
      border-radius: var(--radius);
    }
    .row:hover { background: var(--w6); }
    .row .avatar { --avatar-size: 30px; --avatar-font: 12px; }
    .row-main { flex: 1; min-width: 0; }
    .row-name {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--bright-white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .you-tag {
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--accent);
      margin-left: 6px;
    }
    .row-when {
      font-size: var(--font-size-xs);
      color: var(--gray);
      margin-top: 1px;
    }

    .share {
      margin-top: 8px;
      padding: 10px 8px 4px;
      border-top: 1px solid var(--glass-border);
    }
    .share-title {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--bright-white);
      margin-bottom: 8px;
    }
    .share-btn {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a15);
      color: var(--bright-white);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .share-btn:hover { background: var(--accent-a25); }
    .note-link {
      display: block;
      width: 100%;
      margin-top: 8px;
      padding: 4px;
      border: none;
      background: none;
      color: var(--gray);
      font-size: var(--font-size-xs);
      font-weight: 500;
      text-align: center;
      cursor: pointer;
      border-radius: var(--radius);
      transition: all var(--transition-fast);
    }
    .note-link:hover { color: var(--accent); background: var(--w6); }

    .presence-pref {
      margin-top: 8px;
      padding: 8px 8px 2px;
      border-top: 1px solid var(--glass-border);
    }
    .hide-presence-btn {
      width: 100%;
      padding: 6px 8px;
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-align: center;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .hide-presence-btn:hover {
      background: var(--w6);
      color: var(--bright-white);
    }
  `];

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(ONLINE_USERS_PREF_CHANGED, this.onOnlineUsersPrefChanged);
    if (this.showOnlineUsers) this.startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(ONLINE_USERS_PREF_CHANGED, this.onOnlineUsersPrefChanged);
    this.stopPolling();
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
  }

  private onOnlineUsersPrefChanged = (e: Event) => {
    const detail = (e as CustomEvent<OnlineUsersPrefChange>).detail;
    this.showOnlineUsers = typeof detail?.show === 'boolean'
      ? detail.show
      : getShowOnlineUsers();
    if (this.showOnlineUsers) this.startPolling();
    else this.stopPolling();
  };

  private startPolling() {
    if (this.pollTimer) return;
    void this.loadAndRefresh();
    this.pollTimer = window.setInterval(() => {
      this.now = Date.now();
      if (this.showOnlineUsers && document.visibilityState === 'visible') this.refresh();
    }, POLL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.open = false;
    this.present = [];
  }

  private async loadAndRefresh() {
    await this.loadMe();
    if (this.showOnlineUsers) await this.refresh();
  }

  private async loadMe() {
    try {
      const { username } = await getSystemUser();
      this.me = username ?? '';
    } catch {
      this.me = '';
    }
  }

  private async refresh() {
    if (!this.showOnlineUsers) return;
    try {
      const { present } = await getPresence();
      if (!this.showOnlineUsers) return;
      // Pin yourself first so the list reads as "you + others".
      this.present = [...present].sort((a, b) => {
        if (a.username === this.me) return -1;
        if (b.username === this.me) return 1;
        return 0;
      });
      this.now = Date.now();
    } catch {
      this.present = [];
    }
  }

  private toggle(e: Event) {
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      return;
    }
    this.open = true;
    requestAnimationFrame(() => {
      document.addEventListener('click', this.close, { once: true });
    });
  }

  private close = () => { this.open = false; };

  private openTestimonials = (e: Event) => {
    e.stopPropagation();
    this.open = false;
    this.dispatchEvent(new CustomEvent('open-testimonials', { bubbles: true, composed: true }));
  };

  private hideOnlineUsers = (e: Event) => {
    e.stopPropagation();
    setShowOnlineUsers(false);
  };

  // Keep the popover open on share clicks so the "Copied!" confirmation is seen.
  private async copyShareLink(e: Event) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      this.copied = true;
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = window.setTimeout(() => { this.copied = false; }, 2000);
    } catch {
      // Clipboard can be blocked in non-secure contexts or by permissions.
    }
  }

  private timeAgo(iso: string): string {
    const mins = Math.floor((this.now - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'active just now';
    if (mins < 60) return `active ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `active ${hours}h ago`;
  }

  render() {
    if (!this.showOnlineUsers) return nothing;

    // Ambient chrome: only surfaces when *someone else* is online. If it's just
    // you (or the feed is down / empty), show nothing at all.
    const others = this.present.filter((p) => p.username !== this.me).length;
    if (others === 0) return nothing;

    const faces = this.present.slice(0, MAX_FACES);
    const label = `${this.present.length} online`;

    return html`
      <button
        class="pill"
        @click=${this.toggle}
        aria-haspopup="true"
        aria-expanded=${this.open}
        aria-label="People using Kairos right now, in their own sessions"
      >
        <span class="live-dot"></span>
        <span class="stack">
          ${faces.map((p) => html`
            <span class="avatar" style=${avatarStyle(p.username)}>
              ${initials(p.username)}${avatarImg(p.username)}
            </span>
          `)}
        </span>
        <span class="count">${label}</span>
      </button>

      ${this.open ? html`
        <div
          class="menu"
          data-tauri-drag-region="false"
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @mousedown=${(e: Event) => e.stopPropagation()}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="menu-head">Online now</div>
          ${this.present.map((p) => {
            const isMe = p.username === this.me;
            return html`
              <div class="row">
                <span class="avatar" style=${avatarStyle(p.username)}>
                  ${initials(p.username)}${avatarImg(p.username)}
                </span>
                <div class="row-main">
                  <div class="row-name">
                    ${p.username}${isMe ? html`<span class="you-tag">you</span>` : nothing}
                  </div>
                  <div class="row-when">${this.timeAgo(p.last_seen)}</div>
                </div>
              </div>
            `;
          })}

          <div class="share">
            <div class="share-title">Enjoying Kairos? Share it with a teammate</div>
            <button class="share-btn" @click=${this.copyShareLink}>
              ${this.copied ? 'Copied!' : 'Copy link to share'}
            </button>
            <button class="note-link" @click=${this.openTestimonials}>Leave a note →</button>
          </div>

          <div class="presence-pref">
            <button class="hide-presence-btn" @click=${this.hideOnlineUsers}>
              Hide online users pill
            </button>
          </div>
        </div>
      ` : nothing}
    `;
  }
}
