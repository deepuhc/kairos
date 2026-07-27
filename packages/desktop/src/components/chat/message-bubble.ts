import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChatMessage } from "../../lib/store.js";

@customElement("message-bubble")
export class MessageBubble extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin-bottom: 8px;
    }

    .bubble {
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .bubble[data-type="user"] {
      background: var(--surface3);
      color: var(--text);
      margin-left: 40px;
      border-bottom-right-radius: 4px;
    }

    .bubble[data-type="text"] {
      background: var(--surface);
      color: var(--text);
      margin-right: 40px;
    }

    .bubble[data-type="thinking"] {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 0.8rem;
      margin-right: 40px;
      cursor: pointer;
    }

    .bubble[data-type="thinking"] .label {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--purple);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }

    .bubble[data-type="thinking"][data-collapsed] .content {
      display: none;
    }

    .bubble[data-type="system"] {
      background: transparent;
      color: var(--text-muted);
      font-size: 0.75rem;
      text-align: center;
      padding: 6px;
    }
  `;

  @property({ attribute: false }) message!: ChatMessage;
  @property({ type: Boolean }) collapsed = true;

  render() {
    const msg = this.message;

    if (msg.type === "thinking") {
      return html`
        <div class="bubble" data-type="thinking" ?data-collapsed=${this.collapsed} @click=${this.toggleCollapse}>
          <div class="label">Thinking</div>
          <div class="content">${msg.text}</div>
        </div>
      `;
    }

    if (msg.type === "tool_use") return html``;

    return html`
      <div class="bubble" data-type=${msg.type}>${msg.text}</div>
    `;
  }

  private toggleCollapse(): void {
    this.collapsed = !this.collapsed;
  }
}
