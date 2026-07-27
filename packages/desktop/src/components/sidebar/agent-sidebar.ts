import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AgentState } from "../../lib/store.js";
import "./agent-tab.js";

@customElement("agent-sidebar")
export class AgentSidebar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }

    .header h3 {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
    }

    .new-btn {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-dim);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      transition: all var(--transition-fast);
    }

    .new-btn:hover {
      background: var(--surface2);
      color: var(--text);
      border-color: var(--amber);
    }

    .list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .empty {
      padding: 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.8rem;
    }
  `;

  @property({ type: Array }) agents: AgentState[] = [];
  @property() activeId: string | null = null;

  render() {
    return html`
      <div class="header">
        <h3>Agents</h3>
        <button class="new-btn" @click=${this.handleNew} title="New Agent (Cmd+N)">+</button>
      </div>
      <div class="list">
        ${this.agents.length === 0
          ? html`<div class="empty">No agents yet</div>`
          : this.agents.map((a) => html`
            <agent-tab
              .agentId=${a.id}
              .name=${a.name}
              .status=${a.status}
              .preview=${this.getPreview(a)}
              .unread=${a.unread}
              ?active=${a.id === this.activeId}
            ></agent-tab>
          `)}
      </div>
    `;
  }

  private getPreview(agent: AgentState): string {
    const last = agent.messages[agent.messages.length - 1];
    if (!last) return "";
    if (last.type === "text") return last.text.slice(0, 60);
    if (last.type === "tool_use") return `Using ${last.name}...`;
    if (last.type === "thinking") return "Thinking...";
    return "";
  }

  private handleNew(): void {
    this.dispatchEvent(new CustomEvent("new-agent", { bubbles: true, composed: true }));
  }
}
