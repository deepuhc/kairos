// The "Full guide" reader — the textbook half of the Help & guide drawer. A
// two-pane layout: a table of contents on the left, the rendered Markdown of the
// selected doc on the right. The docs are the same files that ship in docs/
// (imported via guide-content.ts), rendered with the app's shared Markdown
// pipeline so code blocks, tables, and links look like the rest of the app.
//
// Links inside a doc are rewired for in-app navigation: a link to another guide
// doc switches the reader to it, a same-page #anchor scrolls to that heading, and
// anything external opens in a new tab. Headings get slug ids so the docs' own
// in-page tables of contents work.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { renderMarkdown, markdownStyles } from './markdown.js';
import {
  GUIDE_GROUPS,
  getGuideDoc,
  slugifyHeading,
  resolveGuideHref,
} from './guide-content.js';

@customElement('kairos-guide-reader')
export class DevaiGuideReader extends LitElement {
  // The doc to show. Two-way-ish: the reader emits `doc-change` when the user
  // navigates internally so the host can keep its own state in sync.
  @property({ type: String }) docId = 'getting-started';
  // A heading slug to scroll to once the doc renders (from a cross-doc #anchor).
  @property({ type: String }) pendingHash: string | null = null;

  @state() private query = '';

  static styles = [
    markdownStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: 232px 1fr;
        /* Bound the single row to the host height (minmax(0,…) so the row can't
           be forced taller by its content) — this is what lets the TOC and the
           reader each scroll internally instead of the whole grid growing to the
           reader's content height and carrying the short TOC out of view. */
        grid-template-rows: minmax(0, 1fr);
        min-height: 0;
        height: 100%;
      }
      /* Table of contents */
      .toc {
        border-right: 1px solid var(--glass-border);
        overflow-y: auto;
        padding: 16px 12px 24px;
        background: var(--bg-subtle);
      }
      .toc-search {
        width: 100%;
        box-sizing: border-box;
        margin-bottom: 12px;
        padding: 7px 10px;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-sm);
        background: var(--w5);
        color: var(--white);
        font-size: var(--font-size-sm);
      }
      .toc-search::placeholder { color: var(--neutral-gray); }
      .toc-search:focus { outline: none; border-color: var(--accent-a35); }
      .group-label {
        margin: 14px 8px 6px;
        font-size: var(--font-size-xs);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--neutral-gray);
      }
      .group-label:first-child { margin-top: 0; }
      .toc-item {
        display: block;
        width: 100%;
        text-align: left;
        border: none;
        background: none;
        border-radius: var(--radius-sm);
        padding: 7px 10px;
        margin: 1px 0;
        cursor: pointer;
        color: var(--gray);
        transition: background 0.12s, color 0.12s;
      }
      .toc-item:hover { background: var(--w5); color: var(--white); }
      .toc-item[aria-current='true'] {
        background: var(--accent-a15);
        color: var(--bright-white);
      }
      .toc-item .t { font-size: var(--font-size-base); font-weight: 550; }
      .toc-item .b {
        font-size: var(--font-size-xs);
        color: var(--neutral-gray);
        margin-top: 1px;
        line-height: 1.35;
      }
      .toc-item[aria-current='true'] .b { color: var(--gray); }
      .toc-empty { padding: 10px; color: var(--neutral-gray); font-size: var(--font-size-sm); }

      /* Reading pane */
      .reader {
        overflow-y: auto;
        padding: 28px 40px 56px;
        color: var(--gray);
        line-height: 1.6;
        scroll-behavior: smooth;
      }
      .reader::-webkit-scrollbar, .toc::-webkit-scrollbar { width: 10px; }
      .reader::-webkit-scrollbar-thumb, .toc::-webkit-scrollbar-thumb {
        background: var(--w10);
        border-radius: 5px;
      }
      /* Textbook-ish measure + heading rhythm layered on top of markdownStyles. */
      .md { max-width: 760px; }
      .md h1 { font-size: var(--font-size-2xl); margin: 0 0 14px; }
      .md h2 {
        font-size: var(--font-size-xl);
        margin: 30px 0 12px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--glass-border);
        scroll-margin-top: 12px;
      }
      .md h3 { font-size: var(--font-size-lg); scroll-margin-top: 12px; }
      .md table {
        border-collapse: collapse;
        margin: 12px 0;
        font-size: var(--font-size-base);
      }
      .md th, .md td {
        border: 1px solid var(--glass-border);
        padding: 7px 12px;
        text-align: left;
        vertical-align: top;
      }
      .md th { background: var(--w5); color: var(--white); font-weight: 600; }
      /* Why Kairos: render its "**Title.** blurb" bullet lists as a card grid
         (echoing the Help tour cards). Scoped to this doc so other guides keep
         their plain lists. */
      .md.doc-why-kairos ul {
        list-style: none;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
        margin: 4px 0 16px;
        padding: 0;
      }
      .md.doc-why-kairos li {
        margin: 0;
        background: var(--w4);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius);
        padding: 14px 16px;
        font-size: var(--font-size-base);
        line-height: 1.5;
      }
      .md.doc-why-kairos li strong {
        display: block;
        margin-bottom: 5px;
        color: var(--bright-white);
        font-weight: 600;
      }
      .md.doc-why-kairos li strong::before {
        content: '';
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 8px;
        border-radius: 50%;
        background: var(--accent);
        vertical-align: middle;
      }
      /* The heading a jump landed on gets a slow, obvious "look here" highlight:
         an accent wash + a left accent bar that hold briefly, then fade out over
         a couple of seconds. This orients the reader after a jump — especially
         one into a long doc where the target sits low and there's lots of
         scrollbar left below it (the trailing scroll space). The bar is drawn on
         a pseudo-element so it can animate independently of the text. */
      .md .flash-target {
        position: relative;
        animation: heading-flash 2.6s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: var(--radius-sm);
      }
      .md .flash-target::before {
        content: '';
        position: absolute;
        left: -14px;
        top: 2px;
        bottom: 2px;
        width: 3px;
        border-radius: 2px;
        background: var(--accent);
        animation: heading-bar 2.6s cubic-bezier(0.4, 0, 0.2, 1);
      }
      @keyframes heading-flash {
        0%, 35% { background: var(--accent-a25); box-shadow: 0 0 0 6px var(--accent-a15); }
        100% { background: transparent; box-shadow: 0 0 0 6px transparent; }
      }
      @keyframes heading-bar {
        0%, 35% { opacity: 1; }
        100% { opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .reader { scroll-behavior: auto; }
        /* No motion, but still leave a persistent marker so the target is
           identifiable — a static left accent bar, no fade. */
        .md .flash-target { animation: none; position: relative; }
        .md .flash-target::before {
          content: '';
          position: absolute;
          left: -14px;
          top: 2px;
          bottom: 2px;
          width: 3px;
          border-radius: 2px;
          background: var(--accent);
          animation: none;
        }
      }
      @media (max-width: 720px) {
        :host { grid-template-columns: 1fr; }
        .toc { display: none; }
      }
    `,
  ];

  // Rendered + link-rewired doc nodes, memoized by id so switching back and
  // forth doesn't re-parse (matching markdown.ts's own caching philosophy).
  private nodeCache = new Map<string, HTMLElement>();

  private renderedNode(): HTMLElement {
    const cached = this.nodeCache.get(this.docId);
    if (cached) return cached;
    const doc = getGuideDoc(this.docId);
    const node = renderMarkdown(doc?.markdown ?? '# Not found');
    node.classList.add('md');
    // Per-doc hook so a single doc can opt into bespoke layout (e.g. the
    // Why Kairos tech lists render as a card grid) without affecting others.
    if (this.docId) node.classList.add(`doc-${this.docId}`);
    this.decorate(node);
    this.nodeCache.set(this.docId, node);
    return node;
  }

  // Give headings slug ids (so #anchors resolve) and rewire every link for
  // in-app navigation. Runs once per doc, on the detached node before insertion.
  private decorate(root: HTMLElement) {
    for (const h of Array.from(root.querySelectorAll('h1, h2, h3, h4'))) {
      if (!h.id) h.id = slugifyHeading(h.textContent ?? '');
    }
    for (const a of Array.from(root.querySelectorAll('a'))) {
      const href = a.getAttribute('href') ?? '';
      const resolved = resolveGuideHref(href);
      if (!resolved) {
        // A .md link with no in-app doc (project README / guide index) — drop
        // the link but keep the text so the sentence still reads.
        const span = document.createElement('span');
        span.textContent = a.textContent;
        a.replaceWith(span);
        continue;
      }
      if (resolved.kind === 'external') {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        continue;
      }
      // doc | anchor — handle in-app; strip the raw href so the browser doesn't
      // also try to follow it.
      a.setAttribute('href', 'javascript:void 0');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (resolved.kind === 'anchor') {
          this.scrollToHeading(resolved.hash);
        } else {
          this.navigateTo(resolved.id, resolved.hash);
        }
      });
    }
  }

  private navigateTo(id: string, hash: string | null) {
    if (id === this.docId) {
      if (hash) this.scrollToHeading(hash);
      return;
    }
    this.pendingHash = hash;
    this.docId = id;
    this.dispatchEvent(new CustomEvent('doc-change', { detail: { id }, bubbles: true, composed: true }));
  }

  // `smooth` for user-initiated clicks (in-page TOC links); `instant` for the
  // on-open jump — a smooth animation across a tall doc takes ~1s to arrive and
  // reads as "still loading", so the initial jump snaps straight there. Either
  // way the target lands at the top when there's room and as far down as the
  // pane allows when it's near the end; the flash highlight (below) is what
  // orients the reader when it can't reach the very top.
  private scrollToHeading(slug: string, mode: 'smooth' | 'instant' = 'smooth') {
    const node = this.renderedNode();
    const target = node.querySelector<HTMLElement>(`#${CSS.escape(slug)}`);
    const pane = this.shadowRoot?.querySelector<HTMLElement>('.reader');
    if (!target || !pane) return;

    // Scroll the reading pane explicitly rather than calling
    // target.scrollIntoView() — scrollIntoView walks *up* every scrollable
    // ancestor, and if any ancestor (e.g. the drawer's .guide-body) can be
    // scrolled programmatically it drags the whole reader — TOC included — out
    // of view. The desired scrollTop is the target's viewport gap from the pane
    // top plus the pane's current scroll (stable regardless of offset-parent).
    const top = Math.max(0, target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 8);
    pane.scrollTo({ top, behavior: mode === 'instant' ? 'auto' : 'smooth' });

    target.classList.remove('flash-target');
    // reflow so the animation can replay on repeat jumps
    void target.offsetWidth;
    target.classList.add('flash-target');
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('docId')) {
      // New doc rendered — scroll to the top (or the pending anchor).
      const reader = this.shadowRoot?.querySelector('.reader');
      if (this.pendingHash) {
        const hash = this.pendingHash;
        this.pendingHash = null;
        // Jump instantly once the pane is actually laid out. A single rAF can
        // fire before the reader's grid resolves its height (pane clientHeight
        // still 0 → the scroll no-ops), so wait for a measurable pane, then jump
        // (instant — a smooth animation across a tall doc reads as "loading").
        let tries = 0;
        const jump = () => {
          const p = this.shadowRoot?.querySelector<HTMLElement>('.reader');
          if (p && p.clientHeight > 0) { this.scrollToHeading(hash, 'instant'); return; }
          if (++tries < 20) requestAnimationFrame(jump);
        };
        requestAnimationFrame(jump);
      } else if (reader) {
        reader.scrollTop = 0;
      }
    }
  }

  private select(id: string) {
    if (id !== this.docId) this.navigateTo(id, null);
  }

  render() {
    const q = this.query.trim().toLowerCase();
    const match = (title: string, blurb: string) =>
      !q || title.toLowerCase().includes(q) || blurb.toLowerCase().includes(q);

    const groups = GUIDE_GROUPS
      .map((g) => ({ ...g, docs: g.docs.filter((d) => match(d.title, d.blurb)) }))
      .filter((g) => g.docs.length > 0);

    return html`
      <nav class="toc" aria-label="Guide contents">
        <input
          class="toc-search"
          type="search"
          placeholder="Find a topic…"
          .value=${this.query}
          @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value; }}
        />
        ${groups.length === 0
          ? html`<div class="toc-empty">No topics match "${this.query}".</div>`
          : groups.map(
              (g) => html`
                <div class="group-label">${g.label}</div>
                ${g.docs.map(
                  (d) => html`
                    <button
                      class="toc-item"
                      aria-current=${d.id === this.docId ? 'true' : 'false'}
                      @click=${() => this.select(d.id)}
                    >
                      <div class="t">${d.title}</div>
                      <div class="b">${d.blurb}</div>
                    </button>
                  `,
                )}
              `,
            )}
      </nav>
      <div class="reader">${this.renderedNode()}</div>
      ${nothing}
    `;
  }
}
