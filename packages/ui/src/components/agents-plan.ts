// The agent's task plan — the ACP `plan` update rendered as a checklist in the
// side panel, beside Files/Review/Summary. It's a pure view of `session.plan`
// (folded in acp-conversation.ts); the agent authors and updates it, we just
// draw it with live status. Not every session has one, hence the empty state.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AgentSession } from '../services/agents-session.js';
import type { PlanEntry } from '../services/acp-types.js';
import { tooltip } from '../directives/tooltip.js';
import { renderMarkdown, markdownStyles } from './markdown.js';
import { icon } from './icons.js';

@customElement('agents-plan')
export class AgentsPlan extends LitElement {
  @property({ attribute: false }) session!: AgentSession;

  static styles = [markdownStyles, css`
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
      color: var(--purple-light);
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
      padding: 14px 16px;
    }
    .plan-entry { display: flex; gap: 9px; align-items: baseline; font-size: var(--font-size-base); padding: 4px 0; color: var(--white); }
    .plan-entry.completed { color: var(--neutral-gray); text-decoration: line-through; }
    .plan-entry.in_progress { color: var(--purple-light); font-weight: 500; }
    .plan-check { font-size: var(--font-size-sm); flex-shrink: 0; }
    .empty {
      margin: auto;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      padding: 40px 24px;
      max-width: 320px;
    }
    .plan-doc {
      padding-bottom: 14px;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--glass-border);
    }
    .plan-doc-head {
      margin: 0 0 8px;
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--neutral-gray);
    }
  `];

  private planEntry(e: PlanEntry) {
    const glyph = e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '▸' : '○';
    return html`
      <div class="plan-entry ${e.status ?? ''}">
        <span class="plan-check">${glyph}</span>
        <span>${e.content}</span>
      </div>
    `;
  }

  render() {
    const plan = this.session.plan;
    const doc = this.session.planDoc;
    const done = plan.filter((e) => e.status === 'completed').length;
    const hasContent = !!doc || plan.length > 0;
    return html`
      <div class="head">
        <h2>Plan</h2>
        ${plan.length > 0 ? html`<span class="count">${done}/${plan.length}</span>` : nothing}
        <button class="close" ${tooltip('Close plan')} @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>${icon.close(18)}</button>
      </div>
      <div class="scroll">
        ${doc ? html`<div class="plan-doc md"><p class="plan-doc-head">Proposed plan</p>${renderMarkdown(doc)}</div>` : nothing}
        ${plan.length > 0 ? plan.map((e) => this.planEntry(e)) : nothing}
        ${!hasContent ? html`<p class="empty">No plan yet. Plans appear here when the agent breaks the task into a to-do list and tracks its progress — not every session has one.</p>` : nothing}
      </div>
    `;
  }
}
