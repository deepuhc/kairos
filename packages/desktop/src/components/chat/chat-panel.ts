import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChatMessage } from "../../lib/store.js";
import "./message-bubble.js";
import "./tool-call-card.js";
import "./input-bar.js";

@customElement("chat-panel")
export class ChatPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }

    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-dim);
      gap: 8px;
    }

    .empty h3 {
      font-size: 1rem;
      font-weight: 500;
      color: var(--text);
    }

    .empty p {
      font-size: 0.82rem;
      text-align: center;
      max-width: 300px;
      line-height: 1.5;
    }

    .cost-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 4px 16px;
      font-size: 0.7rem;
      color: var(--text-muted);
      gap: 12px;
    }
  `;

  @property({ type: Array }) messages: ChatMessage[] = [];
  @property({ type: Boolean }) streaming = false;
  @property({ type: Number }) costUsd = 0;
  @property({ type: Number }) durationMs = 0;

  protected updated(): void {
    const container = this.renderRoot.querySelector(".messages");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  render() {
    const hasMessages = this.messages.length > 0;

    return html`
      ${hasMessages ? html`
        <div class="messages">
          ${this.messages.map((msg) => this.renderMessage(msg))}
        </div>
      ` : html`
        <div class="empty">
          <h3>Start a conversation</h3>
          <p>Type a task below. Kairos will route it to the right agent and orchestrate multi-step workflows automatically.</p>
        </div>
      `}
      ${this.costUsd > 0 ? html`
        <div class="cost-bar">
          <span>$${this.costUsd.toFixed(4)}</span>
          <span>${(this.durationMs / 1000).toFixed(1)}s</span>
        </div>
      ` : ""}
      <input-bar ?disabled=${this.streaming}></input-bar>
    `;
  }

  private renderMessage(msg: ChatMessage) {
    if (msg.type === "tool_use") {
      return html`<tool-call-card
        .name=${msg.name}
        .input=${msg.input}
        .result=${msg.result}
        ?isError=${msg.isError ?? false}
      ></tool-call-card>`;
    }
    return html`<message-bubble .message=${msg}></message-bubble>`;
  }
}
