import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("input-bar")
export class InputBar extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }

    .container {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      transition: border-color var(--transition-fast);
    }

    .container:focus-within {
      border-color: var(--amber);
    }

    textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 0.85rem;
      line-height: 1.4;
      resize: none;
      outline: none;
      max-height: 120px;
      min-height: 20px;
    }

    textarea::placeholder {
      color: var(--text-muted);
    }

    textarea:disabled {
      opacity: 0.5;
    }

    .send-btn {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: var(--amber);
      color: var(--bg);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: bold;
      transition: all var(--transition-fast);
      flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
      background: #fbbf24;
      transform: scale(1.05);
    }

    .send-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  `;

  @property({ type: Boolean }) disabled = false;
  @property() placeholder = "Send a message... (Enter to send, Shift+Enter for newline)";

  private get textarea(): HTMLTextAreaElement | null {
    return this.renderRoot.querySelector("textarea");
  }

  render() {
    return html`
      <div class="container">
        <textarea
          rows="1"
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          @keydown=${this.handleKeydown}
          @input=${this.autoResize}
        ></textarea>
        <button class="send-btn" ?disabled=${this.disabled} @click=${this.handleSend} title="Send (Enter)">↑</button>
      </div>
    `;
  }

  focus(): void {
    this.textarea?.focus();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  private handleSend(): void {
    const ta = this.textarea;
    if (!ta || this.disabled) return;
    const text = ta.value.trim();
    if (!text) return;
    ta.value = "";
    ta.style.height = "auto";
    this.dispatchEvent(new CustomEvent("send", { detail: text, bubbles: true, composed: true }));
  }

  private autoResize(): void {
    const ta = this.textarea;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }
}
