import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("tool-call-card")
export class ToolCallCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin-bottom: 8px;
      margin-right: 40px;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
      transition: border-color var(--transition-fast);
    }

    .card:hover { border-color: var(--text-dim); }
    .card[data-error] { border-color: var(--red); }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--surface);
      cursor: pointer;
      user-select: none;
    }

    .icon {
      font-size: 0.75rem;
      color: var(--text-dim);
      transition: transform var(--transition-fast);
    }

    .icon[data-expanded] { transform: rotate(90deg); }

    .tool-name {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--blue);
    }

    .status-icon {
      margin-left: auto;
      font-size: 0.7rem;
    }

    .body {
      padding: 10px 12px;
      background: var(--bg);
      font-family: var(--font-mono);
      font-size: 0.72rem;
      line-height: 1.5;
      color: var(--text-dim);
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .body[hidden] { display: none; }

    .result {
      border-top: 1px solid var(--border);
      padding: 8px 12px;
      background: var(--surface);
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-dim);
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .result[data-error] { color: var(--red); }
    .result[hidden] { display: none; }
  `;

  @property() name = "";
  @property({ attribute: false }) input: Record<string, unknown> = {};
  @property() result: string | undefined;
  @property({ type: Boolean }) isError = false;
  @property({ type: Boolean }) expanded = false;

  render() {
    const hasResult = this.result !== undefined;
    const statusIcon = hasResult
      ? this.isError ? "✗" : "✓"
      : "⋯";

    return html`
      <div class="card" ?data-error=${this.isError}>
        <div class="header" @click=${this.toggle}>
          <span class="icon" ?data-expanded=${this.expanded}>▸</span>
          <span class="tool-name">${this.name}</span>
          <span class="status-icon">${statusIcon}</span>
        </div>
        <div class="body" ?hidden=${!this.expanded}>
          ${JSON.stringify(this.input, null, 2)}
        </div>
        <div class="result" ?hidden=${!hasResult || !this.expanded} ?data-error=${this.isError}>
          ${this.result}
        </div>
      </div>
    `;
  }

  private toggle(): void {
    this.expanded = !this.expanded;
  }
}
