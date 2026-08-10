// Agent-authored markdown summary of a session's changes — a narrative
// companion to the Review panel's per-file diffs. Split out so Review stays
// purely about the diffs and each surface has its own rail button/panel.
//
// Generation costs a full agent turn, so it isn't run eagerly: agents-view
// fires it once when the panel is first opened (or on the Regenerate button),
// both of which dispatch `request-summary`. agents-view sends the prompt and
// diverts the reply into session.summary (so it never lands in the timeline),
// and the captured markdown renders here once the turn completes.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AgentSession } from '../services/agents-session.js';
import { renderMarkdown, markdownStyles } from './markdown.js';
import { collectSessionChanges } from '../services/review-changes.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';

@customElement('agents-summary')
export class AgentsSummary extends LitElement {
  @property({ attribute: false }) session!: AgentSession;
  // Whether a summary request is in flight (drives the button's busy state).
  @property({ type: Boolean }) summaryPending = false;

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
    .regen {
      padding: 5px 12px;
      border-radius: var(--radius);
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .regen:hover:not(:disabled) { border-color: var(--accent-a35); background: var(--accent-a15); }
    .regen:disabled { opacity: 0.5; cursor: default; }
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
    .body { background: var(--w3); border: 1px solid var(--w8); border-radius: var(--radius); padding: 12px 14px; }
    .empty {
      margin: auto;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      padding: 40px 20px;
    }
    .cta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      margin: auto;
      text-align: center;
      padding: 40px 24px;
    }
    .cta p { margin: 0; color: var(--neutral-gray); font-size: var(--font-size-sm); max-width: 320px; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .cta .pip { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
    .cta .generate {
      padding: 8px 16px;
      border-radius: var(--radius);
      border: 1px solid var(--accent-a35);
      background: var(--accent-a15);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .cta .generate:hover:not(:disabled) { background: var(--accent-a25); }
    .cta .generate:disabled { opacity: 0.5; cursor: default; }
  `];

  private requestSummary() {
    this.dispatchEvent(new CustomEvent('request-summary', { bubbles: true, composed: true }));
  }

  render() {
    const summary = this.session.summary;
    const hasChanges = collectSessionChanges(this.session.items, this.session.itemsVersion).filesChanged > 0;
    const canRequest = hasChanges && !this.summaryPending && this.session.phase === 'ready';
    return html`
      <div class="head">
        <h2>Summary</h2>
        ${summary
          ? html`<button class="regen" ?disabled=${!canRequest} @click=${() => this.requestSummary()}>
              ${this.summaryPending ? 'Generating…' : 'Regenerate'}
            </button>`
          : nothing}
        <button class="close" ${tooltip('Close summary')} @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>${icon.close(18)}</button>
      </div>
      <div class="scroll">
        ${summary
          ? html`<div class="body md">${renderMarkdown(summary)}</div>`
          : this.summaryPending
            ? html`<div class="cta"><span class="pip"></span><p>Generating summary…</p></div>`
            : html`
                <div class="cta">
                  <p>${hasChanges
                    ? 'Ask the agent to summarize what it changed and why, grouped by file.'
                    : 'This agent hasn’t changed any files yet.'}</p>
                  ${hasChanges ? html`
                    <button class="generate" ?disabled=${!canRequest} @click=${() => this.requestSummary()}>
                      Generate summary
                    </button>` : nothing}
                </div>
              `}
      </div>
    `;
  }
}
