// Full-page-ish help overlay opened from the header "?" button. A large centered
// modal with a fully illustrated layout: a hero banner, the fastest-path steps, a
// grid of per-tab cards, a grid of power-user tip cards (each with its own inline
// SVG illustration), and a "getting help" callout. Every section is hand-built
// here — no markdown prose — so the whole page reads as one polished unit.

import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';
import './guide-reader.js';
import {
  heroArt,
  agentsArt,
  pluginsArt,
  customizeArt,
  sessionsArt,
  vscodeArt,
  settingsArt,
  worktreeArt,
  checkpointArt,
  reviewArt,
  inspectorArt,
  modesArt,
  mcpArt,
  authArt,
  resumeArt,
  helpArt,
} from './help-illustrations.js';

import { KAIROS_REPO_URL } from '../services/feedback-report.js';

const FEEDBACK_URL = `${KAIROS_REPO_URL}/issues`;

interface TabCard {
  art: TemplateResult;
  name: string;
  blurb: string | TemplateResult;
  // Deep-links the card into the full guide reader. `docId` picks the doc;
  // `hash` optionally scrolls to a section within it. A card without a docId is
  // display-only.
  docId?: string;
  hash?: string;
}

const TAB_CARDS: TabCard[] = [
  {
    art: agentsArt,
    name: 'Agents',
    docId: 'agents',
    blurb:
      'The headline. A full agentic coding cockpit — streaming chat, reasoning, task plans, tool calls, and file edits, all inline. Run several agents at once from the left rail.',
  },
  {
    art: pluginsArt,
    name: 'Plugins & Skills',
    docId: 'plugins-and-skills',
    blurb:
      'A searchable catalog of everything installable: marketplace items, public MATLAB/Simulink toolkits, and installs straight from a Git repo. Install, update, or pin with a click.',
  },
  {
    art: customizeArt,
    name: 'Customize',
    docId: 'customize',
    blurb:
      'A GUI over your agent config: rules, reusable prompt snippets, roles, MCP servers, and hooks — global or per-project, no hand-editing required.',
  },
  {
    art: sessionsArt,
    name: 'History',
    docId: 'history',
    blurb:
      'Browse every Claude, Codex, and Gemini session across your projects. Filter by tool, age, or text; resume, export to HTML/Markdown, or jump back to a workspace.',
  },
  {
    art: vscodeArt,
    name: 'VSCode',
    docId: 'vscode',
    blurb:
      'Discover .code-workspace files and project directories across your machine, pin/rename/hide them, and launch VSCode with devai tools on your PATH.',
  },
  {
    art: settingsArt,
    name: 'kairos settings',
    docId: 'kairos-settings',
    blurb:
      'Config keys with layered explain traces, feature flags, update management, vault & security ops, and the Doctor diagnostics panel.',
  },
];

const TIP_CARDS: TabCard[] = [
  {
    art: worktreeArt,
    name: 'Isolated git worktrees',
    blurb: html`One checkbox runs the agent on its own branch and checkout, so it
      can never touch your working tree. You're prompted about dirty or unmerged
      work on cleanup.`,
  },
  {
    art: checkpointArt,
    name: 'Prompt rewind',
    docId: 'agents',
    hash: 'safety-worktrees--prompt-rewind',
    blurb: html`The working tree is auto-snapshotted before every turn (as dangling
      git commits — your index, HEAD, and branch are never touched). Use a past
      prompt's Edit or Fork action to rewind files to that point with the conversation.`,
  },
  {
    art: reviewArt,
    name: 'Review panel',
    docId: 'agents',
    hash: 'the-side-panels-right-rail',
    blurb: html`Folds every change the agent made into one per-file diff view
      (unified or split). Use the Summary panel for an agent-written recap.`,
  },
  {
    art: inspectorArt,
    name: 'Behind the Scenes',
    docId: 'agents',
    hash: 'the-side-panels-right-rail',
    blurb: html`A static ACP reference with a pipeline diagram, gateway auth
      status, and curated JSON-RPC frames paired with the UI they render. Use the
      Frames panel for live traffic.`,
  },
  {
    art: modesArt,
    name: 'Modes, models & effort',
    docId: 'agents',
    hash: 'session-controls',
    blurb: html`Switch session mode (Default / Accept Edits / Plan / Don't Ask),
      model, and reasoning effort on the fly from the composer footer — your last
      choices are remembered per agent.`,
  },
  {
    art: mcpArt,
    name: 'MCP quick-add presets',
    docId: 'customize',
    hash: 'mcp-servers',
    blurb: html`In Customize › MCP Servers, one-click install for common servers
      (first up: the MATLAB MCP Core Server). Configured once, they're injected
      into every new session.`,
  },
  {
    art: authArt,
    name: 'Per-agent auth mode',
    docId: 'agents',
    hash: 'auth-claude--codex--gemini-only',
    blurb: html`Keep the default gateway credentials, or switch Claude / Codex /
      Gemini to your own API key from the picker. Keys are stored server-side and
      masked, never echoed back to the browser.`,
  },
  {
    art: resumeArt,
    name: 'Resume anywhere',
    docId: 'agents',
    hash: 'reopening--renaming-sessions',
    blurb: html`The <strong>Recent</strong> rail replays a prior session's history
      inline via ACP, falling back to a terminal resume when an agent can't replay.`,
  },
];

interface Shortcut {
  keys: string[];
  label: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['?'], label: 'Open this help drawer' },
  { keys: ['Enter'], label: 'Send message · while the agent runs, queue or steer' },
  { keys: ['Shift', 'Enter'], label: 'New line in the composer' },
  { keys: ['↵'], label: 'Approve a pending permission prompt (button auto-focused)' },
  { keys: ['Esc'], label: 'Reject a permission prompt · close menus & this drawer' },
  { keys: ['/'], label: 'Open slash commands & saved prompts' },
  { keys: ['@'], label: 'Mention a file from the working directory' },
  { keys: ['↑', '↓'], label: 'Navigate the slash / model menus' },
];

const STEPS = [
  html`Open the <strong>Agents</strong> tab — it's the default landing view.`,
  html`Click <strong>Start session</strong>, pick Claude / Codex / Gemini for normal
    work, and choose a working directory.`,
  html`Type what you want done and hit send. Credentials are injected
    via <code>kairos launch</code> from your configured auth method.`,
];

@customElement('kairos-help-drawer')
export class DevaiHelpDrawer extends LitElement {
  @property({ type: Boolean }) open = false;
  // When set, opening the drawer jumps straight into the Full guide on this doc
  // (e.g. the header "Why" button opens on `why-kairos`). When null/empty, the
  // drawer opens on the Tour — so the Help "?" button always lands on the Tour
  // regardless of where a prior open left the reader.
  @property({ type: String }) startDoc: string | null = null;

  // Two ways to consume the help: the illustrated, click-to-explore "Tour"
  // (quick reference / discovery) and the "Full guide" reader (the docs/ set
  // rendered like a textbook — deep dive / understanding).
  @state() private mode: 'tour' | 'guide' = 'tour';
  // Which guide doc the reader shows, and a section to scroll to on open.
  @state() private guideDocId = 'getting-started';
  @state() private guideHash: string | null = null;

  static styles = css`
    :host { display: contents; }
    .backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 100;
      animation: fade-in 0.15s ease-out;
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .modal {
      width: min(1080px, 94vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: var(--surface-modal);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      animation: pop-in 0.16s ease-out;
    }
    @keyframes pop-in {
      from { transform: scale(0.98); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 24px;
      border-bottom: 1px solid var(--glass-border);
      flex-shrink: 0;
    }
    .head h2 {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
    }
    .head .head-spacer { flex: 1; }
    /* Tour / Full guide segmented toggle in the header. */
    .mode-toggle {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w4);
    }
    .mode-toggle button {
      border: none;
      background: none;
      border-radius: var(--radius-sm);
      padding: 5px 14px;
      font-size: var(--font-size-sm);
      font-weight: 550;
      color: var(--gray);
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .mode-toggle button:hover { color: var(--white); }
    .mode-toggle button[aria-pressed='true'] {
      background: var(--accent-a15);
      color: var(--bright-white);
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
      padding: 28px 32px 36px;
      color: var(--gray);
      line-height: 1.55;
    }
    /* theme.css scrollbar rules don't pierce the shadow root, so redeclare here
       to avoid the overlay scrollbar covering content. */
    .scroll::-webkit-scrollbar { width: 10px; }
    .scroll::-webkit-scrollbar-thumb {
      background: var(--w10);
      border-radius: 5px;
    }
    /* Full-guide mode: hand the whole body to the reader (its own two panes
       scroll internally), so drop the tour's padding and overflow. Grid (not
       flex) with a minmax(0,1fr) row gives the reader a *definite* bounded
       height — a percentage height can't resolve against a flex-grown parent, so
       the reader would otherwise balloon to its content height and its inner
       panes would never gain their own scrollbars. */
    .guide-body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
      overflow: hidden;
    }
    kairos-guide-reader { min-height: 0; }

    /* Hero */
    .hero {
      display: grid;
      grid-template-columns: 1fr minmax(240px, 320px);
      gap: 28px;
      align-items: center;
      margin-bottom: 8px;
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: var(--font-size-2xl);
      font-weight: 650;
      color: var(--bright-white);
      line-height: 1.2;
    }
    .hero p { margin: 0; font-size: var(--font-size-md); }
    .hero .hint {
      margin-top: 12px;
      font-size: var(--font-size-sm);
      color: var(--neutral-gray);
    }
    .hero .hint kbd {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      background: var(--w8);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      padding: 1px 5px;
    }
    .hero .hint .hero-link {
      border: none;
      background: none;
      padding: 0;
      font: inherit;
      color: var(--accent);
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .hero .hint .hero-link:hover { filter: brightness(1.15); }
    .hero-art { color: var(--accent); }
    .hero-art svg { width: 100%; height: auto; display: block; }

    /* Section headings */
    .section-title {
      margin: 32px 0 14px;
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--bright-white);
    }

    /* Fastest-path steps */
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      counter-reset: step;
    }
    .steps li {
      counter-increment: step;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .steps li::before {
      content: counter(step);
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--accent-a15);
      color: var(--accent);
      font-size: var(--font-size-sm);
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .steps strong { color: var(--white); font-weight: 600; }
    .steps code {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      background: var(--w10);
      padding: 1.5px 5px;
      border-radius: 5px;
    }

    /* Keyboard shortcuts */
    .shortcuts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 8px 24px;
    }
    .shortcut {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 5px 0;
    }
    .shortcut-keys {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 96px;
    }
    .shortcut-keys .plus { color: var(--neutral-gray); font-size: var(--font-size-xs); }
    .shortcut-keys kbd {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--white);
      background: var(--w8);
      border: 1px solid var(--glass-border);
      border-bottom-width: 2px;
      border-radius: var(--radius-sm);
      padding: 2px 6px;
      min-width: 12px;
      text-align: center;
    }
    .shortcut-label { font-size: var(--font-size-base); color: var(--gray); }

    /* Tab cards */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--w4);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: border-color 0.15s, background 0.15s, transform 0.15s;
    }
    .card:hover { border-color: var(--border-strong); background: var(--w5); }
    /* Clickable tour cards (they deep-link into the full guide). */
    button.card {
      text-align: left;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button.card:hover { transform: translateY(-2px); border-color: var(--accent-a35); }
    button.card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .card .read-more {
      margin-top: auto;
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      opacity: 0;
      transform: translateX(-4px);
      transition: opacity 0.15s, transform 0.15s;
    }
    button.card:hover .read-more,
    button.card:focus-visible .read-more { opacity: 1; transform: translateX(0); }
    .card .read-more svg { display: block; }
    .card-art {
      color: var(--accent);
      background: var(--bg-subtle);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
    }
    .card-art svg { width: 100%; height: auto; max-height: 72px; display: block; }
    .card h3 {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
    }
    .card p { margin: 0; font-size: var(--font-size-base); }
    .card strong { color: var(--white); font-weight: 600; }

    /* Getting-help callout: a full-width card with side-by-side art + prose. */
    .callout {
      display: grid;
      grid-template-columns: 132px 1fr;
      gap: 20px;
      align-items: center;
      background: var(--w4);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 18px 20px;
    }
    .callout-art {
      color: var(--accent);
      background: var(--bg-subtle);
      border-radius: var(--radius-sm);
      padding: 10px;
    }
    .callout-art svg { width: 100%; height: auto; max-height: 76px; display: block; }
    .callout p { margin: 0; font-size: var(--font-size-base); }
    .callout strong { color: var(--white); font-weight: 600; }
    .callout .cta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      background: var(--accent);
      color: #fff;
      font-size: var(--font-size-sm);
      font-weight: 600;
      text-decoration: none;
      transition: filter 0.15s;
    }
    .callout .cta:hover { filter: brightness(1.08); }
    .callout .cta svg { display: block; }
    @media (max-width: 620px) {
      .callout { grid-template-columns: 1fr; }
    }
  `;

  // On each open, decide where to land: a `startDoc` opens the Full guide on
  // that doc; otherwise the Tour. Keyed to the open transition so re-opening
  // always honors the caller's intent rather than the last-viewed state.
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      if (this.startDoc) {
        this.guideDocId = this.startDoc;
        this.guideHash = null;
        this.mode = 'guide';
      } else {
        this.mode = 'tour';
      }
    }
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (this.open && e.key === 'Escape') this.close();
  };

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this.close();
  }

  // Open the full-guide reader on a specific doc (and optional section). Used by
  // the clickable tour cards and the "Read the full guide" CTA.
  private openGuide(docId = 'getting-started', hash: string | null = null) {
    this.guideDocId = docId;
    this.guideHash = hash;
    this.mode = 'guide';
  }

  private renderCard = (c: TabCard) => {
    // A card with a docId is a button that opens the full guide; otherwise it's
    // a plain display card.
    if (c.docId) {
      const docId = c.docId;
      const hash = c.hash ?? null;
      return html`
        <button class="card" @click=${() => this.openGuide(docId, hash)}>
          <div class="card-art">${c.art}</div>
          <h3>${c.name}</h3>
          <p>${c.blurb}</p>
          <span class="read-more">Read the guide
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </span>
        </button>
      `;
    }
    return html`
      <div class="card">
        <div class="card-art">${c.art}</div>
        <h3>${c.name}</h3>
        <p>${c.blurb}</p>
      </div>
    `;
  };

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        <div class="modal" role="dialog" aria-modal="true" aria-label="Help and guide">
          <div class="head">
            <h2>Help &amp; guide</h2>
            <div class="head-spacer"></div>
            <div class="mode-toggle" role="tablist" aria-label="Help view">
              <button
                role="tab"
                aria-pressed=${this.mode === 'tour'}
                @click=${() => { this.mode = 'tour'; }}
              >Tour</button>
              <button
                role="tab"
                aria-pressed=${this.mode === 'guide'}
                @click=${() => { this.mode = 'guide'; }}
              >Full guide</button>
            </div>
            <button class="close" ${tooltip('Close')} @click=${() => this.close()} aria-label="Close">${icon.close(18)}</button>
          </div>
          ${this.mode === 'guide' ? this.renderGuide() : this.renderTour()}
        </div>
      </div>
    `;
  }

  private renderGuide() {
    return html`
      <div class="guide-body">
        <kairos-guide-reader
          .docId=${this.guideDocId}
          .pendingHash=${this.guideHash}
          @doc-change=${(e: CustomEvent<{ id: string }>) => { this.guideDocId = e.detail.id; }}
        ></kairos-guide-reader>
      </div>
    `;
  }

  private renderTour() {
    return html`
          <div class="scroll">
            <div class="hero">
              <div>
                <h1>Welcome to Kairos</h1>
                <p>
                  A desktop home for <strong>agentic coding</strong>. At its heart is a full
                  <a href="https://agentclientprotocol.com" target="_blank" rel="noreferrer">ACP</a>
                  client — talk to Claude, Gemini, Codex, and other coding agents right here; watch
                  them think, edit files, and run commands live, while you keep every change on a
                  leash. Wrapped around that is a point-and-click interface for everything else the
                  <code>devai</code> CLI can do.
                </p>
                <p class="hint">
                  Click any card below to open the matching chapter — or
                  <button type="button" class="hero-link" @click=${() => this.openGuide('getting-started')}>read the full guide</button>.
                </p>
                <p class="hint">Press <kbd>?</kbd> anywhere to reopen this · close with <kbd>Esc</kbd> or by clicking outside.</p>
              </div>
              <div class="hero-art">${heroArt}</div>
            </div>

            <div class="section-title">The fastest path to value</div>
            <ol class="steps">
              ${STEPS.map((s) => html`<li><span>${s}</span></li>`)}
            </ol>

            <div class="section-title">Keyboard shortcuts</div>
            <div class="shortcuts">
              ${SHORTCUTS.map((sc) => html`
                <div class="shortcut">
                  <span class="shortcut-keys">
                    ${sc.keys.map((k, i) => html`${i > 0 ? html`<span class="plus">+</span>` : nothing}<kbd>${k}</kbd>`)}
                  </span>
                  <span class="shortcut-label">${sc.label}</span>
                </div>
              `)}
            </div>

            <div class="section-title">A tour of the tabs</div>
            <div class="cards">${TAB_CARDS.map(this.renderCard)}</div>

            <div class="section-title">Power-user tips</div>
            <div class="cards">${TIP_CARDS.map(this.renderCard)}</div>

            <div class="section-title">Getting help</div>
            <div class="callout">
              <div class="callout-art">${helpArt}</div>
              <div>
                <p>
                  Spotted a bug or have an idea? Open an issue on the repo — or, in
                  the spirit of this project, just <strong>fix it and commit</strong>.
                </p>
                <a class="cta" href=${FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
                  Send feedback
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>
                </a>
              </div>
            </div>
          </div>
    `;
  }
}
