import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sessionPreviewUrl, exportSessionUrl, type SessionEntry } from '../services/api.js';
import { icon } from './icons.js';
import './agent-logo.js';
import { hasAgentLogo } from './agent-logo.js';

// A read-only preview of a session's transcript, rendered by the kairos CLI's
// HTML export served inline (see /sessions/:id/export?inline=true) inside an
// iframe. Lets you skim more context than the row preview before resuming,
// without downloading a file. Reuses the launch-picker backdrop/dialog pattern.
@customElement('kairos-session-preview')
export class DevaiSessionPreview extends LitElement {
  @property({ attribute: false }) session!: SessionEntry;
  @state() private loaded = false;

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
      width: min(960px, 94vw);
      height: min(820px, 90vh);
      display: flex;
      flex-direction: column;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }
    .header {
      padding: 16px 20px 12px;
      border-bottom: 1px solid var(--w8);
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .heading { min-width: 0; flex: 1; }
    .title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--bright-white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .subtitle {
      font-size: var(--font-size-sm);
      color: var(--gray);
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
    }
    .tool-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px;
      border-radius: 99px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      background: var(--w8);
      color: var(--gray);
      font-family: var(--font);
    }
    .icon-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm, 5px);
      transition: all var(--transition-fast);
    }
    .icon-btn:hover { color: var(--bright-white); background: var(--w8); }
    .body {
      flex: 1;
      position: relative;
      background: #fff;
      min-height: 0;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
    .frame-loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--gray);
      background: var(--surface-raised);
      font-size: var(--font-size-base);
    }
    .footer {
      padding: 12px 20px 14px;
      border-top: 1px solid var(--w8);
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
    }
    .btn {
      padding: 6px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-base);
      cursor: pointer;
      white-space: nowrap;
      text-decoration: none;
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
  `;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private resume() {
    this.dispatchEvent(new CustomEvent('resume', { detail: this.session, bubbles: true, composed: true }));
  }

  private handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this.close();
  }

  render() {
    const s = this.session;
    const displayTitle = s.title || s.firstMessage || s.id.slice(0, 8);
    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="header">
            <div class="heading">
              <div class="title">${displayTitle}</div>
              <div class="subtitle">
                <span class="tool-pill ${s.tool}">
                  ${hasAgentLogo(s.tool) ? html`<agent-logo .agent=${s.tool} .size=${12}></agent-logo>` : ''} ${s.tool}
                </span>
                <span>${s.messages} message${s.messages === 1 ? '' : 's'}</span>
                <span>${s.id.slice(0, 8)}</span>
              </div>
            </div>
            <button class="icon-btn" aria-label="Close preview" @click=${() => this.close()}>
              ${icon.close(18)}
            </button>
          </div>
          <div class="body">
            ${this.loaded ? '' : html`<div class="frame-loading">Loading transcript…</div>`}
            <iframe
              src=${sessionPreviewUrl(s.id)}
              title="Session transcript preview"
              sandbox="allow-scripts allow-popups"
              @load=${() => { this.loaded = true; }}
            ></iframe>
          </div>
          <div class="footer">
            <a class="btn" href=${exportSessionUrl(s.id, 'html')} target="_blank" rel="noopener">Export HTML</a>
            <a class="btn" href=${exportSessionUrl(s.id, 'md')} target="_blank" rel="noopener">Export MD</a>
            <button class="btn primary" @click=${() => this.resume()}>Resume</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kairos-session-preview': DevaiSessionPreview;
  }
}
