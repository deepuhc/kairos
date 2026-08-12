// The Prompts panel — a chronological outline of every prompt the user sent in
// this session, beside Files/Plan/Review/Summary. Jumping between sessions loses
// context, so this makes "what did I ask?" one click: each row scrolls the
// timeline to that message and briefly highlights it. Pure view of
// `session.items` filtered to the user's own messages (works for live and
// resumed sessions alike).

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AgentSession } from '../services/agents-session.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

@customElement('agents-prompts')
export class AgentsPrompts extends LitElement {
  @property({ attribute: false }) session!: AgentSession;
  // Rendered as a full-page global view (top-nav Prompts) rather than the
  // session side panel: hide the panel close button.
  @property({ type: Boolean }) fullBleed = false;

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border);
      flex-shrink: 0;
    }
    .head h2 {
      margin: 0;
      flex: 1;
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--white);
    }
    .count {
      color: var(--accent-light, var(--accent));
      font-size: var(--font-size-sm);
      font-variant-numeric: tabular-nums;
    }
    .close {
      border: none;
      background: none;
      color: var(--neutral-gray);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius);
    }
    .close:hover { color: var(--white); background: var(--w5); }
    .close svg { display: block; }
    .scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 10px;
    }
    .prompt-row {
      display: flex;
      gap: 9px;
      align-items: baseline;
      width: 100%;
      border-radius: var(--radius);
    }
    .prompt-main {
      display: flex;
      gap: 9px;
      align-items: baseline;
      flex: 1;
      min-width: 0;
      text-align: left;
      border: none;
      background: none;
      cursor: pointer;
      padding: 9px 10px;
      border-radius: var(--radius);
      color: var(--white);
    }
    .prompt-row:hover { background: var(--w5); }
    .prompt-num {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      font-variant-numeric: tabular-nums;
      min-width: 1.4em;
    }
    .prompt-body { flex: 1; min-width: 0; }
    .prompt-text {
      font-size: var(--font-size-base);
      line-height: 1.45;
      color: var(--white);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .prompt-time {
      margin-top: 3px;
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      font-family: var(--font-mono);
    }
    .empty {
      margin: auto;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      padding: 40px 24px;
      max-width: 320px;
    }
  `;

  private jump(id: string) {
    this.dispatchEvent(new CustomEvent('jump-to-item', { detail: { id }, bubbles: true, composed: true }));
  }

  render() {
    const prompts = this.session.items
      .filter((i) => i.kind === 'message' && i.role === 'user')
      .map((i) => i as Extract<AgentSession['items'][number], { kind: 'message' }>);
    return html`
      <div class="head">
        <h2>Prompts</h2>
        ${prompts.length > 0 ? html`<span class="count">${prompts.length}</span>` : nothing}
        ${this.fullBleed ? nothing : html`<button class="close" ${tooltip('Close prompts')} @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>${icon.close(18)}</button>`}
      </div>
      <div class="scroll">
        ${prompts.length > 0
          ? prompts.map(
              (p, i) => html`
                <div class="prompt-row">
                  <button class="prompt-main" @click=${() => this.jump(p.id)} ${tooltip('Jump to this prompt')}>
                    <span class="prompt-num">${i + 1}</span>
                    <span class="prompt-body">
                      <span class="prompt-text">${p.text}</span>
                      <span class="prompt-time">${formatClock(p.ts)}</span>
                    </span>
                  </button>
                </div>
              `,
            )
          : html`<p class="empty">No prompts yet. Your messages in this session will appear here so you can jump back to any of them.</p>`}
      </div>
    `;
  }
}
