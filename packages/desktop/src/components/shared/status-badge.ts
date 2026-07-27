import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("status-badge")
export class StatusBadge extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot[data-status="idle"] { background: var(--text-dim); }
    .dot[data-status="streaming"] { background: var(--green); animation: pulse 1.5s ease infinite; }
    .dot[data-status="waiting_permission"] { background: var(--amber); animation: pulse 1s ease infinite; }
    .dot[data-status="complete"] { background: var(--blue); }
    .dot[data-status="error"] { background: var(--red); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .label {
      font-size: 0.7rem;
      color: var(--text-dim);
      text-transform: capitalize;
    }
  `;

  @property() status: string = "idle";
  @property({ type: Boolean }) showLabel = false;

  render() {
    return html`
      <div class="dot" data-status=${this.status}></div>
      ${this.showLabel ? html`<span class="label">${this.status.replace("_", " ")}</span>` : ""}
    `;
  }
}
