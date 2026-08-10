import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { renderMarkdown, markdownStyles } from './markdown.js';
import { hljsTheme } from './code-highlight.js';
import { icon } from './icons.js';
import { tooltip } from '../directives/tooltip.js';

@customElement('kairos-whats-new')
export class DevaiWhatsNew extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: String }) version = '';
  @property({ type: String }) notes = '';

  static styles = [hljsTheme, markdownStyles, css`
    :host { display: contents; }
    .backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 120;
      animation: fade-in 0.15s ease-out;
    }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    .modal {
      width: min(540px, 94vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: var(--surface-modal);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
      overflow: hidden;
      animation: pop-in 0.18s cubic-bezier(0.2, 0, 0, 1);
    }
    @keyframes pop-in {
      from { transform: scale(0.96) translateY(8px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }
    .head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 24px 16px;
      flex-shrink: 0;
    }
    .head .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: var(--accent-a15);
      color: var(--accent);
      flex-shrink: 0;
    }
    .head .badge svg { display: block; }
    .head-text { display: flex; flex-direction: column; gap: 2px; }
    .head-text h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--bright-white);
      letter-spacing: -0.01em;
    }
    .head-text .subtitle {
      font-size: var(--font-size-sm);
      color: var(--gray);
    }
    .head-spacer { flex: 1; }
    .close {
      border: none;
      background: none;
      color: var(--neutral-gray);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }
    .close:hover { color: var(--white); background: var(--w8); }
    .close svg { display: block; }
    .scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0 24px 16px;
      color: var(--light-gray);
      line-height: 1.6;
      font-size: var(--font-size-sm);
    }
    .scroll::-webkit-scrollbar { width: 8px; }
    .scroll::-webkit-scrollbar-track { background: transparent; }
    .scroll::-webkit-scrollbar-thumb {
      background: var(--w10);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    .scroll .md h3 {
      font-size: 13px;
      font-weight: 600;
      color: var(--bright-white);
      margin: 20px 0 10px;
      padding-bottom: 0;
      border-bottom: none;
      letter-spacing: -0.01em;
    }
    .scroll .md h3:first-child { margin-top: 4px; }
    .scroll .md strong {
      color: var(--white);
      font-weight: 600;
    }
    .scroll .md ul {
      margin: 6px 0 12px;
      padding-left: 16px;
    }
    .scroll .md li {
      margin: 3px 0;
      color: var(--light-gray);
    }
    .scroll .md li::marker {
      color: var(--accent);
    }
    .scroll .md hr {
      border: none;
      border-top: 1px solid var(--glass-border);
      margin: 16px 0;
    }
    .empty {
      margin: 8px 0 16px;
      font-size: var(--font-size-sm);
      color: var(--gray);
      line-height: 1.5;
    }
    .empty strong { color: var(--white); font-family: var(--font-mono); }
    .foot {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 12px 24px 16px;
      flex-shrink: 0;
    }
    .done {
      padding: 7px 18px;
      border: none;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .done:hover { filter: brightness(1.1); }
    .done:active { transform: scale(0.97); }
  `];

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (this.open && e.key === 'Escape') this.dismiss();
  };

  private dismiss() {
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }

  private handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this.dismiss();
  }

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        <div class="modal" role="dialog" aria-modal="true" aria-label="What's new in Kairos">
          <div class="head">
            <span class="badge">${icon.gift(18)}</span>
            <div class="head-text">
              <h2>What's new</h2>
              ${this.version ? html`<span class="subtitle">Recent changes in Kairos</span>` : nothing}
            </div>
            <div class="head-spacer"></div>
            <button class="close" ${tooltip('Close')} @click=${() => this.dismiss()} aria-label="Close">${icon.close(16)}</button>
          </div>
          <div class="scroll">
            ${this.notes.trim()
              ? html`<div class="md">${renderMarkdown(this.notes)}</div>`
              : html`<p class="empty">You're up to date${this.version ? html` on <strong>v${this.version}</strong>` : nothing}. No release notes are available yet — check back after the next update.</p>`}
          </div>
          <div class="foot">
            <button class="done" @click=${() => this.dismiss()}>Done</button>
          </div>
        </div>
      </div>
    `;
  }
}
