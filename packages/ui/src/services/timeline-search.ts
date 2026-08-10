// Pure helpers for "Find in conversation" (Cmd/Ctrl+F in the Agents view).
//
// The chat timeline is bottom-anchored and windowed — only the last N items are
// mounted in the DOM (see TIMELINE_WINDOW in agents-view.ts) — so a DOM-based
// find would silently miss earlier history. These functions search the in-memory
// `TimelineItem[]` instead, so the match count and navigation span the whole
// conversation; the view then expands the window to mount a chosen match before
// highlighting it. Tool calls (diffs, terminal output) are out of scope; find
// covers the conversational content: user/assistant messages, thoughts, notes.

import type { TimelineItem } from './acp-types.js';

// One item that contains at least one match, with its occurrence count. Kept in
// timeline order so a global occurrence index maps to (item, local occurrence).
export interface ItemMatch {
  id: string;
  count: number;
}

// Count non-overlapping occurrences of an already-lowercased needle in an
// already-lowercased haystack. Empty needle counts as zero.
export function countOccurrences(haystackLower: string, needleLower: string): number {
  if (!needleLower) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystackLower.indexOf(needleLower, from);
    if (at < 0) return count;
    count++;
    from = at + needleLower.length;
  }
}

// Which searchable text a timeline item contributes. Assistant messages render
// as parsed markdown, so the caller passes the DOM-facing plain text (markdown
// stripped) to keep counts aligned with what the user sees and what gets
// highlighted. Everything else renders verbatim. Returns '' for out-of-scope
// items (tools, non-text blocks).
export function itemSearchText(
  item: TimelineItem,
  assistantPlainText: (id: string, markdown: string) => string,
): string {
  switch (item.kind) {
    case 'message':
      return item.role === 'assistant' ? assistantPlainText(item.id, item.text) : item.text;
    case 'thought':
    case 'note':
      return item.text;
    default:
      return '';
  }
}

// Build the ordered list of matching items for `query`. Case-insensitive.
export function collectMatches(
  items: TimelineItem[],
  query: string,
  assistantPlainText: (id: string, markdown: string) => string,
): ItemMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: ItemMatch[] = [];
  for (const item of items) {
    const text = itemSearchText(item, assistantPlainText);
    if (!text) continue;
    const count = countOccurrences(text.toLowerCase(), needle);
    if (count > 0) matches.push({ id: item.id, count });
  }
  return matches;
}

export function totalMatches(matches: ItemMatch[]): number {
  return matches.reduce((sum, m) => sum + m.count, 0);
}

// Map a global 0-based occurrence index onto the item that holds it and the
// occurrence's index within that item. Returns null if out of range.
export function locateMatch(
  matches: ItemMatch[],
  globalIndex: number,
): { id: string; local: number } | null {
  if (globalIndex < 0) return null;
  let remaining = globalIndex;
  for (const m of matches) {
    if (remaining < m.count) return { id: m.id, local: remaining };
    remaining -= m.count;
  }
  return null;
}
