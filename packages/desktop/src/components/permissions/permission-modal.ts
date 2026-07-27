import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PermissionRequest } from "../../lib/acp/types.js";

@customElement("permission-modal")
export class PermissionModal extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      pointer-events: none;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      pointer-events: auto;
    }

    .modal {
      position: relative;
      background: var(--surface);
      border-top: 1px solid var(--border);
      border-radius: var(--radius) var(--radius) 0 0;
      padding: 20px 24px;
      pointer-events: auto;
      animation: slideUp 200ms ease;
      box-shadow: var(--shadow-lg);
    }

    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }

    .title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--amber);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .description {
      font-size: 0.82rem;
      color: var(--text);
      line-height: 1.5;
      margin-bottom: 6px;
    }

    .tool-name {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--blue);
      background: var(--bg);
      padding: 2px 8px;
      border-radius: 4px;
    }

    .input-preview {
      margin-top: 8px;
      padding: 8px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-dim);
      max-height: 80px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }

    button {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .allow-once {
      background: var(--green);
      border-color: var(--green);
      color: white;
    }
    .allow-once:hover { opacity: 0.9; }

    .allow-always {
      background: transparent;
      color: var(--green);
      border-color: var(--green);
    }
    .allow-always:hover { background: var(--green); color: white; }

    .deny {
      background: transparent;
      color: var(--red);
      border-color: var(--red);
      margin-left: auto;
    }
    .deny:hover { background: var(--red); color: white; }
  `;

  @property({ attribute: false }) request: PermissionRequest | null = null;

  render() {
    if (!this.request) return html``;

    return html`
      <div class="backdrop" @click=${() => this.respond("deny")}></div>
      <div class="modal">
        <div class="title">Permission Request</div>
        <div class="description">
          <span class="tool-name">${this.request.tool}</span> — ${this.request.description}
        </div>
        ${this.request.input ? html`
          <div class="input-preview">${JSON.stringify(this.request.input, null, 2)}</div>
        ` : ""}
        <div class="actions">
          <button class="allow-once" @click=${() => this.respond("allow_once")}>Allow Once</button>
          <button class="allow-always" @click=${() => this.respond("allow_always")}>Allow Always</button>
          <button class="deny" @click=${() => this.respond("deny")}>Deny</button>
        </div>
      </div>
    `;
  }

  private respond(decision: "allow_once" | "allow_always" | "deny"): void {
    if (!this.request) return;
    this.dispatchEvent(new CustomEvent("permission-response", {
      detail: { id: this.request.id, decision },
      bubbles: true,
      composed: true,
    }));
  }
}
