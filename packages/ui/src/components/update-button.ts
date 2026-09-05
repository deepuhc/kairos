import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  getKairosUpdateNotice,
  updateMonitor,
  type KairosUpdateState,
} from '../services/update-monitor.js';
import { installDesktopUpdate } from '../services/desktop-updater.js';
import { applyGitUpdate } from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';

@customElement('kairos-update-button')
export class DevaiUpdateButton extends LitElement {
  @state() private updateState: KairosUpdateState = updateMonitor.current;
  @state() private updating = false;
  @state() private progress: string | null = null;

  private unsubscribeUpdates: (() => void) | null = null;

  static styles = css`
    :host {
      display: inline-flex;
    }

    .update-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      height: 36px;
      padding: 0 13px;
      border: 1px solid var(--amber-a35, rgba(245, 158, 11, 0.35));
      border-radius: 999px;
      background:
        linear-gradient(135deg, rgba(251, 191, 36, 0.96), rgba(245, 158, 11, 0.9)),
        var(--amber, #f59e0b);
      color: #181006;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.18);
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: 750;
      letter-spacing: -0.01em;
      white-space: nowrap;
      transition: transform var(--transition-fast), filter var(--transition-fast), box-shadow var(--transition-fast);
    }

    .update-cta:hover {
      filter: brightness(1.04);
      transform: translateY(-1px);
      box-shadow: 0 10px 28px rgba(245, 158, 11, 0.24);
    }

    .update-cta:active {
      transform: translateY(0);
    }

    .update-cta:disabled {
      cursor: wait;
      filter: saturate(0.9);
      opacity: 0.82;
      transform: none;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #181006;
      box-shadow: 0 0 0 4px rgba(24, 16, 6, 0.12);
      animation: update-dot-pulse 1.8s ease-out infinite;
    }

    .detail {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      font-weight: 700;
      opacity: 0.78;
    }

    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .mobile-label {
      display: none;
    }

    @keyframes update-dot-pulse {
      0%, 100% { box-shadow: 0 0 0 4px rgba(24, 16, 6, 0.12); }
      50% { box-shadow: 0 0 0 7px rgba(24, 16, 6, 0); }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 1040px) {
      .detail {
        display: none;
      }
    }

    @media (max-width: 700px) {
      .update-cta {
        padding: 0 10px;
      }

      .label {
        display: none;
      }

      .mobile-label {
        display: inline;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribeUpdates = updateMonitor.subscribe((state) => {
      this.updateState = state;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribeUpdates?.();
    this.unsubscribeUpdates = null;
  }

  private async installUpdate() {
    if (this.updating) return;
    const notice = getKairosUpdateNotice(this.updateState);
    // Git-based self-update: the standalone (browser) build updates by asking
    // the server to fast-forward the clone, rebuild, and restart, then waits
    // for it to come back and reloads.
    if (notice?.kind === 'source') {
      await this.installSourceUpdate();
      return;
    }
    this.updating = true;
    this.progress = 'Starting';
    try {
      const result = await installDesktopUpdate((event) => {
        if (event.event === 'Started') {
          this.progress = event.data.contentLength
            ? `${Math.ceil(event.data.contentLength / 1024 / 1024)} MB`
            : 'Downloading';
        } else if (event.event === 'Progress') {
          this.progress = 'Downloading';
        } else if (event.event === 'Finished') {
          this.progress = 'Installing';
        }
      });
      if (result.restartRequired) {
        this.progress = 'Restart required';
        this.updating = false;
        alert(result.message ?? 'Update installed. Close and reopen Kairos to finish.');
      }
    } catch (err: any) {
      alert(`Kairos update failed: ${err?.message ?? String(err)}`);
      this.progress = null;
      this.updating = false;
      await updateMonitor.refreshNow();
    }
  }

  // Trigger a git-based self-update and wait for the rebuilt server to return.
  private async installSourceUpdate() {
    this.updating = true;
    this.progress = 'Updating';
    try {
      const result = await applyGitUpdate();
      if (!result.ok) {
        this.updating = false;
        this.progress = null;
        alert(`Kairos update failed: ${result.message}`);
        await updateMonitor.refreshNow();
        return;
      }
      if (!result.updated) {
        // Nothing to do — someone else already updated, or we raced.
        this.updating = false;
        this.progress = null;
        await updateMonitor.refreshNow();
        return;
      }
      // The server is now rebuilding + restarting (supervisor). Wait for it to
      // accept requests again, then reload into the new build.
      this.progress = 'Rebuilding';
      const cameBack = await this.waitForServerBack();
      if (cameBack) {
        this.progress = 'Reloading';
        window.location.reload();
      } else {
        this.updating = false;
        this.progress = null;
        alert('Kairos updated but is taking a while to restart. Reload the page in a moment.');
      }
    } catch (err: any) {
      this.updating = false;
      this.progress = null;
      alert(`Kairos update failed: ${err?.message ?? String(err)}`);
      await updateMonitor.refreshNow();
    }
  }

  // Poll /api/health until the rebuilt server responds (rebuild = npm install +
  // build, so allow a generous window), or give up after ~5 minutes.
  private async waitForServerBack(timeoutMs = 300_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    // Let the old process exit first so we don't get a false positive.
    await new Promise((r) => setTimeout(r, 1500));
    while (Date.now() < deadline) {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* server still down — keep polling */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  render() {
    const notice = getKairosUpdateNotice(this.updateState);
    if (!notice) return nothing;

    const tooltipText = this.updating
      ? `Installing ${notice.ariaLabel}.`
      : `${notice.ariaLabel}. Install now.`;

    return html`
      <button
        class="update-cta"
        ?disabled=${this.updating}
        @click=${this.installUpdate}
        ${tooltip(tooltipText)}
        aria-label=${tooltipText}
      >
        ${this.updating
          ? html`<span class="spinner" aria-hidden="true"></span>`
          : html`<span class="dot" aria-hidden="true"></span>`}
        <span class="label">${this.updating ? 'Installing Kairos' : notice.label}</span>
        <span class="mobile-label">${this.updating ? 'Installing' : 'Update'}</span>
        <span class="detail">${this.progress ?? notice.detail}</span>
      </button>
    `;
  }
}
