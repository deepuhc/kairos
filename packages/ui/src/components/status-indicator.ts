import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type StatusState = 'idle' | 'thinking' | 'working' | 'error' | 'waiting';

// Pure text status indicator — the shimmer-label half of "Option A" without
// any geometric shape. Colour carries state; the shimmer sweep adds motion
// only for the two active states (thinking/working). Gated behind
// prefers-reduced-motion so it degrades to a static accent-blue label.
@customElement('status-indicator')
export class StatusIndicator extends LitElement {
  @property({ type: String }) state: StatusState = 'idle';
  @property({ type: String }) label = '';

  static styles = css`
    :host { display: inline-flex; line-height: 1; }
    .label { font-size: var(--font-size-md); font-weight: 500; white-space: nowrap; }
    .idle .label { color: var(--neutral-gray); }
    .thinking .label, .working .label {
      color: var(--accent);
      background: linear-gradient(90deg, var(--accent) 30%, var(--bright-white) 50%, var(--accent) 70%);
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .waiting .label { color: var(--accent); }
    .error .label { color: var(--red); }

    @media (prefers-reduced-motion: no-preference) {
      .thinking .label, .working .label { animation: shimmer 1.8s linear infinite; }
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
  `;

  render() {
    if (!this.label) return html``;
    return html`<span class=${this.state}><span class="label">${this.label}</span></span>`;
  }
}
