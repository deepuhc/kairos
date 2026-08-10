import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './acp-json.js';
import { pathsRelated } from './acp-json.js';
import { timelineStyles } from './agents-timeline-render.js';

// One "JSON → UI" card in the Behind the Scenes view: raw protocol on the left,
// the real component it produces on the right. Hovering a JSON field highlights
// the UI region it drives and vice-versa, via a shared `hoveredPath`.
//
// Presentational only — the parent owns the JSON value and builds the `rendered`
// template (by folding frames through the real Conversation + shared renderer),
// so this card stays a dumb, reusable frame.
@customElement('acp-mapping-card')
export class AcpMappingCard extends LitElement {
  @property({ type: String }) title = '';
  @property({ type: String }) subtitle = '';
  @property({ type: String }) blurb = '';
  @property({ attribute: false }) json: unknown;
  @property({ attribute: false }) rendered: TemplateResult | typeof nothing = nothing;
  // Optional "field → UI feature" legend (used by the initialize card).
  @property({ attribute: false }) mappings: Array<{ path: string; label: string }> = [];
  // Hover state is owned here but mirrored to the parent so sibling regions and
  // the JSON column stay in sync.
  @state() private hoveredPath: string | null = null;

  // The preview column renders REAL component markup (timeline messages, tool
  // cards, plans, the config controls) inside this card's shadow root via
  // `${this.rendered}`. Shadow DOM CSS doesn't cross element boundaries, so the
  // card must itself carry every style that markup needs — `timelineStyles` for
  // messages/thoughts/plans/usage, and the composer config-control rules below.
  // Without this the previews render as unstyled raw text.
  static styles = [
    timelineStyles,
    css`
    :host { display: block; }
    .card {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--w3);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--glass-border);
      flex-wrap: wrap;
    }
    .title { font-size: var(--font-size-md); font-weight: 650; color: var(--bright-white); }
    .subtitle {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--purple-light);
      background: var(--accent-a10);
      border: 1px solid var(--accent-a25);
      padding: 2px 8px;
      border-radius: 99px;
    }
    .blurb {
      width: 100%;
      margin-top: 2px;
      font-size: var(--font-size-sm);
      line-height: 1.55;
      color: var(--gray);
    }
    .cols {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 1px;
      background: var(--glass-border);
    }
    @media (max-width: 760px) {
      .cols { grid-template-columns: 1fr; }
    }
    .col { background: var(--blue-gray); min-width: 0; }
    .col-label {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 8px 14px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--neutral-gray);
      border-bottom: 1px solid var(--w5);
    }
    .col-label .pip { width: 6px; height: 6px; border-radius: 50%; }
    .col-label .pip.json { background: var(--purple-light); }
    .col-label .pip.ui { background: var(--emerald); }
    .json-wrap { padding: 12px 14px; }
    .preview {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    /* Highlight any UI region whose data-path relates to the hovered JSON path. */
    .preview ::slotted(.map-target),
    .preview .map-target {
      border-radius: var(--radius-sm);
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
    }
    .preview .map-target.hl {
      background: var(--accent-a18);
      box-shadow: 0 0 0 1px var(--accent-a35);
    }
    .legend { display: flex; flex-direction: column; gap: 6px; }
    .legend-row {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 6px 9px;
      border-radius: var(--radius);
      border: 1px solid transparent;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .legend-row.hl { background: var(--accent-a15); border-color: var(--accent-a35); }
    .legend-code {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--purple-light);
      white-space: nowrap;
    }
    .legend-arrow { color: var(--neutral-gray); }
    .legend-label { font-size: var(--font-size-sm); color: var(--white); }

    /* ── Config-control preview (session/new card) ──
       Mirrors the composer controls in agents-view so the rendered side reads
       as the real config dropdown. Inert here (tabindex=-1). */
    .config-faux { display: flex; flex-direction: column; gap: 10px; }
    .config-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
    .config-row-label {
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--neutral-gray);
      min-width: 56px;
    }
    .config-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px 4px 11px;
      border: 1px solid transparent;
      border-radius: 99px;
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-family: var(--font);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .config-trigger:hover { background: var(--w6); color: var(--bright-white); }
    .config-trigger .caret { width: 9px; height: 9px; opacity: 0.7; }

    /* ── Slash-command menu preview (available_commands_update card) ──
       Mirrors the composer's "/" dropdown in agents-view. Inert. */
    .slash-faux {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 5px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      background: var(--surface-modal);
    }
    .slash-row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 7px 10px;
      border-radius: var(--radius);
      font-size: var(--font-size-sm);
    }
    .slash-row .slash-name { font-family: var(--font-mono); font-weight: 600; color: var(--bright-white); flex-shrink: 0; }
    .slash-row .slash-desc { color: var(--neutral-gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── Client-call panel (fs/*, session/load, session/cancel) ──
       These agent→client requests have no timeline UI; show how the UI, acting
       as the ACP server, services them. */
    .clientcall {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w3);
      padding: 12px 14px;
    }
    .clientcall-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--emerald);
      margin-bottom: 9px;
    }
    .clientcall-pip {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 6px var(--emerald);
      flex-shrink: 0;
    }
    .clientcall-list {
      margin: 0;
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .clientcall-list li {
      font-size: var(--font-size-sm);
      line-height: 1.5;
      color: var(--white);
    }
  `,
  ];

  private onHoverPath = (e: Event) => {
    const detail = (e as CustomEvent).detail as { path: string | null };
    this.hoveredPath = detail?.path ?? null;
  };

  // When the rendered preview declares mappable regions, tag them with the
  // hovered state by toggling a class after each render. Lit re-renders on
  // hoveredPath change, so we reconcile in updated().
  updated() {
    const targets = this.renderRoot.querySelectorAll<HTMLElement>('.preview .map-target');
    for (const el of targets) {
      const p = el.dataset.path ?? '';
      el.classList.toggle('hl', pathsRelated(p, this.hoveredPath));
    }
  }

  // Hovering a UI region pushes its path back into the shared state so the JSON
  // column lights up too.
  private onPreviewOver = (e: Event) => {
    const el = (e.target as HTMLElement)?.closest?.('.map-target') as HTMLElement | null;
    const path = el?.dataset.path ?? null;
    if (path !== this.hoveredPath) this.hoveredPath = path;
  };
  private onPreviewOut = (e: Event) => {
    const related = (e as MouseEvent).relatedTarget as Node | null;
    const preview = this.renderRoot.querySelector('.preview');
    if (related && preview?.contains(related)) return;
    this.hoveredPath = null;
  };

  render() {
    return html`
      <div class="card">
        <div class="head">
          <span class="title">${this.title}</span>
          ${this.subtitle ? html`<span class="subtitle">${this.subtitle}</span>` : nothing}
          ${this.blurb ? html`<span class="blurb">${this.blurb}</span>` : nothing}
        </div>
        <div class="cols">
          <div class="col">
            <div class="col-label"><span class="pip json"></span>Protocol JSON</div>
            <div class="json-wrap">
              <acp-json
                .value=${this.json}
                .hoveredPath=${this.hoveredPath}
                @hover-path=${this.onHoverPath}
              ></acp-json>
            </div>
          </div>
          <div class="col">
            <div class="col-label"><span class="pip ui"></span>Rendered UI</div>
            <div class="preview" @mouseover=${this.onPreviewOver} @mouseout=${this.onPreviewOut}>
              ${this.mappings.length ? this.renderLegend() : nothing}
              ${this.rendered}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderLegend() {
    return html`
      <div class="legend">
        ${this.mappings.map(
          (m) => html`
            <div
              class="legend-row map-target ${pathsRelated(m.path, this.hoveredPath) ? 'hl' : ''}"
              data-path=${m.path}
            >
              <span class="legend-code">${m.path.split('.').slice(-2).join('.')}</span>
              <span class="legend-arrow">→</span>
              <span class="legend-label">${m.label}</span>
            </div>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'acp-mapping-card': AcpMappingCard;
  }
}
