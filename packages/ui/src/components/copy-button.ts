import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { icon } from './icons.js';
import { tooltip } from '../directives/tooltip.js';

// Reusable copy-to-clipboard control. Pass `.text` for a fixed string, or
// `.getText` to serialize lazily at click time (used for the whole transcript,
// which is cheap to compute only on demand). Flips to a checkmark briefly on
// success so the copy is confirmed.
@customElement('copy-button')
export class CopyButton extends LitElement {
  @property({ type: String }) text = '';
  @property({ attribute: false }) getText?: () => string;
  // Optional visible label (e.g. "Copy all"); omit for an icon-only button.
  @property({ type: String }) label = '';
  // Tooltip / aria text for the idle state.
  @property({ type: String }) title = 'Copy';

  @state() private copied = false;
  private resetTimer?: ReturnType<typeof setTimeout>;

  static styles = css`
    :host { display: inline-flex; }
    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      color: var(--gray);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      padding: 4px 6px;
      cursor: pointer;
      font: inherit;
      font-size: var(--font-size-sm);
      font-weight: 500;
      transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast);
    }
    button:hover { color: var(--bright-white); background: var(--accent-a10); }
    button.copied { color: var(--emerald); }
    button.outlined { border-color: var(--glass-border); height: 32px; padding: 0 12px; color: var(--gray); }
    button.outlined:hover { color: var(--bright-white); border-color: var(--accent-a35); background: var(--accent-a10); }
    svg { display: block; }
    .label { white-space: nowrap; }
  `;

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }

  private async copy() {
    const value = this.getText ? this.getText() : this.text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    this.copied = true;
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.copied = false;
    }, 1500);
  }

  render() {
    const cls = `${this.label ? 'outlined' : ''} ${this.copied ? 'copied' : ''}`.trim();
    return html`
      <button
        class=${cls || nothing}
        @click=${this.copy}
        ${tooltip(this.copied ? 'Copied' : this.title)}
        aria-label=${this.copied ? 'Copied' : this.title}
      >
        ${this.copied ? icon.check(15) : icon.copy(15)}
        ${this.label ? html`<span class="label">${this.copied ? 'Copied' : this.label}</span>` : nothing}
      </button>
    `;
  }
}
