// Estimates what's consuming a session's context window, bucketed by category.
//
// The ACP adapter reports only aggregate usage (`used` / `size` tokens) — there
// is no per-category breakdown on the wire. So we approximate: tokenize every
// timeline item we're holding, bucket it (your messages / agent responses /
// reasoning / tool calls & results / attachments), and reconcile the sum
// against the authoritative `used` total from the adapter.
//
// Tokens are estimated with the ~4-chars-per-token heuristic (no tokenizer
// dependency, per the "keep end-user deps light" constraint). The numbers are
// therefore approximate — good to a few percent — but the *proportions* are
// what answer "what's eating my context", and the reconciled total is exact.

import type { ContentBlock, TimelineItem, ToolCall, ToolCallContent } from './acp-types.js';

export interface ContextSegment {
  key: 'tools' | 'assistant' | 'reasoning' | 'user' | 'attachments' | 'overhead';
  label: string;
  tokens: number;
  // Fraction of `used` this segment accounts for (0–1).
  pct: number;
  // CSS var (without the var() wrapper) for the segment's swatch/bar colour.
  colorVar: string;
}

export interface ContextBreakdown {
  segments: ContextSegment[];
  used: number;
  size: number;
  cost?: number;
}

const CHARS_PER_TOKEN = 4;
// Rough flat cost for an inline image; real cost is dimension-dependent (~ tiles)
// and we don't have the dimensions here. Kept modest so images don't dominate.
const IMAGE_TOKENS = 1200;

const CATEGORY_META: Record<ContextSegment['key'], { label: string; colorVar: string }> = {
  tools: { label: 'Tool calls & results', colorVar: '--accent' },
  assistant: { label: 'Agent responses', colorVar: '--emerald' },
  reasoning: { label: 'Reasoning', colorVar: '--teal' },
  user: { label: 'Your messages', colorVar: '--indigo' },
  attachments: { label: 'Attachments', colorVar: '--amber' },
  overhead: { label: 'System & tools', colorVar: '--neutral-gray' },
};

function toTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function blockChars(block: ContentBlock | undefined): number {
  if (!block) return 0;
  switch (block.type) {
    case 'text':
      return ((block as { text?: string }).text ?? '').length;
    case 'resource':
      return ((block as { resource?: { text?: string } }).resource?.text ?? '').length;
    case 'resource_link': {
      const b = block as { uri?: string; name?: string };
      return (b.uri ?? '').length + (b.name ?? '').length;
    }
    default:
      return 0;
  }
}

// Non-text attachment weight (images/audio) in estimated tokens.
function blockAttachmentTokens(block: ContentBlock): number {
  if (block.type === 'image') return IMAGE_TOKENS;
  if (block.type === 'audio') return IMAGE_TOKENS;
  return 0;
}

function toolContentChars(content: ToolCallContent | undefined): number {
  if (!content) return 0;
  switch (content.type) {
    case 'diff': {
      const c = content as { oldText?: string | null; newText?: string; path?: string };
      return (c.oldText ?? '').length + (c.newText ?? '').length + (c.path ?? '').length;
    }
    case 'content':
      return blockChars((content as { content?: ContentBlock }).content);
    case 'terminal':
      // Terminal output isn't carried on the tool item (fetched separately), so
      // nothing to weigh here beyond the id.
      return 0;
    default:
      return 0;
  }
}

function jsonChars(value: unknown): number {
  if (value == null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function toolChars(tool: ToolCall): number {
  let chars = (tool.title ?? '').length;
  chars += jsonChars(tool.rawInput);
  chars += jsonChars(tool.rawOutput);
  for (const c of tool.content ?? []) chars += toolContentChars(c);
  for (const child of tool.children ?? []) chars += toolChars(child);
  return chars;
}

// Which category an item bills to, plus its estimated token weight. Since a
// timeline item maps to exactly one category, this is all we cache per item.
interface ItemCost {
  key: ContextSegment['key'] | null; // null = doesn't reach the agent's context
  tokens: number;
}

// Per-item token cost is memoized by item identity. The breakdown is computed
// lazily on hover, but a user hovering the meter repeatedly in a long session
// would otherwise re-`JSON.stringify` the whole conversation's tool I/O each
// time. Timeline items are immutable — the Conversation reassigns `items` and
// rebuilds any changed item as a fresh object, so an unchanged item keeps its
// reference and stays cached; only new or merged items ever recompute.
const itemCostCache = new WeakMap<TimelineItem, ItemCost>();

function costOf(item: TimelineItem): ItemCost {
  const cached = itemCostCache.get(item);
  if (cached) return cached;
  let cost: ItemCost;
  switch (item.kind) {
    case 'message':
      cost = { key: item.role === 'user' ? 'user' : 'assistant', tokens: toTokens(item.text.length) };
      break;
    case 'thought':
      cost = { key: 'reasoning', tokens: toTokens(item.text.length) };
      break;
    case 'tool':
      cost = { key: 'tools', tokens: toTokens(toolChars(item.tool)) };
      break;
    case 'block': {
      const attach = blockAttachmentTokens(item.block);
      cost = { key: 'attachments', tokens: attach || toTokens(blockChars(item.block)) };
      break;
    }
    case 'note':
    default:
      // Local-only UI hints never reach the agent's context.
      cost = { key: null, tokens: 0 };
      break;
  }
  itemCostCache.set(item, cost);
  return cost;
}

// Sum raw estimated tokens per category from the folded timeline, before any
// reconciliation against the adapter's authoritative total.
function rawByCategory(items: TimelineItem[]): Record<ContextSegment['key'], number> {
  const acc: Record<ContextSegment['key'], number> = {
    tools: 0, assistant: 0, reasoning: 0, user: 0, attachments: 0, overhead: 0,
  };
  for (const item of items) {
    const { key, tokens } = costOf(item);
    if (key && tokens) acc[key] += tokens;
  }
  return acc;
}

/**
 * Estimate the context-window breakdown for a session.
 *
 * `used`/`size` come straight from the adapter (authoritative). The per-category
 * numbers are estimated from the held timeline and then reconciled to `used`:
 *  - If our estimate is below `used`, the remainder is booked to "System & tools"
 *    (the system prompt and tool-schema overhead we never see on the wire).
 *  - If our estimate exceeds `used`, every category is scaled down to fit, so
 *    the segments always sum to the real total.
 *
 * Returns null when there's no usage to break down yet (no window reported).
 */
export function estimateContextBreakdown(
  items: TimelineItem[],
  usage: { used: number; size: number; cost?: number } | null,
): ContextBreakdown | null {
  if (!usage || !usage.size || usage.used <= 0) return null;
  const { used, size, cost } = usage;

  const raw = rawByCategory(items);
  const estTotal = raw.tools + raw.assistant + raw.reasoning + raw.user + raw.attachments;

  const keys: ContextSegment['key'][] = ['tools', 'assistant', 'reasoning', 'user', 'attachments'];
  let tokensByKey: Record<ContextSegment['key'], number>;

  if (estTotal <= used) {
    // Book the shortfall (system prompt + tool schemas + slack) to overhead.
    tokensByKey = { ...raw, overhead: used - estTotal };
  } else {
    // Over-estimated the visible content; scale every category to fit `used`.
    const scale = used / estTotal;
    tokensByKey = {
      tools: Math.round(raw.tools * scale),
      assistant: Math.round(raw.assistant * scale),
      reasoning: Math.round(raw.reasoning * scale),
      user: Math.round(raw.user * scale),
      attachments: Math.round(raw.attachments * scale),
      overhead: 0,
    };
  }

  const allKeys: ContextSegment['key'][] = [...keys, 'overhead'];
  const segments: ContextSegment[] = allKeys
    .map((key) => ({
      key,
      label: CATEGORY_META[key].label,
      colorVar: CATEGORY_META[key].colorVar,
      tokens: tokensByKey[key],
      pct: used > 0 ? tokensByKey[key] / used : 0,
    }))
    .filter((s) => s.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  return { segments, used, size, ...(typeof cost === 'number' ? { cost } : {}) };
}
