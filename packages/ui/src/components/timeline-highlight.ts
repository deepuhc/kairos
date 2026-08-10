// DOM-side highlighting for "Find in conversation". Uses the CSS Custom
// Highlight API (CSS.highlights + ::highlight()) so matches are painted over the
// existing text without mutating the DOM, cloning nodes, or triggering any Lit
// re-render or markdown re-parse — the timeline's expensive render path is never
// touched. Ranges are rebuilt only on query/navigation change, and only across
// the currently-mounted (windowed) items, so cost is bounded by what's on screen.
//
// This file is DOM-dependent and thus not exercised by the (server-side) Vitest
// suite; the pure match arithmetic lives in services/timeline-search.ts.

const ALL = 'kairos-find';
const CURRENT = 'kairos-find-current';

export const highlightApiSupported =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

// One matched occurrence located in the live DOM: the item it belongs to, its
// occurrence index within that item, and the Range that covers it.
interface DomOccurrence {
  itemId: string;
  local: number;
  range: Range;
}

// Walk an element's text nodes and return one Range per occurrence of `needle`
// (case-insensitive), in document order. Occurrences may straddle text-node
// boundaries (e.g. markdown wraps a word in <em>), so matching runs over the
// concatenated text and each Range is mapped back to the right node offsets.
function rangesInElement(el: Element, needleLower: string): Range[] {
  if (!needleLower) return [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let combined = '';
  // Offset in `combined` where each node's text begins.
  const starts: number[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    starts.push(combined.length);
    nodes.push(n as Text);
    combined += (n as Text).data;
  }
  const haystack = combined.toLowerCase();
  const ranges: Range[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needleLower, from);
    if (at < 0) break;
    const end = at + needleLower.length;
    const start = locate(nodes, starts, at);
    const stop = locate(nodes, starts, end);
    if (start && stop) {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(stop.node, stop.offset);
      ranges.push(range);
    }
    from = end;
  }
  return ranges;
}

// Map a combined-text offset back to (text node, offset within it).
function locate(nodes: Text[], starts: number[], offset: number): { node: Text; offset: number } | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (offset >= starts[i]) return { node: nodes[i], offset: offset - starts[i] };
  }
  return nodes.length ? { node: nodes[0], offset: 0 } : null;
}

// Rebuild both highlights (all matches + the current one) across the mounted
// items in `root`. `matchedIds` is the ordered set of item ids known to contain
// matches; `current` names the active occurrence to paint distinctly. Returns
// the DOM Range of the current occurrence so the caller can scroll it into view.
export function applyHighlights(
  root: ParentNode,
  needle: string,
  matchedIds: string[],
  current: { id: string; local: number } | null,
): Range | null {
  if (!highlightApiSupported) return null;
  const all = new Highlight();
  const cur = new Highlight();
  let currentRange: Range | null = null;
  const needleLower = needle.toLowerCase();
  for (const id of matchedIds) {
    const el = root.querySelector(`[data-find-id="${cssEscape(id)}"]`);
    if (!el) continue;
    const ranges = rangesInElement(el, needleLower);
    ranges.forEach((range, local) => {
      all.add(range);
      if (current && current.id === id && current.local === local) {
        cur.add(range);
        currentRange = range;
      }
    });
  }
  CSS.highlights.set(ALL, all);
  CSS.highlights.set(CURRENT, cur);
  return currentRange;
}

export function clearHighlights(): void {
  if (!highlightApiSupported) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}

// CSS.escape guards against ids with characters that would break the selector.
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
