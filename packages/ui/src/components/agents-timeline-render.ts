// Shared timeline render path for the Agents tab.
//
// These functions are the single source of truth for turning folded
// `TimelineItem`s (message / thought / tool / block / note), plans, and usage
// into markup. Both the live session view (`agents-view.ts`) and the
// "Behind the Scenes" showcase (`agents-behind-scenes.ts`) render through the
// exact same code, so the showcase proves authenticity and cannot drift.
//
// They are plain functions (no `this`): the live view passes a small ctx so the
// renderer stays agnostic about where the session state lives.

import { html, css, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { hljsTheme } from './code-highlight.js';
import { markdownStyles, renderMarkdown, renderMarkdownCached } from './markdown.js';
import { tooltip } from '../directives/tooltip.js';
import './agent-logo.js';
import { hasAgentLogo } from './agent-logo.js';
import './agents-tool-call.js';
import './copy-button.js';
import { messageBodyForClipboard } from '../services/transcript.js';
import { stripControlChars } from '../services/sanitize-text.js';
import { estimateContextBreakdown } from '../services/context-breakdown.js';
import type { ContextBreakdown } from '../services/context-breakdown.js';
import { adviseCache } from '../services/cache-advisor.js';
import type { CacheAdvice, CacheSignals } from '../services/cache-advisor.js';
import type { ToolPermission } from './agents-tool-call.js';
import type {
  AudioContent,
  ContentBlock,
  EmbeddedResourceContent,
  ImageContent,
  PlanEntry,
  ResourceLinkContent,
  TimelineItem,
  UsageInfo,
} from '../services/acp-types.js';

export { renderMarkdown };

// What the renderer needs to know about a tool item's surrounding session,
// supplied by the caller so the functions stay free of session-state coupling.
export interface TimelineRenderCtx {
  agentId: string;
  agentName: string;
  // Namespaces the memoized-markdown cache key. Item ids (m0, m1, …) are only
  // unique within one conversation, and all sessions' timelines are mounted at
  // once, so without a per-session scope two sessions' `m0` would collide.
  cacheScope?: string;
  permissionFor?: (toolCallId: string) => ToolPermission | undefined;
  terminalOutputFor?: (terminalId: string) => string | undefined;
  onPermissionChoice?: (e: CustomEvent) => void;
  // Whether a live permission card should grab focus for keyboard resolution.
  autofocusPermission?: boolean;
  // Diff cards from history replay stay collapsed by default, including while
  // replay temporarily reports them as in_progress. Live edits remain open.
  collapseReplayDiffsFor?: (toolCallId: string) => boolean;
  // Optional per-message action buttons rendered beside the copy affordance.
  messageActions?: (item: Extract<TimelineItem, { kind: 'message' }>) => TemplateResult | typeof nothing;
  // True for an assistant message that is still streaming. The renderer can
  // trade sub-frame markdown freshness for lower CPU, then render exactly when
  // the caller reports the turn has settled.
  liveMarkdownFor?: (item: Extract<TimelineItem, { kind: 'message' }>) => boolean;
}

// `Intl`-backed locale formatting (toLocaleTimeString/toLocaleString) is
// surprisingly expensive — a CPU profile of a streaming turn showed these two
// functions at ~75% of self-time, because renderItem re-invokes them for every
// message on every re-render (keyed repeat reuses DOM but still runs the
// template fn per item). A message's `ts` never changes, so memoize by the
// timestamp value. Unbounded is fine in practice (one entry per distinct
// message timestamp), but cap defensively for very long-lived tabs.
const clockCache = new Map<number, string>();
const stampCache = new Map<number, string>();
const TS_CACHE_CAP = 2000;

function memoTs(cache: Map<number, string>, ts: number, fmt: (ts: number) => string): string {
  const hit = cache.get(ts);
  if (hit !== undefined) return hit;
  const val = fmt(ts);
  if (cache.size >= TS_CACHE_CAP) cache.clear();
  cache.set(ts, val);
  return val;
}

// Short wall-clock for the message timestamp (e.g. "2:45 PM").
function formatClock(ts: number): string {
  return memoTs(clockCache, ts, (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
}

// Full date + time for the timestamp's hover tooltip.
function formatTimestamp(ts: number): string {
  return memoTs(stampCache, ts, (t) => new Date(t).toLocaleString());
}

// Compact token counts for the meter: 1234 → "1.2k", 1000000 → "1M".
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

// Cumulative session spend for the meter, e.g. 0.4234 → "$0.42".
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

// Render a non-text content block (image/audio/resource_link/resource) that
// appeared in a message stream or was attached by the user. Unknown block
// types fall back to pretty-printed JSON so nothing is silently dropped.
export function renderBlock(block: ContentBlock) {
  if (block.type === 'image') {
    const b = block as ImageContent;
    return html`<img class="block-image" src=${`data:${b.mimeType};base64,${b.data}`} alt="image attachment" />`;
  }
  if (block.type === 'audio') {
    const b = block as AudioContent;
    return html`<audio class="block-audio" controls src=${`data:${b.mimeType};base64,${b.data}`}></audio>`;
  }
  if (block.type === 'resource_link') {
    const b = block as ResourceLinkContent;
    return html`<span class="block-resource" ${tooltip(b.uri)}><span class="block-resource-icon">@</span>${b.name ?? b.uri}</span>`;
  }
  if (block.type === 'resource') {
    const b = block as EmbeddedResourceContent;
    const label = b.resource?.uri ?? b.resource?.mimeType ?? 'resource';
    return b.resource?.text != null
      ? html`<div class="block-resource-body"><div class="block-resource-head">${label}</div><pre>${stripControlChars(b.resource.text)}</pre></div>`
      : html`<span class="block-resource" ${tooltip(label)}><span class="block-resource-icon">@</span>${label}</span>`;
  }
  return html`<pre class="block-unknown">${stripControlChars(JSON.stringify(block, null, 2))}</pre>`;
}

export function renderItem(item: TimelineItem, ctx: TimelineRenderCtx) {
  if (item.kind === 'message') {
    const role = item.role;
    const copyBtn = html`<copy-button
      class="msg-copy"
      .text=${messageBodyForClipboard(item)}
      title="Copy message"
    ></copy-button>`;
    const actions = role === 'user' ? ctx.messageActions?.(item) : nothing;
    return html`
      <div class="msg ${role}" data-item-id=${item.id}>
        ${role === 'assistant'
          ? html`<div class="eyebrow">${hasAgentLogo(ctx.agentId) ? html`<agent-logo .agent=${ctx.agentId} .size=${13}></agent-logo>` : nothing}${ctx.agentName}<span class="msg-time" ${tooltip(formatTimestamp(item.ts))}>${formatClock(item.ts)}</span>${copyBtn}</div>`
          : nothing}
        <div class="content" data-find-id=${item.id}>${role === 'assistant' ? renderMarkdownCached(`${ctx.cacheScope ?? ''}:${item.id}`, item.text, { live: ctx.liveMarkdownFor?.(item) ?? false }) : stripControlChars(item.text)}</div>
        ${role === 'user' ? html`<span class="msg-foot"><span class="msg-time" ${tooltip(formatTimestamp(item.ts))}>${formatClock(item.ts)}</span>${actions}${copyBtn}</span>` : nothing}
      </div>
    `;
  }
  if (item.kind === 'thought') {
    return html`<div class="thought" data-find-id=${item.id}>${stripControlChars(item.text)}</div>`;
  }
  if (item.kind === 'block') {
    return html`<div class="msg ${item.role}">${renderBlock(item.block)}</div>`;
  }
  if (item.kind === 'note') {
    return html`<div class="system-note" data-find-id=${item.id}>${item.text}</div>`;
  }
  // tool
  const termContent = item.tool.content?.find((c) => c.type === 'terminal') as { terminalId: string } | undefined;
  const termOutput = termContent ? ctx.terminalOutputFor?.(termContent.terminalId) : undefined;
  const perm = ctx.permissionFor?.(item.tool.toolCallId);
  return html`<div class="tool-wrap"><agents-tool-call
    .tool=${item.tool}
    .terminalOutput=${termOutput}
    .permission=${perm}
    .autofocusPermission=${ctx.autofocusPermission ?? false}
    .collapseReplayDiffs=${ctx.collapseReplayDiffsFor?.(item.tool.toolCallId) ?? false}
    .terminalOutputFor=${ctx.terminalOutputFor}
    .permissionFor=${ctx.permissionFor}
    @permission-choice=${ctx.onPermissionChoice}
  ></agents-tool-call></div>`;
}

function planEntry(e: PlanEntry) {
  return html`
    <div class="plan-entry ${e.status ?? ''}">
      <span class="plan-check">${e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '▸' : '○'}</span>
      <span>${e.content}</span>
    </div>
  `;
}

export function renderPlan(plan: PlanEntry[], collapsed: boolean, onToggle: () => void) {
  const done = plan.filter((e) => e.status === 'completed').length;
  const current = collapsed
    ? plan.find((e) => e.status === 'in_progress') ?? plan.find((e) => e.status !== 'completed')
    : null;
  return html`
    <div class="plan">
      <button
        class="plan-title ${collapsed ? 'collapsed' : ''}"
        aria-expanded=${!collapsed}
        @click=${onToggle}
      >
        <svg class="caret" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Plan</span>
        <span class="plan-count">${done}/${plan.length}</span>
      </button>
      ${collapsed
        ? (current ? planEntry(current) : nothing)
        : plan.map((e) => planEntry(e))}
    </div>
  `;
}

// Context-window meter, shown once the agent has reported usage. `used`/`size`
// are token counts; the bar fills with the fraction of the window in use and
// shifts amber→red as it approaches full (the cue to compact). Passing the
// timeline `items` in adds a hover popover estimating what's consuming the
// window, by category — computed lazily on hover (see the tooltip callback), so
// nothing runs on the frame-coalesced streaming render path.
export function renderUsage(u: UsageInfo | null, items?: TimelineItem[], cacheSignals?: CacheSignals) {
  if (!u || !u.size) return nothing;
  const frac = Math.min(u.used / u.size, 1);
  const pct = Math.round(frac * 100);
  const level = frac >= 0.9 ? 'high' : frac >= 0.7 ? 'warn' : '';
  const cost = typeof u.cost === 'number'
    ? `\n${formatCost(u.cost)} spent this session`
    : '';
  const plain = `${u.used.toLocaleString()} / ${u.size.toLocaleString()} tokens (${pct}%)${cost}`;
  const advice = adviseCache(u.cache, cacheSignals);

  // The breakdown is estimated only when the pointer actually enters the meter —
  // the tooltip directive invokes this thunk on mouseenter, not per render.
  const breakdownContent = () => {
    const b = estimateContextBreakdown(items ?? [], u);
    if (!b && !advice) return plain;
    return breakdownTip(b, pct, advice, u);
  };

  return html`
    <span
      class="usage"
      ${items || advice
        ? tooltip({ content: breakdownContent, prefer: 'below' })
        : tooltip(plain)}
    >
      <span class="usage-bar"><span class="usage-fill ${level}" style="width:${pct}%"></span></span>
      <span>${formatTokens(u.used)}/${formatTokens(u.size)}</span>
      ${typeof u.cost === 'number' ? html`<span class="usage-cost">${formatCost(u.cost)}</span>` : nothing}
    </span>
  `;
}

// Builds the DOM node for the context-breakdown popover. The tooltip directive
// takes a plain Node (not a Lit template), so this is hand-rolled DOM.
function breakdownTip(
  b: ContextBreakdown | null,
  pct: number,
  advice: CacheAdvice | null,
  usage: UsageInfo,
): Node {
  const root = document.createElement('div');
  root.className = 'usage-tip';

  if (b) {
    const head = document.createElement('div');
    head.className = 'usage-tip-head';
    head.textContent = `${b.used.toLocaleString()} / ${b.size.toLocaleString()} tokens · ${pct}% of window`;
    root.appendChild(head);

    for (const seg of b.segments) {
      const row = document.createElement('div');
      row.className = 'usage-tip-row';

      const swatch = document.createElement('span');
      swatch.className = 'usage-tip-swatch';
      swatch.style.background = `var(${seg.colorVar})`;
      row.appendChild(swatch);

      const label = document.createElement('span');
      label.className = 'usage-tip-label';
      label.textContent = seg.label;
      row.appendChild(label);

      const val = document.createElement('span');
      val.className = 'usage-tip-val';
      val.textContent = `${formatTokens(seg.tokens)} · ${Math.round(seg.pct * 100)}%`;
      row.appendChild(val);

      root.appendChild(row);
    }

    const foot = document.createElement('div');
    foot.className = 'usage-tip-foot';
    foot.textContent = typeof b.cost === 'number'
      ? `Estimated split · ${formatCost(b.cost)} spent this session`
      : 'Estimated split from the conversation';
    root.appendChild(foot);
  }

  if (advice) root.appendChild(cacheSection(advice, usage.cache));

  return root;
}

function cacheSection(advice: CacheAdvice, cache: UsageInfo['cache']): Node {
  const wrap = document.createElement('div');
  wrap.className = 'usage-tip-cache';

  const head = document.createElement('div');
  head.className = 'usage-tip-cache-head';
  const rate = document.createElement('span');
  rate.className = `usage-tip-cache-rate cache-${advice.grade}`;
  rate.textContent = `cache ${Math.round(advice.hitRate * 100)}% hit`;
  head.appendChild(rate);
  wrap.appendChild(head);

  const summary = document.createElement('div');
  summary.className = 'usage-tip-cache-summary';
  summary.textContent = advice.summary;
  wrap.appendChild(summary);

  const rows: Array<[string, number]> = [
    ['Read from cache', advice.cachedRead],
    ['Written to cache', advice.cachedWrite],
    ['Fresh input', advice.input],
    ['Output', advice.output],
  ];
  for (const [label, tokens] of rows) {
    if (!tokens && cache == null) continue;
    const row = document.createElement('div');
    row.className = 'usage-tip-row';
    const l = document.createElement('span');
    l.className = 'usage-tip-label';
    l.textContent = label;
    row.appendChild(l);
    const v = document.createElement('span');
    v.className = 'usage-tip-val';
    v.textContent = formatTokens(tokens);
    row.appendChild(v);
    wrap.appendChild(row);
  }

  for (const tip of advice.tips) {
    const t = document.createElement('div');
    t.className = 'usage-tip-tip';
    const cause = document.createElement('div');
    cause.className = 'usage-tip-tip-cause';
    cause.textContent = tip.cause;
    t.appendChild(cause);
    const action = document.createElement('div');
    action.className = 'usage-tip-tip-action';
    action.textContent = `Action: ${tip.action}`;
    t.appendChild(action);
    wrap.appendChild(t);
  }

  return wrap;
}

// Shared CSS for everything the timeline renderer emits. Included first in both
// components' `static styles` so the live view and the showcase render
// identically. Composer / sidebar / connect rules stay in agents-view.
export const timelineStyles = css`
  /* ── Context usage meter ── */
  .usage {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-size-xs);
    color: var(--neutral-gray);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .usage-bar {
    width: 54px; height: 5px;
    border-radius: 99px;
    background: var(--w10);
    overflow: hidden;
  }
  .usage-fill {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--emerald);
    transition: width var(--transition-fast), background var(--transition-fast);
  }
  .usage-fill.warn { background: var(--amber); }
  .usage-fill.high { background: var(--red); }
  .usage-cost {
    padding-left: 8px;
    border-left: 1px solid var(--w10);
    color: var(--neutral-gray);
  }

  /* Messages — flat timeline, no avatars */
  .msg { display: flex; flex-direction: column; gap: 5px; }
  .msg.user { align-items: flex-end; }
  /* Brief highlight when the Prompts panel jumps the timeline to a message. */
  .msg.flash > .content {
    animation: msg-flash 1.2s ease-out;
  }
  @keyframes msg-flash {
    0% { box-shadow: 0 0 0 3px var(--accent-a25); }
    100% { box-shadow: 0 0 0 3px transparent; }
  }
  /* Per-message copy button, revealed on hover (matches Claude.ai/ChatGPT). The
     windowed timeline means drag-select can't reach a long conversation, so a
     copy affordance per message is the reliable path. */
  .msg-copy, .msg-action { opacity: 0; transition: opacity var(--transition-fast); margin-left: 2px; }
  .msg:hover .msg-copy, .msg:focus-within .msg-copy,
  .msg:hover .msg-action, .msg:focus-within .msg-action { opacity: 1; }
  .msg-foot { display: inline-flex; align-items: center; gap: 2px; }
  .msg-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 27px;
    height: 27px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--gray);
    cursor: pointer;
    padding: 0;
  }
  .msg-action:hover:not(:disabled) { color: var(--bright-white); background: var(--accent-a10); }
  .msg-action:disabled { opacity: 0.35; cursor: not-allowed; }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--font-size-xs);
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--neutral-gray);
    font-family: var(--font-mono);
  }
  .msg-time {
    font-size: var(--font-size-xs);
    font-weight: 500;
    letter-spacing: 0.3px;
    color: var(--neutral-gray);
    font-family: var(--font-mono);
    opacity: 0.7;
    cursor: default;
  }
  .eyebrow .msg-time { text-transform: none; }
  .msg.user .msg-time { padding: 0 2px; }
  .content {
    font-size: var(--font-size-md);
    line-height: 1.65;
    color: var(--white);
  }
  .msg.user .content {
    max-width: 80%;
    padding: 9px 14px;
    border-radius: var(--radius-lg);
    border-bottom-right-radius: 5px;
    background: var(--accent-a18);
    border: 1px solid var(--accent-a25);
    color: var(--bright-white);
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Markdown rules apply to both assistant message bodies (.content) and
     tool-call expanded bodies (.md). */
  ${markdownStyles}

  .thought {
    padding: 4px 0 4px 14px;
    border-left: 2px solid var(--accent-a25);
    font-size: var(--font-size-base);
    color: var(--neutral-gray);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* A run of consecutive tool calls is joined by a thin left rail so it reads as
     one sequence rather than a stack of disconnected boxes. The rail is pure CSS
     adjacency on .tool-wrap, so the live view and the showcase share it. */
  .tool-wrap { padding-left: 14px; position: relative; }
  .tool-wrap::before {
    content: '';
    position: absolute;
    left: 5px; top: 0; bottom: 0;
    width: 1px;
    background: var(--w8);
  }
  /* Tighten spacing within a run: the timeline flex gap is 18px, so -14px nets
     ~4px between consecutive tools. Keep in sync if the .timeline gap changes. */
  .tool-wrap + .tool-wrap { margin-top: -14px; }
  /* Bridge the ~4px inter-row space (18px timeline gap - 14px margin) so the rail
     reads as one continuous line. Keep -4px in sync with the gap/margin above. */
  .tool-wrap:has(+ .tool-wrap)::before { bottom: -4px; }
  /* Round/cap the rail at the start and end of a run. */
  .tool-wrap:not(.tool-wrap + .tool-wrap)::before { top: 8px; border-top-left-radius: 2px; }
  .tool-wrap:not(:has(+ .tool-wrap))::before { bottom: 8px; border-bottom-left-radius: 2px; }

  /* Non-text content blocks (images, audio, resources) */
  .block-image {
    max-width: 100%;
    max-height: 360px;
    border-radius: var(--radius);
    border: 1px solid var(--glass-border);
    display: block;
  }
  .block-audio { width: 100%; max-width: 360px; }
  .block-resource {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    background: var(--w4);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--gray);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .block-resource-icon { color: var(--accent); font-weight: 600; }
  .block-resource-body {
    border: 1px solid var(--w8);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .block-resource-head {
    padding: 4px 10px;
    background: var(--w5);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--gray);
    border-bottom: 1px solid var(--w8);
  }
  .block-resource-body pre {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--white);
    max-height: 300px;
    overflow: auto;
  }
  .block-unknown {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--neutral-gray);
  }

  /* ── Plan ── */
  .plan {
    position: sticky;
    top: 0;
    z-index: 5;
    margin: 0 0 4px;
    padding: 12px 14px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    background: var(--surface-modal);
    backdrop-filter: blur(var(--overlay-blur));
    -webkit-backdrop-filter: blur(var(--overlay-blur));
    box-shadow: var(--widget-shadow);
  }
  .plan-title {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    margin-bottom: 9px;
    font-family: inherit;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--neutral-gray);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    cursor: pointer;
    text-align: left;
  }
  .plan-title:hover { color: var(--white); }
  .plan-title .caret { width: 11px; height: 11px; transition: transform 0.15s ease; flex-shrink: 0; }
  .plan-title.collapsed .caret { transform: rotate(-90deg); }
  .plan-count { color: var(--purple-light); margin-left: auto; font-variant-numeric: tabular-nums; }
  .plan-entry { display: flex; gap: 9px; align-items: baseline; font-size: var(--font-size-base); padding: 2px 0; color: var(--white); }
  .plan-entry.completed { color: var(--neutral-gray); text-decoration: line-through; }
  .plan-entry.in_progress { color: var(--purple-light); font-weight: 500; }
  .plan-check { font-size: var(--font-size-sm); flex-shrink: 0; }

  .system-note {
    text-align: center;
    font-size: var(--font-size-xs);
    color: var(--neutral-gray);
    padding: 2px 0;
  }

  /* highlight.js token colors, scoped to this component's shadow root. */
  ${hljsTheme}
`;
