import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../shared/status-badge.js";

@customElement("agent-tab")
export class AgentTab extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background var(--transition-fast);
      border: 1px solid transparent;
    }

    .tab:hover {
      background: var(--surface2);
    }

    .tab[data-active] {
      background: var(--surface2);
      border-color: var(--border);
    }

    .info {
      flex: 1;
      min-width: 0;
    }

    .name {
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .preview {
      font-size: 0.72rem;
      color: var(--text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }

    .badge {
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      background: var(--amber);
      color: var(--bg);
      font-size: 0.65rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
    }

    .close-btn {
      opacity: 0;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: var(--text-dim);
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      transition: all var(--transition-fast);
    }

    .tab:hover .close-btn { opacity: 1; }
    .close-btn:hover { background: var(--red); color: white; }
  `;

  @property() agentId = "";
  @property() name = "";
  @property() status = "idle";
  @property() preview = "";
  @property({ type: Number }) unread = 0;
  @property({ type: Boolean }) active = false;

  render() {
    return html`
      <div class="tab" ?data-active=${this.active} @click=${this.handleClick}>
        <status-badge .status=${this.status}></status-badge>
        <div class="info">
          <div class="name">${this.name}</div>
          ${this.preview ? html`<div class="preview">${this.preview}</div>` : ""}
        </div>
        ${this.unread > 0 ? html`<div class="badge">${this.unread}</div>` : ""}
        <button class="close-btn" @click=${this.handleClose} title="Close agent">×</button>
      </div>
    `;
  }

  private handleClick(): void {
    this.dispatchEvent(new CustomEvent("select", { detail: this.agentId, bubbles: true, composed: true }));
  }

  private handleClose(e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("close-agent", { detail: this.agentId, bubbles: true, composed: true }));
  }
}
