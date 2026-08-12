import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Conversation } from '../services/acp-conversation.js';
import {
  SHOWCASE,
  SAMPLE_PNG_BASE64,
  jsonSourceFor,
  type ShowcaseEntry,
} from '../services/acp-showcase.js';
import type { AvailableCommand } from '../services/acp-types.js';
import { getAuthStatus } from '../services/api.js';
import {
  renderItem,
  renderPlan,
  renderUsage,
  timelineStyles,
  type TimelineRenderCtx,
} from './agents-timeline-render.js';
import './acp-mapping-card.js';
import './acp-json.js';
import './agents-tool-call.js';
import './agents-elicitation.js';
import './agent-logo.js';

// The "Behind the Scenes" pane: an educational reference that exposes the Agent
// Client Protocol layer the Agents tab speaks to. It pairs curated protocol
// frames with the live UI they produce (folded through the *same* Conversation
// and renderer the live view uses). Read-only and stateless w.r.t. agents —
// agents-view stays mounted so subprocesses survive.

interface AuthSnapshot {
  loggedIn: boolean;
  user: string | null;
  gateway: string | null;
  expires: string | null;
}

interface OutlineEntry {
  id: string;
  label: string;
  children?: OutlineEntry[];
}

// The mapping section is the long one, so it breaks out into one sub-item per
// showcase card (derived from SHOWCASE so the two can't drift). The top-level
// sections stay flat.
const OUTLINE: OutlineEntry[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'auth', label: 'Authentication' },
  {
    id: 'mapping',
    label: 'Protocol → UI mapping',
    children: SHOWCASE.map((e) => ({ id: `card-${e.id}`, label: e.title })),
  },
];

// Flattened id list for the scrollspy observer: every section plus every card.
const OUTLINE_IDS: string[] = OUTLINE.flatMap((e) =>
  e.children ? [e.id, ...e.children.map((c) => c.id)] : [e.id],
);

@customElement('agents-behind-scenes')
export class AgentsBehindScenes extends LitElement {
  @state() private auth: AuthSnapshot | null = null;
  @state() private activeSection = 'overview';

  private scrollParent: HTMLElement | null = null;
  private spyLocked = false;
  private onScroll = () => { if (!this.spyLocked) this.updateActiveSection(); };

  connectedCallback() {
    super.connectedCallback();
    this.refreshAuth();
  }

  protected firstUpdated() {
    this.setupScrollspy();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.scrollParent?.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    this.scrollParent = null;
  }

  // Scroll-position spy. The old IntersectionObserver used a thin band near the
  // top of the viewport, which the short final section could never reach before
  // the page bottomed out — so it never activated. Instead we drive off scroll
  // and pick the last heading whose top has crossed a reference line, then snap
  // to the final entry once the container is scrolled to the bottom.
  private setupScrollspy() {
    this.scrollParent = this.findScrollParent();
    const target: EventTarget = this.scrollParent ?? window;
    target.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll, { passive: true });
    this.updateActiveSection();
  }

  private findScrollParent(): HTMLElement | null {
    let node: Node | null = this;
    while (node) {
      let parent: Node | null;
      if ((node as HTMLElement).assignedSlot) parent = (node as HTMLElement).assignedSlot;
      else if (node.parentNode instanceof ShadowRoot) parent = node.parentNode.host;
      else parent = node.parentNode;
      if (parent instanceof HTMLElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|overlay)/.test(style.overflowY)) return parent;
      }
      node = parent;
    }
    return null;
  }

  private updateActiveSection() {
    const root = this.shadowRoot;
    if (!root) return;
    const container = this.scrollParent;
    const viewTop = container ? container.getBoundingClientRect().top : 0;
    // Reference line sits a little below the top of the scroll viewport.
    const line = viewTop + 120;

    // If we've hit the bottom, the last entry wins — its heading may never reach
    // the reference line on a short trailing section.
    const atBottom = container
      ? container.scrollTop + container.clientHeight >= container.scrollHeight - 2
      : window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    if (atBottom) {
      this.activeSection = OUTLINE_IDS[OUTLINE_IDS.length - 1];
      return;
    }

    let current = OUTLINE_IDS[0];
    for (const id of OUTLINE_IDS) {
      const el = root.getElementById(id);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= line) current = id;
      else break;
    }
    this.activeSection = current;
  }

  private jumpToSection(id: string) {
    const el = this.shadowRoot?.getElementById(id);
    if (!el) return;
    this.activeSection = id;
    this.spyLocked = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { this.spyLocked = false; }, 600);
  }

  private async refreshAuth() {
    try {
      this.auth = await getAuthStatus();
    } catch {
      this.auth = null;
    }
  }

  static styles = [
    timelineStyles,
    css`
      :host {
        display: block;
        color: var(--white);
      }
      /* Two columns: a sticky left outline rail + the scrolling content. Centered
         as a unit so the content keeps its comfortable reading measure. */
      .layout {
        max-width: 1220px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr);
        gap: 20px;
        padding: 0 24px;
      }
      .wrap {
        min-width: 0;
        max-width: 980px;
        padding: 28px 0 80px;
        display: flex;
        flex-direction: column;
        gap: 36px;
      }
      /* Anchor targets clear the top a little when jumped to. */
      [id] { scroll-margin-top: 20px; }

      /* ── Outline rail ── */
      .outline {
        position: sticky;
        top: 0;
        align-self: start;
        max-height: 100vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 28px 0 40px;
      }
      .outline-sub {
        display: flex;
        flex-direction: column;
        gap: 1px;
        margin: 2px 0 6px;
      }
      .outline-link {
        text-align: left;
        padding: 5px 10px;
        border: none;
        border-left: 2px solid transparent;
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        background: transparent;
        color: var(--gray);
        font-size: var(--font-size-sm);
        font-weight: 600;
        font-family: var(--font);
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast);
      }
      .outline-link.child {
        padding-left: 20px;
        font-size: var(--font-size-xs);
        font-weight: 500;
        color: var(--neutral-gray);
      }
      .outline-link:hover { color: var(--bright-white); background: var(--w5); }
      .outline-link.active {
        color: var(--bright-white);
        background: var(--accent-a10);
        border-left-color: var(--accent);
      }
      .outline-link.child.active { color: var(--bright-white); }

      /* On narrow panes the rail would crowd the content — drop it and let the
         content span full width. */
      @media (max-width: 860px) {
        .layout { grid-template-columns: minmax(0, 1fr); padding: 0 20px; }
        .outline { display: none; }
        .wrap { padding-top: 28px; }
      }
      .section-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: var(--font-size-md);
        font-weight: 650;
        color: var(--bright-white);
        text-transform: uppercase;
        letter-spacing: 0.8px;
      }
      .section-title .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent);
      }
      .section-lead {
        margin: 4px 0 14px;
        font-size: var(--font-size-md);
        line-height: 1.6;
        color: var(--gray);
        max-width: 760px;
      }

      /* ── Hero ── */
      .hero {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .hero h1 {
        margin: 0;
        font-size: var(--font-size-2xl);
        font-weight: 600;
        color: var(--bright-white);
        letter-spacing: -0.02em;
      }
      .hero .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: var(--purple-light);
        font-family: var(--font-mono);
      }
      .hero p {
        margin: 0;
        font-size: var(--font-size-md);
        line-height: 1.65;
        color: var(--gray);
        max-width: 720px;
      }
      .hero p code {
        font-family: var(--font-mono);
        font-size: 0.95em;
        background: var(--w8);
        padding: 1px 6px;
        border-radius: 4px;
        color: var(--purple-light);
      }

      /* ── Pipeline diagram ── */
      .pipeline {
        display: flex;
        align-items: stretch;
        gap: 0;
        flex-wrap: wrap;
        padding: 16px;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-lg);
        background: var(--w3);
      }
      .stage {
        flex: 1 1 0;
        min-width: 130px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        position: relative;
      }
      .stage + .stage::before {
        content: '';
        position: absolute;
        left: -7px;
        top: 50%;
        width: 14px;
        height: 1px;
        background: var(--accent-a35);
      }
      .stage + .stage::after {
        content: '';
        position: absolute;
        left: 4px;
        top: calc(50% - 4px);
        width: 0;
        height: 0;
        border-left: 5px solid var(--accent-a35);
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
      }
      .stage-label {
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--purple-light);
        font-family: var(--font-mono);
      }
      .stage-title {
        font-size: var(--font-size-base);
        font-weight: 600;
        color: var(--bright-white);
      }
      .stage-sub {
        font-size: var(--font-size-xs);
        color: var(--neutral-gray);
        line-height: 1.45;
      }

      /* ── Auth section ── */
      .auth {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
        gap: 14px;
      }
      @media (max-width: 760px) {
        .auth { grid-template-columns: 1fr; }
      }
      .auth-bullets {
        display: flex;
        flex-direction: column;
        gap: 9px;
        padding: 14px 16px;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-lg);
        background: var(--w3);
      }
      .auth-bullet {
        display: flex;
        gap: 9px;
        font-size: var(--font-size-base);
        color: var(--white);
        line-height: 1.55;
      }
      .auth-bullet .ic {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--accent-a18);
        color: var(--purple-light);
        font-size: var(--font-size-xs);
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 2px;
      }
      .auth-status {
        padding: 14px 16px;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-lg);
        background: var(--w3);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .auth-status-head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--neutral-gray);
      }
      .auth-status-head .pip {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--neutral-gray);
        box-shadow: 0 0 0 0 transparent;
      }
      .auth-status-head .pip.live {
        background: var(--emerald);
        box-shadow: 0 0 6px var(--emerald);
      }
      .auth-row {
        display: flex;
        gap: 8px;
        font-size: var(--font-size-sm);
      }
      .auth-key {
        color: var(--neutral-gray);
        font-family: var(--font-mono);
        min-width: 78px;
      }
      .auth-val {
        color: var(--bright-white);
        font-family: var(--font-mono);
        word-break: break-all;
      }
      .auth-val.muted { color: var(--gray); font-style: italic; }

      /* ── Mapping cards ── */
      .cards {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .legend-note {
        font-size: var(--font-size-sm);
        color: var(--neutral-gray);
        font-style: italic;
        max-width: 720px;
      }
    `,
  ];

  render() {
    return html`
      <div class="layout">
        ${this.renderOutline()}
        <div class="wrap">
          ${this.renderHero()}
          ${this.renderAuth()}
          ${this.renderProtocolCards()}
        </div>
      </div>
    `;
  }

  private renderOutline() {
    return html`
      <nav class="outline" aria-label="Page outline">
        ${OUTLINE.map((e) => this.renderOutlineEntry(e))}
      </nav>
    `;
  }

  private renderOutlineEntry(e: OutlineEntry): TemplateResult {
    return html`
      <button
        class="outline-link ${this.activeSection === e.id ? 'active' : ''}"
        @click=${() => this.jumpToSection(e.id)}
      >${e.label}</button>
      ${e.children
        ? html`<div class="outline-sub">
            ${e.children.map(
              (c) => html`
                <button
                  class="outline-link child ${this.activeSection === c.id ? 'active' : ''}"
                  @click=${() => this.jumpToSection(c.id)}
                >${c.label}</button>
              `,
            )}
          </div>`
        : nothing}
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Hero + pipeline diagram

  private renderHero() {
    return html`
      <section class="hero" id="overview">
        <span class="eyebrow"><span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent)"></span>Behind the scenes</span>
        <h1>How the Agents tab actually talks to Claude</h1>
        <p>
          Every assistant bubble, tool card, plan, and approval prompt in this tab is the rendered output
          of a single protocol — the <strong>Agent Client Protocol</strong> — spoken as JSON-RPC 2.0 over
          newline-delimited stdio. Kairos launches the agent with <code>kairos launch</code>, injects
          provider credentials from your configured auth method, and the browser never holds
          an API key. This page shows you each protocol message side-by-side with the real component it
          produces.
        </p>
        <div class="pipeline" role="img" aria-label="Pipeline: UI to ACP to kairos launch to Auth Proxy to LLM Provider">
          <div class="stage">
            <div class="stage-label">Browser</div>
            <div class="stage-title">Kairos</div>
            <div class="stage-sub">Lit components + WebSocket to the Rust backend.</div>
          </div>
          <div class="stage">
            <div class="stage-label">Transport</div>
            <div class="stage-title">ACP / JSON-RPC</div>
            <div class="stage-sub">Newline-delimited frames over stdio.</div>
          </div>
          <div class="stage">
            <div class="stage-label">Subprocess</div>
            <div class="stage-title">kairos launch</div>
            <div class="stage-sub">Spawns the ACP adapter for the chosen agent.</div>
          </div>
          <div class="stage">
            <div class="stage-label">Auth</div>
            <div class="stage-title">Auth Proxy</div>
            <div class="stage-sub">Optional proxy; injects model creds.</div>
          </div>
          <div class="stage">
            <div class="stage-label">Model</div>
            <div class="stage-title">LLM Provider</div>
            <div class="stage-sub">Anthropic, OpenAI, Google, or local (Ollama).</div>
          </div>
        </div>
      </section>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Authentication

  private renderAuth() {
    const a = this.auth;
    return html`
      <section id="auth">
        <div class="section-title"><span class="dot"></span>Authentication</div>
        <p class="section-lead">
          The UI never sees an API key. Authentication happens once — either through a configured
          auth proxy or by providing your own API key — and credentials are injected at the model boundary.
        </p>
        <div class="auth">
          <div class="auth-bullets">
            <div class="auth-bullet"><span class="ic">1</span><span>You configure authentication once — either an API key or a proxy URL. Tokens are stored in your OS keychain.</span></div>
            <div class="auth-bullet"><span class="ic">2</span><span>When you open an agent, the backend spawns <code>kairos launch</code> — that subprocess inherits the configured credentials.</span></div>
            <div class="auth-bullet"><span class="ic">3</span><span>Every request to the model is authenticated using your chosen method (direct API key or auth proxy).</span></div>
            <div class="auth-bullet"><span class="ic">4</span><span>The ACP handshake's <code>authMethods</code> array is empty — there is nothing for this UI to authenticate, because credentials are injected at launch.</span></div>
          </div>
          <div class="auth-status">
            <div class="auth-status-head">
              <span class="pip ${a?.loggedIn ? 'live' : ''}"></span>
              <span>Your auth session</span>
            </div>
            <div class="auth-row"><span class="auth-key">status</span><span class="auth-val">${a == null ? html`<span class="muted">checking…</span>` : a.loggedIn ? 'authenticated' : html`<span class="muted">signed out</span>`}</span></div>
            <div class="auth-row"><span class="auth-key">user</span><span class="auth-val">${a?.user ?? html`<span class="muted">—</span>`}</span></div>
            <div class="auth-row"><span class="auth-key">gateway</span><span class="auth-val">${a?.gateway ?? html`<span class="muted">—</span>`}</span></div>
            <div class="auth-row"><span class="auth-key">expires</span><span class="auth-val">${a?.expires ?? html`<span class="muted">—</span>`}</span></div>
          </div>
        </div>
      </section>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Curated protocol → UI cards

  private renderProtocolCards() {
    return html`
      <section id="mapping">
        <div class="section-title"><span class="dot"></span>Protocol → UI mapping</div>
        <p class="section-lead">
          Each card pairs a real ACP message with the same component the live view would render for it.
          The right column is fed by folding the protocol bodies through the actual
          <code style="font-family:var(--font-mono);color:var(--purple-light)">Conversation</code> class —
          so what you see here cannot drift from the live tab.
        </p>
        <p class="legend-note">
          Tip: hover any key or value on the left to highlight the part of the UI it drives, and vice-versa.
        </p>
        <div class="cards">
          ${SHOWCASE.map((entry) => this.renderShowcaseCard(entry))}
        </div>
      </section>
    `;
  }

  private renderShowcaseCard(entry: ShowcaseEntry) {
    // The card's left column pretty-prints the SAME data the right column folds,
    // so the two can never drift: the JSON-RPC envelope for request/response
    // entries, otherwise the exact `session/update` notifications the browser
    // receives. A multi-frame entry (e.g. tool_call → tool_call_update with the
    // diff) shows every frame, since seeing all of them is the teaching point.
    const json = jsonSourceFor(entry);
    const rendered = this.renderShowcasePreview(entry);
    return html`
      <acp-mapping-card
        id=${`card-${entry.id}`}
        .title=${entry.title}
        .subtitle=${entry.subtitle}
        .blurb=${entry.blurb}
        .json=${json}
        .rendered=${rendered}
        .mappings=${entry.mappings ?? []}
      ></acp-mapping-card>
    `;
  }

  // Build the rendered preview for a showcase entry by funneling its data
  // through the SAME render path the live view uses. The point is to prove
  // there is no separate mock pipeline — these are the real components.
  private renderShowcasePreview(entry: ShowcaseEntry): TemplateResult | typeof nothing {
    const ctx: TimelineRenderCtx = {
      agentId: 'claude',
      agentName: 'Claude',
      cacheScope: `showcase:${entry.id}`,
      permissionFor: () => undefined,
      terminalOutputFor: () => undefined,
      onPermissionChoice: () => {
        // Showcase is read-only — we swallow the choice so the demo card
        // doesn't try to send a permission outcome over the wire.
      },
    };

    if (entry.render === 'timeline') {
      const conv = new Conversation();
      // The prompt entry shows a user turn (text + image attachment).
      // Mirror agents-view's pushUserMessage so the bubble looks identical.
      if (entry.id === 'prompt') {
        conv.pushUserMessage('Why is this chart rendering blank?', [
          { type: 'image', mimeType: 'image/png', data: SAMPLE_PNG_BASE64 },
        ]);
      }
      for (const u of entry.updates ?? []) conv.apply(u);
      (entry.turnUsage ?? []).forEach((t, i) => conv.addTurnUsage(t, i * 30_000));
      const items = conv.items.map((it) => renderItem(it, ctx));
      const plan = conv.plan.length > 0 ? renderPlan(conv.plan, false, () => {}) : nothing;
      const usage = renderUsage(conv.usage, conv.items, conv.cacheSignals());
      return html`${plan}${items}${usage}`;
    }

    if (entry.render === 'tool') {
      const conv = new Conversation();
      for (const u of entry.updates ?? []) conv.apply(u);
      const tool = conv.items.find((it) => it.kind === 'tool');
      if (!tool || tool.kind !== 'tool') return nothing;
      // Force the card open so the diff shows; the live card auto-opens on a
      // diff too, but here we don't depend on that heuristic.
      return html`<div class="tool-wrap">
        <agents-tool-call .tool=${tool.tool} .startExpanded=${true}></agents-tool-call>
      </div>`;
    }

    if (entry.render === 'terminal') {
      const conv = new Conversation();
      for (const u of entry.updates ?? []) conv.apply(u);
      const tool = conv.items.find((it) => it.kind === 'tool');
      if (!tool || tool.kind !== 'tool') return nothing;
      // Feed the embedded terminal a snippet of canned output so the card reads
      // as a live run rather than an empty "(waiting…)" shell.
      const sampleOutput =
        '$ npm test\n\n✓ parser.test.ts (12)\n✓ acp-showcase.test.ts (8)\n\nTest Files  2 passed (2)\n     Tests  20 passed (20)';
      return html`<div class="tool-wrap">
        <agents-tool-call .tool=${tool.tool} .startExpanded=${true}
          .terminalOutput=${sampleOutput}></agents-tool-call>
      </div>`;
    }

    if (entry.render === 'commands') {
      const conv = new Conversation();
      for (const u of entry.updates ?? []) conv.apply(u);
      return this.renderCommandsPreview(conv.commands);
    }

    if (entry.render === 'clientcall') {
      return this.renderClientCallPreview(entry);
    }

    if (entry.render === 'permission' && entry.permission) {
      const p = entry.permission;
      return html`
        <div class="tool-wrap">
          <agents-tool-call
            .tool=${p.toolCall}
            .permission=${{ requestId: p.requestId, options: p.options }}
          ></agents-tool-call>
        </div>
      `;
    }

    if (entry.render === 'elicitation' && entry.elicitation) {
      return html`<agents-elicitation .request=${entry.elicitation}></agents-elicitation>`;
    }

    if (entry.render === 'capabilities') {
      // The mapping card's legend handles the rendering for this entry —
      // returning `nothing` makes the preview column show only that legend.
      return nothing;
    }

    if (entry.render === 'config') {
      return this.renderConfigPreview(entry);
    }

    return nothing;
  }

  // Faithful but inert reproduction of the composer's config controls. Uses
  // the same .config-trigger styling token as agents-view so visually it
  // matches; clicks are no-ops because the showcase is read-only.
  private renderConfigPreview(entry: ShowcaseEntry) {
    const env = entry.envelope?.response as
      | { result?: { configOptions?: Array<{
            id: string;
            name: string;
            type: string;
            currentValue: string;
            options: Array<{ value: string; name: string }>;
          }> } }
      | undefined;
    const opts = env?.result?.configOptions ?? [];
    return html`
      <div class="config-faux">
        ${opts.map(
          (opt, i) => html`
            <div
              class="config-row map-target"
              data-path=${`response.result.configOptions.${i}`}
            >
              <span class="config-row-label">${opt.name}</span>
              <button class="config-trigger" type="button" tabindex="-1">
                <span>${opt.options.find((o) => o.value === opt.currentValue)?.name ?? opt.currentValue}</span>
                <svg class="caret" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          `,
        )}
      </div>
    `;
  }

  // The composer's "/" menu, fed by available_commands_update. Mirrors the
  // slash-menu markup in agents-view so the rendered side reads as the real
  // dropdown; inert here.
  private renderCommandsPreview(commands: AvailableCommand[]) {
    if (!commands.length) return nothing;
    return html`
      <div class="slash-faux">
        ${commands.map(
          (c) => html`
            <div class="slash-row">
              <span class="slash-name">/${c.name}</span>
              ${c.description ? html`<span class="slash-desc">${c.description}</span>` : nothing}
            </div>
          `,
        )}
      </div>
    `;
  }

  // Agent→client requests (fs/*, session/load, session/cancel) have no timeline
  // UI — the point is that this UI is itself the ACP server answering them. Show
  // how each is serviced instead of a fake bubble.
  private renderClientCallPreview(entry: ShowcaseEntry) {
    const points = entry.handledBy ?? [];
    return html`
      <div class="clientcall">
        <div class="clientcall-head">
          <span class="clientcall-pip"></span>
          Answered by Kairos
        </div>
        <ul class="clientcall-list">
          ${points.map((p) => html`<li>${p}</li>`)}
        </ul>
      </div>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'agents-behind-scenes': AgentsBehindScenes;
  }
}
