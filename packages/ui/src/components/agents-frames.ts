// The "Frames" side panel: a live inspector of the raw ACP frames arriving from
// THIS session's agent, sitting beside the chat like Files/Review/Summary. It's
// the more behind-the-scenes of the panels — the same protocol traffic the
// full-page Behind the Scenes reference explains, but scoped to the session in
// front of you so you can watch the wire while you chat.
//
// The parent (agents-view) hands us the whole capped frame ring buffer and only
// re-renders us while this panel is open (see recordFrame's touch guard), so a
// streaming turn doesn't cost a render when nobody's looking. We filter to the
// session's own frames (plus connection-level handshake frames, which carry no
// sessionId) and fold renderable `session/update`s through the SAME Conversation
// + renderer the live timeline uses — so the preview can't drift from reality.

import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AgentSession } from '../services/agents-session.js';
import type { CapturedFrame } from '../services/acp-frames.js';
import type { SessionUpdate } from '../services/acp-types.js';
import { Conversation } from '../services/acp-conversation.js';
import {
  renderItem,
  renderPlan,
  renderUsage,
  timelineStyles,
  type TimelineRenderCtx,
} from './agents-timeline-render.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';
import './acp-json.js';
import './agents-tool-call.js';
import './agents-elicitation.js';

@customElement('agents-frames')
export class AgentsFrames extends LitElement {
  @property({ attribute: false }) session!: AgentSession;
  @property({ attribute: false }) frames: CapturedFrame[] = [];

  // Selection is tracked by frame id, not list index, so it stays put as new
  // frames stream in and shift the newest-first ordering.
  @state() private selectedId: number | null = null;
  // Pinned so relative timestamps are stable across renders (Date.now is
  // intentionally avoided in render). Ticks once a second while the panel is
  // mounted — which, since the panel is only rendered when open, means only
  // while the user is actually looking.
  @state() private now = 0;

  private nowInterval: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.now = Date.now();
    this.nowInterval = window.setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.nowInterval !== null) {
      clearInterval(this.nowInterval);
      this.nowInterval = null;
    }
  }

  static styles = [
    timelineStyles,
    css`
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

      .empty {
        margin: auto;
        text-align: center;
        color: var(--neutral-gray);
        font-size: var(--font-size-sm);
        padding: 40px 24px;
        max-width: 320px;
      }
      .empty strong { color: var(--white); display: block; margin-bottom: 4px; }

      /* Frame list — capped height at the top; detail scrolls below it. */
      .list {
        flex-shrink: 0;
        max-height: 42%;
        overflow-y: auto;
        border-bottom: 1px solid var(--glass-border);
      }
      .frame-row {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 9px 14px;
        border-bottom: 1px solid var(--w5);
        cursor: pointer;
        transition: background var(--transition-fast);
      }
      .frame-row:last-child { border-bottom: none; }
      .frame-row:hover { background: var(--w5); }
      .frame-row.sel { background: var(--accent-a10); border-left: 2px solid var(--accent); padding-left: 12px; }
      .frame-head {
        display: flex;
        align-items: center;
        gap: 7px;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
      }
      .frame-ch {
        padding: 1px 7px;
        border-radius: 99px;
        background: var(--accent-a18);
        color: var(--purple-light);
        font-weight: 600;
      }
      .frame-ch.update { background: var(--accent-a18); color: var(--purple-light); }
      .frame-ch.initialized { background: rgba(96, 165, 250, 0.18); color: var(--blue); }
      .frame-ch.session { background: rgba(52, 211, 153, 0.18); color: var(--emerald); }
      .frame-ch.permission-request,
      .frame-ch.elicitation-request { background: rgba(251, 191, 36, 0.18); color: var(--amber); }
      .frame-ch.config-options { background: var(--w10); color: var(--gray); }
      .frame-ch.stop { background: var(--w10); color: var(--neutral-gray); }
      .frame-time { color: var(--neutral-gray); margin-left: auto; }
      .frame-label {
        font-size: var(--font-size-sm);
        color: var(--white);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Detail — raw JSON, plus the rendered component when it's a session/update. */
      .detail {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      .pane {
        padding: 14px 16px;
        min-width: 0;
      }
      .pane + .pane { border-top: 1px solid var(--glass-border); }
      .pane-label {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--neutral-gray);
        margin-bottom: 8px;
      }
      .pane-label .pip { width: 6px; height: 6px; border-radius: 50%; }
      .pane-label .pip.json { background: var(--purple-light); }
      .pane-label .pip.ui { background: var(--emerald); }
    `,
  ];

  // Frames for this session, newest first. Handshake frames (initialized) carry
  // no sessionId — they're connection-level, so we keep them as useful context.
  private ownFrames(): CapturedFrame[] {
    const sid = this.session?.id;
    return this.frames
      .filter((f) => f.sessionId === undefined || f.sessionId === sid)
      .reverse();
  }

  render() {
    const frames = this.ownFrames();
    return html`
      <div class="head">
        <h2>Frames</h2>
        ${frames.length ? html`<span class="count">${frames.length}</span>` : nothing}
        <button
          class="close"
          ${tooltip('Close frames')}
          @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}
        >${icon.close(18)}</button>
      </div>
      ${frames.length === 0 ? this.renderEmpty() : this.renderBody(frames)}
    `;
  }

  private renderEmpty() {
    return html`
      <p class="empty">
        <strong>No frames yet</strong>
        Send a prompt in this session. The raw ACP frames the agent streams back appear here as it works.
      </p>
    `;
  }

  private renderBody(frames: CapturedFrame[]) {
    const selected =
      frames.find((f) => f.id === this.selectedId) ?? frames[0];
    return html`
      <div class="list">
        ${frames.map((f) => this.renderFrameRow(f, f.id === selected.id))}
      </div>
      <div class="detail">
        ${this.renderDetail(selected)}
      </div>
    `;
  }

  private renderFrameRow(f: CapturedFrame, selected: boolean) {
    return html`
      <div
        class="frame-row ${selected ? 'sel' : ''}"
        @click=${() => { this.selectedId = f.id; }}
      >
        <div class="frame-head">
          <span class="frame-ch ${f.channel}">${f.channel}</span>
          <span class="frame-time">${this.relativeTime(f.ts)}</span>
        </div>
        <div class="frame-label">${f.label}</div>
      </div>
    `;
  }

  private renderDetail(f: CapturedFrame) {
    const rendered = this.renderFramePreview(f);
    return html`
      <div class="pane">
        <div class="pane-label"><span class="pip json"></span>Raw payload</div>
        <acp-json .value=${f.payload}></acp-json>
      </div>
      ${rendered !== nothing
        ? html`
            <div class="pane">
              <div class="pane-label"><span class="pip ui"></span>Rendered</div>
              ${rendered}
            </div>
          `
        : nothing}
    `;
  }

  // Best-effort render of the captured frame through the same Conversation +
  // renderer path the live timeline uses. Only renderable `session/update`
  // notifications produce a preview; everything else is meaningful as JSON only.
  private renderFramePreview(f: CapturedFrame): TemplateResult | typeof nothing {
    if (f.channel !== 'update') return nothing;
    const update = f.payload as SessionUpdate | undefined;
    if (!update || typeof (update as { sessionUpdate?: string }).sessionUpdate !== 'string') {
      return nothing;
    }
    const conv = new Conversation();
    conv.apply(update);
    const ctx: TimelineRenderCtx = {
      agentId: this.session?.agentId || 'claude',
      agentName: this.session?.agentName || 'Agent',
      cacheScope: `frame:${f.id}`,
      permissionFor: () => undefined,
      terminalOutputFor: () => undefined,
      onPermissionChoice: () => {},
    };
    const items = conv.items.map((it) => renderItem(it, ctx));
    const plan = conv.plan.length > 0 ? renderPlan(conv.plan, false, () => {}) : nothing;
    const usage = renderUsage(conv.usage, conv.items, conv.cacheSignals());
    if (!items.length && plan === nothing && usage === nothing) return nothing;
    return html`${plan}${items}${usage}`;
  }

  private relativeTime(ts: number): string {
    const delta = Math.max(0, this.now - ts);
    if (delta < 1000) return 'just now';
    const s = Math.floor(delta / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agents-frames': AgentsFrames;
  }
}
