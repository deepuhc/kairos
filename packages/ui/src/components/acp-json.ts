import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Hover-aware JSON pretty-printer. Renders a value as syntax-highlighted,
// indented JSON where every key and value carries a `data-path` (a dotted
// JSON-pointer-ish string like `params.prompt.0.type`). Hovering a token emits
// `hover-path`; the controlled `hoveredPath` property drives which tokens light
// up, so a parent component can link this JSON to the UI it produces and back.
//
// Dependency-free on purpose — Kairos keeps the end-user install lean, and a
// syntax-highlighting library would be overkill for the small protocol frames
// shown in the Behind the Scenes view.

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

export interface JsonToken {
  text: string;
  kind: JsonTokenKind;
  // Present on keys, primitive values, and the `: ` separator between them, so
  // the whole key→value run highlights as one unit. Absent on pure structure
  // (braces, brackets, commas, whitespace).
  path?: string;
}

const INDENT = '  ';

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

function primitiveToken(value: unknown, path: string): JsonToken {
  if (value === null) return { text: 'null', kind: 'null', path };
  if (typeof value === 'string') return { text: JSON.stringify(value), kind: 'string', path };
  if (typeof value === 'number') return { text: String(value), kind: 'number', path };
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean', path };
  // Fallback for undefined / functions / symbols that slipped in.
  return { text: JSON.stringify(value ?? null), kind: 'null', path };
}

function childPath(parent: string, key: string | number): string {
  return parent ? `${parent}.${key}` : String(key);
}

// Serialize a value into a flat token stream (including whitespace/newlines) so
// the component and its tests share one rendering of the JSON. Render with
// `white-space: pre` to honor the embedded newlines and indentation.
export function jsonTokens(value: unknown, path = '', depth = 0, out: JsonToken[] = []): JsonToken[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ text: '[]', kind: 'punct' });
      return out;
    }
    out.push({ text: '[\n', kind: 'punct' });
    value.forEach((v, i) => {
      out.push({ text: indent(depth + 1), kind: 'punct' });
      jsonTokens(v, childPath(path, i), depth + 1, out);
      out.push({ text: (i < value.length - 1 ? ',' : '') + '\n', kind: 'punct' });
    });
    out.push({ text: indent(depth) + ']', kind: 'punct' });
    return out;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out.push({ text: '{}', kind: 'punct' });
      return out;
    }
    out.push({ text: '{\n', kind: 'punct' });
    entries.forEach(([k, v], i) => {
      const cp = childPath(path, k);
      out.push({ text: indent(depth + 1), kind: 'punct' });
      out.push({ text: JSON.stringify(k), kind: 'key', path: cp });
      out.push({ text: ': ', kind: 'punct', path: cp });
      jsonTokens(v, cp, depth + 1, out);
      out.push({ text: (i < entries.length - 1 ? ',' : '') + '\n', kind: 'punct' });
    });
    out.push({ text: indent(depth) + '}', kind: 'punct' });
    return out;
  }
  out.push(primitiveToken(value, path));
  return out;
}

// Two paths are "related" (and so highlight together) when one is the other or
// an ancestor of it. Hovering a node highlights its whole ancestor↔descendant
// chain, so a deep JSON leaf can light up a coarse UI region and vice-versa,
// while siblings stay dark.
export function pathsRelated(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
}

@customElement('acp-json')
export class AcpJson extends LitElement {
  @property({ attribute: false }) value: unknown;
  @property({ type: String }) hoveredPath: string | null = null;

  static styles = css`
    :host { display: block; }
    .json {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.6;
      white-space: pre;
      overflow-x: auto;
      color: var(--gray);
      tab-size: 2;
    }
    .tok { border-radius: 4px; transition: background var(--transition-fast), box-shadow var(--transition-fast); }
    .tok.key { color: var(--purple-light); }
    .tok.string { color: var(--emerald); }
    .tok.number { color: var(--amber); }
    .tok.boolean { color: var(--blue); }
    .tok.null { color: var(--neutral-gray); }
    .tok.punct { color: var(--neutral-gray); }
    /* A token that can map to the UI invites the hover. */
    .tok[data-path] { cursor: pointer; }
    .tok.hl {
      background: var(--accent-a18);
      box-shadow: 0 0 0 1px var(--accent-a35);
      color: var(--bright-white);
    }
    .tok.hl.string { color: var(--code-string-hl); }
    .tok.hl.key { color: var(--bright-white); }
  `;

  private onOver = (e: Event) => {
    const el = (e.target as HTMLElement)?.closest?.('[data-path]') as HTMLElement | null;
    const path = el?.dataset.path ?? null;
    if (path !== this.hoveredPath) this.emitHover(path);
  };

  private onOut = (e: Event) => {
    // Only clear when the pointer actually leaves the JSON block, not when it
    // moves between tokens (relatedTarget still inside).
    const related = (e as MouseEvent).relatedTarget as Node | null;
    if (related && this.renderRoot instanceof Node && this.renderRoot.contains(related)) return;
    this.emitHover(null);
  };

  private emitHover(path: string | null) {
    this.dispatchEvent(new CustomEvent('hover-path', { detail: { path }, bubbles: true, composed: true }));
  }

  render() {
    const tokens = jsonTokens(this.value);
    const h = this.hoveredPath;
    return html`<pre class="json" @mouseover=${this.onOver} @mouseout=${this.onOut}>${tokens.map((t) => {
      const hl = t.path && pathsRelated(t.path, h) ? ' hl' : '';
      return t.path
        ? html`<span class="tok ${t.kind}${hl}" data-path=${t.path}>${t.text}</span>`
        : html`<span class="tok ${t.kind}">${t.text}</span>`;
    })}</pre>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'acp-json': AcpJson;
  }
}
