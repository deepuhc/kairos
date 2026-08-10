import { LitElement, html, css, nothing, svg, type SVGTemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { repeat } from 'lit/directives/repeat.js';
import type { ToolCall, ToolCallContent, DiffContent, ToolCallLocation } from '../services/acp-types.js';
import type { PermissionOption } from '../services/acp-types.js';
import { diffLines, diffStats, collapseContext, pairRows, type DiffRow } from './line-diff.js';
import { highlightLine, hljsTheme } from './code-highlight.js';
import { renderMarkdownCached, markdownStyles } from './markdown.js';
import { stripControlChars, cleanTerminalText } from '../services/sanitize-text.js';
import { subAgentInfo } from './subagent-info.js';
import { skillName } from './skill-info.js';
import { tooltip } from '../directives/tooltip.js';
import { icon } from './icons.js';
import { defaultDiffBodyExpanded, toolBodyOpen } from './agents-tool-state.js';

// Map a file path's extension (or a bare filename) to a highlight.js language
// hint, so diff bodies get the same coloring as fenced code blocks. Diff lines
// with no resolvable hint render as plain escaped text — highlightLine never
// auto-detects per line (see code-highlight.ts), so the broader this map, the
// more diffs get colored without paying an auto-detect cost.
export function langFromPath(path: string): string | undefined {
  const file = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName: Record<string, string> = {
    dockerfile: 'dockerfile', makefile: 'bash', '.gitignore': 'bash',
    '.bashrc': 'bash', '.zshrc': 'bash',
  };
  if (byName[file]) return byName[file];
  const ext = file.slice(file.lastIndexOf('.') + 1);
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', pyi: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hh: 'cpp',
    cs: 'csharp', php: 'php', pl: 'perl', pm: 'perl', lua: 'lua',
    sh: 'bash', bash: 'bash', zsh: 'bash', json: 'json', jsonc: 'json',
    yml: 'yaml', yaml: 'yaml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'css', sass: 'css', less: 'css', md: 'markdown',
    markdown: 'markdown', sql: 'sql', toml: 'ini', ini: 'ini', cfg: 'ini',
    conf: 'ini', m: 'matlab',
  };
  return map[ext];
}

// True while the user has an active (non-collapsed) text selection. A drag-select
// of the header title (often a file path) ends in a click, which would otherwise
// collapse the card; skip the toggle so copying a path doesn't fold the pane.
function hasTextSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && sel.type === 'Range' && sel.toString().trim().length > 0;
}

// Below this card width there isn't room for two readable columns, so the diff
// renders as a stacked (unified) view regardless of the user's preference.
const SIDE_BY_SIDE_MIN_WIDTH = 620;

export interface ToolPermission {
  requestId: string;
  options: PermissionOption[];
}

const KIND_ICON: Record<string, SVGTemplateResult> = {
  read: svg`<path d="M3.5 3h5l1 1h3v8.5h-9z"/><path d="M5.5 7h5M5.5 9.5h3"/>`,
  edit: svg`<path d="M10.5 2.5l3 3M11.5 1.5l3 3-8 8-3.5.5.5-3.5z"/>`,
  delete: svg`<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.5 7v4M9.5 7v4"/>`,
  move: svg`<path d="M3 8h9M9 5l3 3-3 3"/>`,
  search: svg`<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>`,
  execute: svg`<path d="M3.5 5l3 3-3 3M8 11.5h4.5"/>`,
  think: svg`<path d="M8 2a4 4 0 0 0-2.4 7.2c.3.3.4.6.4 1V11h4v-.8c0-.4.1-.7.4-1A4 4 0 0 0 8 2z"/><path d="M6.5 13h3"/>`,
  fetch: svg`<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12"/>`,
  other: svg`<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>`,
  // Delegated sub-agent (Task tool): two linked nodes — a parent handing off to a child.
  subagent: svg`<circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><path d="M4 6v3.5A2.5 2.5 0 0 0 6.5 12H10"/>`,
};

@customElement('agents-tool-call')
export class AgentsToolCall extends LitElement {
  @property({ attribute: false }) tool!: ToolCall;
  @property({ attribute: false }) terminalOutput?: string;
  @property({ attribute: false }) permission?: ToolPermission;
  // Lookups for nested sub-agent tool calls (children of a Task card), so each
  // child card can resolve its own terminal output and pending permission.
  @property({ attribute: false }) terminalOutputFor?: (terminalId: string) => string | undefined;
  @property({ attribute: false }) permissionFor?: (toolCallId: string) => ToolPermission | undefined;
  // Force the body open regardless of content — used by the Behind the Scenes
  // showcase so its example tool card shows the diff instead of resting collapsed.
  @property({ type: Boolean }) startExpanded = false;
  // Legacy hint from replayed sessions. Inline diffs now stay collapsed by
  // default for every session; this remains accepted so older render contexts
  // do not need special casing.
  @property({ type: Boolean }) collapseReplayDiffs = false;
  // Move focus to the Allow button when a live permission prompt appears, so it's
  // keyboard-resolvable. Off by default so the static Behind the Scenes showcase
  // (which renders an example permission) never steals focus; the interactive
  // timeline opts in.
  @property({ type: Boolean }) autofocusPermission = false;
  @state() private expanded = false;
  @state() private rawOpen = false;
  // True once the user has clicked the header. Inline diffs default collapsed;
  // after a manual toggle the user's choice wins.
  private userToggled = false;
  // Last non-empty sub-agent title we rendered. A `tool_call_update` can briefly
  // arrive without a description; latching the last good title keeps the header
  // from flickering back to the bare "Task" fallback.
  private lastSubTitle = '';
  // User's diff layout preference; null = follow available width (auto).
  @state() private splitPref: boolean | null = null;
  // Gaps the user has expanded to reveal hidden context, keyed by gapKey().
  @state() private expandedGaps = new Set<string>();
  // Only reactive at the split/unified breakpoint. The side panel resizing the
  // chat column can fire ResizeObserver for every visible tool card; exact
  // widths would rerender large diffs even when their layout mode is unchanged.
  @state() private fitsSplit = true;

  private resizeObserver?: ResizeObserver;

  // Memoize the LCS diff per (oldText, newText). renderDiff and collapsedSummary
  // both need diffLines+diffStats of the same content, and every re-render
  // (streaming children, layout toggles, breakpoint changes) otherwise re-runs
  // the O(n·m) LCS from scratch — the expensive case for
  // Codex's whole-file diffs. Tool content is immutable once complete, so a
  // single-entry cache keyed on identity is a safe, cheap hit.
  private diffMemo: { oldText: string; newText: string; rows: DiffRow[]; added: number; removed: number } | null = null;

  private computeDiff(oldText: string, newText: string): { rows: DiffRow[]; added: number; removed: number } {
    const memo = this.diffMemo;
    if (memo && memo.oldText === oldText && memo.newText === newText) return memo;
    const rows = diffLines(oldText, newText);
    const { added, removed } = diffStats(rows);
    this.diffMemo = { oldText, newText, rows, added, removed };
    return this.diffMemo;
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (!w) return;
      const nextFits = w >= SIDE_BY_SIDE_MIN_WIDTH;
      if (nextFits !== this.fitsSplit) this.fitsSplit = nextFits;
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    super.disconnectedCallback();
  }

  static styles = [hljsTheme, markdownStyles, css`
    :host { display: block; }
    .card {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w3);
      overflow: hidden;
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }
    .card:hover { border-color: var(--glass-border-hover); background: var(--w4); }
    .card.awaiting {
      border-color: var(--accent-a35);
      box-shadow: 0 0 0 1px var(--accent-a25), 0 0 18px -4px var(--accent-a25);
    }
    .card.awaiting:hover { border-color: var(--accent); }
    /* Lightweight row for tools without diff/terminal payload — no border or
       fill, tighter padding, secondary-colored title. Keeps a run of reads and
       searches reading as a sequence instead of a stack of boxes. */
    .row { border-radius: var(--radius-sm); transition: background var(--transition-fast); }
    .row:hover { background: var(--w3); }
    .row .head { padding: 5px 8px; gap: 8px; }
    .row .icon { width: 18px; height: 18px; background: transparent; }
    .row .title { color: var(--gray); }
    /* Animate a card body open/closed via grid-rows. The transition only plays
       for user-initiated toggles; auto-open/auto-collapse skip it so rapid tool
       completions don't produce jittery half-clipped states. */
    .body-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows var(--transition-base);
    }
    .body-wrap.open { grid-template-rows: 1fr; }
    .body-wrap.no-anim { transition: none; }
    /* The grid child must clip to zero height when collapsed. .body carries
       padding + a top border that min-height:0 can't shrink, so it would leak
       ~21px (a peeking first line) below the header. A padding-free clip wrapper
       keeps those inside the collapsible box. */
    .body-clip { overflow: hidden; min-height: 0; }
    @media (prefers-reduced-motion: reduce) { .body-wrap { transition: none; } }
    /* Collapsed-card summary (e.g. "+12 −3" or a terminal's first line). */
    .summary {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 1;
      min-width: 0;
      user-select: text;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 11px;
      cursor: default;
      user-select: none;
    }
    .head.clickable { cursor: pointer; }
    .icon {
      width: 20px; height: 20px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: var(--radius-sm);
      background: var(--w6);
      color: var(--gray);
    }
    .icon svg { display: block; }
    .title {
      flex: 1;
      font-size: var(--font-size-base);
      color: var(--white);
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: text;
    }
    .status-dot {
      width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    }
    .status-dot.pending { background: var(--neutral-gray); }
    .status-dot.completed { background: var(--emerald); }
    .status-dot.failed { background: var(--red); }
    /* A satisfying one-shot pop when a tool resolves, instead of an abrupt swap. */
    @media (prefers-reduced-motion: no-preference) {
      .status-dot.completed, .status-dot.failed { animation: dot-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) 1; }
    }
    @keyframes dot-pop {
      0% { transform: scale(0); }
      70% { transform: scale(1.4); }
      100% { transform: scale(1); }
    }
    .spinner {
      width: 12px; height: 12px;
      border: 2px solid var(--accent-a25);
      border-top-color: var(--purple-light);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .chevron { display: inline-flex; color: var(--neutral-gray); transition: transform var(--transition-fast); }
    .chevron svg { display: block; }
    .chevron.open { transform: rotate(90deg); }
    .body {
      border-top: 1px solid var(--w8);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    pre {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--white);
    }
    .term {
      background: var(--blue-gray);
      border: 1px solid var(--w8);
      border-radius: var(--radius);
      padding: 8px 10px;
      max-height: 300px;
      overflow: auto;
    }
    .term pre { color: var(--white); }
    .diff {
      border: 1px solid var(--w8);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .diff-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px 4px 10px;
      background: var(--w5);
      border-bottom: 1px solid var(--w8);
    }
    .diff-path {
      flex: 1;
      min-width: 0;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .diff-stat {
      display: inline-flex;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      flex-shrink: 0;
    }
    .stat-add { color: var(--emerald); }
    .stat-del { color: var(--red); }
    .diff-layout {
      flex-shrink: 0;
      padding: 2px 9px;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-xs);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .diff-layout:hover { border-color: var(--accent-a35); background: var(--accent-a15); color: var(--white); }

    /* Shared row chrome. A monospace gutter holds line numbers; the code column
       holds the (syntax-highlighted) line. No +/− glyphs — changed lines are
       marked by a tinted background and a colored left accent bar, matching the
       diff styling in Cursor/VS Code/Codex. */
    .diff-body { overflow-x: auto; }
    .drow, .dcell {
      display: grid;
      align-items: baseline;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      min-height: calc(var(--font-size-sm) * 1.5);
    }
    .drow { grid-template-columns: auto auto 1fr; }
    .gutter {
      padding: 0 7px;
      text-align: right;
      color: var(--neutral-gray);
      opacity: 0.6;
      user-select: none;
      font-variant-numeric: tabular-nums;
    }
    .code { white-space: pre-wrap; word-break: break-word; padding: 0 10px; color: var(--white); }
    .add { background: var(--green-a10); box-shadow: inset 2px 0 0 var(--emerald); }
    .del { background: var(--red-a15); box-shadow: inset 2px 0 0 var(--red); }
    .gap {
      display: block;
      width: 100%;
      padding: 2px 10px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      text-align: left;
      color: var(--neutral-gray);
      background: var(--w3);
      border: none;
      border-top: 1px solid var(--w8);
      border-bottom: 1px solid var(--w8);
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .gap:hover { color: var(--white); background: var(--w4); }

    /* Split view: two aligned columns with a divider down the middle. */
    .diff-body.split {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .dcell { grid-template-columns: auto 1fr; border-bottom: 0; }
    .dcell:nth-child(odd) { border-right: 1px solid var(--w8); }
    .dcell.empty { background: var(--w3); }
    .locations { display: flex; flex-wrap: wrap; gap: 6px; }
    .location {
      display: inline-block;
      padding: 3px 9px;
      border-radius: var(--radius);
      border: 1px solid var(--w8);
      background: var(--w5);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--gray);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .location-line { color: var(--accent); }
    .raw-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      background: none;
      border: none;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    .raw-toggle:hover { color: var(--white); }
    .raw-label {
      font-size: var(--font-size-xs);
      color: var(--gray);
      margin: 6px 0 2px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    /* Sub-agent (Task) card chrome. The badge pill names the delegated agent
       type; the body shows the task prompt and, on completion, its report. */
    .subagent-badge {
      flex-shrink: 0;
      padding: 2px 9px;
      border-radius: 999px;
      border: 1px solid var(--accent-a25);
      background: var(--accent-a15);
      color: var(--accent);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .subagent-section { display: flex; flex-direction: column; gap: 4px; }
    .subagent-desc { font-size: var(--font-size-base); color: var(--white); }
    .subagent-pending { color: var(--neutral-gray); font-style: italic; }
    /* The sub-agent's own tool calls, nested under the Task. A thin left rail
       ties the run together and sets it apart from the parent card's body. */
    .subagent-steps {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-left: 2px;
      padding-left: 10px;
      border-left: 1px solid var(--w10);
    }
    .subagent-steps .tool-wrap { padding-left: 0; }
    .perm {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 11px;
      border-top: 1px solid var(--w8);
      background: var(--accent-a10);
      flex-wrap: wrap;
    }
    .perm-label {
      flex: 1 1 auto;
      min-width: 0;
      font-size: var(--font-size-sm);
      color: var(--white);
    }
    .perm-options { display: flex; gap: 6px; flex-wrap: wrap; }
    .perm-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    /* Keyboard hint trailing the options — quiet, so it reads as an affordance
       cue not a control. Hidden on narrow cards where the buttons wrap. */
    .perm-hint {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: auto;
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      white-space: nowrap;
    }
    .perm-hint kbd {
      font-family: var(--font-mono);
      font-size: 10px;
      background: var(--w8);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      padding: 0 4px;
    }
    @media (max-width: 460px) { .perm-hint { display: none; } }
    .perm-btn {
      padding: 5px 11px;
      border-radius: var(--radius);
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .perm-btn:hover { border-color: var(--accent-a35); background: var(--accent-a15); color: var(--bright-white); }
    .perm-btn.allow { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    .perm-btn.allow:hover { background: var(--purple); }
    .perm-btn.reject:hover { border-color: var(--red); background: var(--red-a15); color: var(--red); }
  `];

  render() {
    const content = this.tool.content ?? [];
    const locations = this.tool.locations ?? [];
    const hasRaw = this.tool.rawInput !== undefined || this.tool.rawOutput !== undefined;
    const status = this.tool.status ?? 'pending';
    const awaiting = !!this.permission;
    // Diffs and terminal output are payload worth a bordered card; everything
    // else (read/search/think/fetch, plain content, raw-only) is a lightweight
    // row, so a run of tool calls reads as a sequence rather than stacked boxes.
    const hasDiff = content.some((c) => c.type === 'diff');
    const payload = hasDiff || content.some((c) => c.type === 'terminal');
    // A delegated sub-agent (Task tool) is always a card: it carries a task
    // prompt and a report worth reading, not a one-line status.
    const sub = subAgentInfo(this.tool);
    const card = payload || awaiting || this.startExpanded || !!sub;
    // The raw JSON only earns its place when nothing richer conveys the payload
    // (a bare tool call whose sole record is rawInput/rawOutput) or when the call
    // failed and the raw output is the diagnostic. A diff/terminal/text block or
    // sub-agent report already shows the same thing, so suppress the duplicate.
    const richlyRendered = !!sub || content.length > 0;
    const showRaw = hasRaw && (!richlyRendered || status === 'failed');
    const hasBody = sub ? true : content.length > 0 || locations.length > 0 || showRaw;
    // Diff bodies default collapsed. Large inline diffs dominate layout/paint
    // work during session switches and side-panel toggles; users can still
    // expand a specific card or use the Review panel for full-file diffs.
    const bodyOpen = toolBodyOpen({
      hasBody,
      expanded: this.expanded,
      startExpanded: this.startExpanded,
      defaultExpanded: defaultDiffBodyExpanded(hasDiff, status, this.collapseReplayDiffs),
      awaiting,
      userToggled: this.userToggled,
      isSubAgent: !!sub,
    });
    const summary = !bodyOpen
      ? (sub ? this.subAgentSummary(sub, status) : payload ? this.collapsedSummary(content) : nothing)
      : nothing;
    // The task description is the most useful label; the badge carries the agent
    // type. `sub.description` is our own derived field (stable once rawInput
    // arrives), but a later update can momentarily drop it, so latch the last
    // good value to avoid the header flickering back to "Task".
    let title: string;
    if (sub) {
      const subTitle = sub.description || sub.type || this.lastSubTitle || 'Task';
      if (subTitle !== 'Task') this.lastSubTitle = subTitle;
      title = subTitle;
    } else {
      // A Skill invocation's own title is a generic "Skill"; surface the skill
      // name (e.g. "code-review") so the collapsed header says what's running.
      const skill = skillName(this.tool);
      // A Bash/execute tool puts the command in `title`; agents sometimes emit
      // control chars into it, which render as tofu boxes. Strip them.
      title = skill ? `Skill: ${skill}` : stripControlChars(this.tool.title ?? this.tool.kind ?? 'Tool call');
    }

    const head = html`
      <div class="head ${hasBody ? 'clickable' : ''}" @click=${() => { if (hasBody && !hasTextSelection()) { this.userToggled = true; this.expanded = !bodyOpen; } }}>
        <span class="icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            ${sub ? KIND_ICON.subagent : KIND_ICON[this.tool.kind ?? 'other'] ?? KIND_ICON.other}
          </svg>
        </span>
        <span class="title">${title}</span>
        ${sub && sub.type ? html`<span class="subagent-badge">${sub.type}</span>` : nothing}
        ${summary !== nothing ? html`<span class="summary">${summary}</span>` : nothing}
        ${status === 'in_progress'
          ? html`<span class="spinner"></span>`
          : html`<span class="status-dot ${status}" ${tooltip(status)}></span>`}
        ${hasBody ? html`<span class="chevron ${bodyOpen ? 'open' : ''}">${icon.chevronRight(12)}</span>` : nothing}
      </div>`;

    const body = html`
      <div class="body">
        ${sub ? this.renderSubAgent(sub, status) : nothing}
        ${sub ? nothing : locations.length ? this.renderLocations(locations) : nothing}
        ${sub ? nothing : content.map((c, i) => this.renderContent(c, i))}
        ${showRaw ? this.renderRaw() : nothing}
      </div>`;

    if (!card) {
      // Rows have trivial bodies — toggle them instantly, no mounted animation.
      return html`
        <div class="row">
          ${head}
          ${bodyOpen ? body : nothing}
        </div>`;
    }

    // Keep collapsed payload cards unmounted. Session switching is otherwise
    // dominated by laying out hidden historical diffs, especially with long
    // Codex conversations.
    return html`
      <div class="card ${awaiting ? 'awaiting' : ''}">
        ${head}
        ${hasBody && bodyOpen ? html`<div class="body-wrap open ${!this.userToggled ? 'no-anim' : ''}"><div class="body-clip">${body}</div></div>` : nothing}
        ${this.permission ? this.renderPermission(this.permission) : nothing}
      </div>
    `;
  }

  // Dense one-line summary shown in the header when a payload card is collapsed.
  // Keep diff summaries constant-time; exact +/- stats require diffing and are
  // available after expanding the card or opening Review.
  private collapsedSummary(content: ToolCallContent[]) {
    const diff = content.find((c) => c.type === 'diff') as DiffContent | undefined;
    if (diff) {
      return 'diff hidden';
    }
    // Clean only the line we keep, not the whole (up to 2 MB) buffer.
    const rawLine = this.terminalOutput?.split('\n').find((l) => l.trim());
    const firstLine = rawLine != null ? cleanTerminalText(rawLine) : undefined;
    if (firstLine) return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    return nothing;
  }

  // Compact status shown in a collapsed Task header: a live step count while the
  // sub-agent runs (the header spinner carries the motion), or a quiet
  // done/failed once it settles. Lets a stack of concurrent Tasks read as a
  // scannable list without expanding any of them.
  private subAgentSummary(_sub: import('./subagent-info.js').SubAgentInfo, status: string) {
    const n = this.tool.children?.length ?? 0;
    const steps = n ? `${n} step${n === 1 ? '' : 's'}` : '';
    if (status === 'failed') return steps ? `${steps} · failed` : 'failed';
    if (status === 'completed') return steps ? `${steps} · done` : 'done';
    return steps || 'starting…';
  }

  // When a permission prompt first appears, move focus to the primary Allow
  // button so the keyboard alone can resolve it — Enter/Space activates the
  // focused button, Esc rejects (handled below), Tab cycles the options. This is
  // the app's most frequent interruption, so removing the mouse trip matters.
  updated(changed: Map<string, unknown>) {
    if (this.autofocusPermission && changed.has('permission') && this.permission) {
      this.updateComplete.then(() => {
        (this.renderRoot.querySelector('.perm-btn.allow') as HTMLElement | null)?.focus();
      });
    }
  }

  private renderPermission(p: ToolPermission) {
    const firstReject = p.options.find((o) => o.kind.startsWith('reject'));
    return html`
      <div class="perm" @keydown=${(e: KeyboardEvent) => this.onPermKeydown(e, p, firstReject)}>
        <span class="perm-label">Approve this action?</span>
        <span class="perm-options">
          ${p.options.map((o) => html`
            <button
              class="perm-btn ${o.kind.startsWith('allow') ? 'allow' : 'reject'}"
              @click=${(e: Event) => { e.stopPropagation(); this.choose(p.requestId, o); }}
            >${o.name}</button>
          `)}
        </span>
        <span class="perm-hint">
          <kbd>↵</kbd> allow${firstReject ? html` · <kbd>Esc</kbd> reject` : nothing}
        </span>
      </div>
    `;
  }

  // Esc rejects the pending prompt (the mouse-free counterpart to Enter on the
  // auto-focused Allow button). Only fires while focus is within the card.
  private onPermKeydown(e: KeyboardEvent, p: ToolPermission, reject?: PermissionOption) {
    if (e.key === 'Escape' && reject) {
      e.preventDefault();
      e.stopPropagation();
      this.choose(p.requestId, reject);
    }
  }

  private choose(requestId: string, option: PermissionOption) {
    this.dispatchEvent(new CustomEvent('permission-choice', {
      detail: { requestId, outcome: { outcome: 'selected', optionId: option.optionId } },
      bubbles: true,
      composed: true,
    }));
  }

  private renderContent(c: ToolCallContent, index = 0) {
    if (c.type === 'diff') return this.renderDiff(c);
    if (c.type === 'terminal') {
      // Not xterm — a plain <pre>, so strip ANSI escapes and control chars from
      // colored/raw command output before display.
      const out = this.terminalOutput != null ? cleanTerminalText(this.terminalOutput) : '(waiting for output…)';
      return html`<div class="term"><pre>${out}</pre></div>`;
    }
    if (c.type === 'content') {
      const block = c.content;
      if (block && block.type === 'text') {
        // Cache by toolCallId+index — tool text is immutable once the tool
        // settles, so this avoids re-parsing markdown on every re-render (e.g.
        // resize, streaming children). The cache's text-equality guard makes a
        // stale key harmless.
        return html`<div class="md">${renderMarkdownCached(`${this.tool.toolCallId}:content:${index}`, (block as { text: string }).text)}</div>`;
      }
      return html`<pre>${stripControlChars(JSON.stringify(block, null, 2))}</pre>`;
    }
    return nothing;
  }

  // Affected files reported by the agent. Display-only: Kairos has no file
  // viewer to open them in, but showing which paths a tool touched gives the
  // same follow-along context as best-in-class agent UIs.
  private renderLocations(locations: ToolCallLocation[]) {
    return html`
      <div class="locations">
        ${locations.map((loc) => html`
          <span class="location" ${tooltip(loc.path)}>
            ${loc.path}${loc.line != null ? html`<span class="location-line">:${loc.line}</span>` : nothing}
          </span>
        `)}
      </div>
    `;
  }

  // The delegated task and, once the sub-agent finishes, its report. The prompt
  // is the instruction we handed off; the report is what came back. The raw
  // input/output payload is suppressed unless the task failed (see showRaw).
  private renderSubAgent(sub: import('./subagent-info.js').SubAgentInfo, status: string) {
    const running = status !== 'completed' && status !== 'failed';
    const children = this.tool.children ?? [];
    return html`
      <div class="subagent-section">
        ${sub.description ? html`<div class="subagent-desc">${sub.description}</div>` : nothing}
        ${sub.prompt ? html`<div class="md">${renderMarkdownCached(`${this.tool.toolCallId}:sub-prompt`, sub.prompt)}</div>` : nothing}
      </div>
      ${children.length ? this.renderSubAgentSteps(children) : nothing}
      <div class="raw-label">Report</div>
      ${sub.report
        ? html`<div class="md">${renderMarkdownCached(`${this.tool.toolCallId}:sub-report`, sub.report)}</div>`
        : html`<div class="subagent-pending">${running ? 'Sub-agent running…' : '(no report)'}</div>`}
    `;
  }

  // The sub-agent's own tool calls, nested inside the Task card so its work reads
  // as belonging to the sub-agent rather than the main agent. Each child renders
  // as an ordinary tool-call card, resolving its terminal/permission via the
  // lookups threaded down from the timeline.
  private renderSubAgentSteps(children: ToolCall[]) {
    return html`
      <div class="raw-label">Steps</div>
      <div class="subagent-steps">
        ${repeat(children, (child) => child.toolCallId, (child) => {
          const term = child.content?.find((c) => c.type === 'terminal') as { terminalId: string } | undefined;
          return html`<div class="tool-wrap"><agents-tool-call
            .tool=${child}
            .terminalOutput=${term ? this.terminalOutputFor?.(term.terminalId) : undefined}
            .permission=${this.permissionFor?.(child.toolCallId)}
            .collapseReplayDiffs=${this.collapseReplayDiffs}
            .terminalOutputFor=${this.terminalOutputFor}
            .permissionFor=${this.permissionFor}
          ></agents-tool-call></div>`;
        })}
      </div>
    `;
  }

  private renderRaw() {
    // Keep this "raw" — strip only control chars (tofu), not ANSI.
    const fmt = (v: unknown) => stripControlChars(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    return html`
      <div class="raw">
        <button class="raw-toggle" @click=${(e: Event) => { e.stopPropagation(); this.rawOpen = !this.rawOpen; }}>
          <span class="chevron ${this.rawOpen ? 'open' : ''}">${icon.chevronRight(12)}</span> Raw input / output
        </button>
        ${this.rawOpen ? html`
          ${this.tool.rawInput !== undefined ? html`<div class="raw-label">Input</div><pre>${fmt(this.tool.rawInput)}</pre>` : nothing}
          ${this.tool.rawOutput !== undefined ? html`<div class="raw-label">Output</div><pre>${fmt(this.tool.rawOutput)}</pre>` : nothing}
        ` : nothing}
      </div>
    `;
  }

  private renderDiff(d: DiffContent) {
    const { rows: allRows, added, removed } = this.computeDiff(d.oldText ?? '', d.newText ?? '');
    // Claude usually sends edit-sized hunks; Codex can send whole-file
    // oldText/newText. Collapse unchanged runs so inline tool cards stay small.
    const collapsedRows = collapseContext(allRows);
    const rows = collapsedRows.flatMap((r) =>
      r.type === 'gap' && this.expandedGaps.has(this.gapKey(d.path, r))
        ? r.hidden ?? [r]
        : [r]);
    const lang = langFromPath(d.path);
    // Side-by-side only when the user asked for it (or hasn't chosen and the
    // card is wide enough) AND the edit actually replaces text — a pure
    // creation has no left column worth splitting.
    const wantSplit = this.splitPref ?? this.fitsSplit;
    const split = wantSplit && this.fitsSplit && !!d.oldText;

    return html`
      <div class="diff">
        <div class="diff-head">
          <span class="diff-path" ${tooltip(d.path)}>${d.path}</span>
          <span class="diff-stat">
            ${added ? html`<span class="stat-add">+${added}</span>` : nothing}
            ${removed ? html`<span class="stat-del">−${removed}</span>` : nothing}
          </span>
          ${d.oldText && this.fitsSplit ? html`
            <button
              class="diff-layout"
              ${tooltip(split ? 'Switch to unified view' : 'Switch to side-by-side view')}
              @click=${(e: Event) => { e.stopPropagation(); this.splitPref = !split; }}
            >${split ? 'Unified' : 'Split'}</button>
          ` : nothing}
        </div>
        ${split ? this.renderDiffSplit(d.path, rows, lang) : this.renderDiffUnified(d.path, rows, lang)}
      </div>
    `;
  }

  // Stacked view: deletions then their replacement additions, in source order.
  private renderDiffUnified(path: string, rows: DiffRow[], lang?: string) {
    return html`
      <div class="diff-body unified">
        ${rows.map((r) => {
          if (r.type === 'gap') return this.gapRow(path, r, 3);
          const text = r.type === 'del' ? r.oldText! : r.newText ?? r.oldText ?? '';
          return html`<div class="drow ${r.type}">
            <span class="gutter">${r.oldLine ?? ''}</span>
            <span class="gutter">${r.newLine ?? ''}</span>
            <span class="code">${this.hl(text, lang)}</span>
          </div>`;
        })}
      </div>
    `;
  }

  // Two-column view: old on the left, new on the right, aligned row-for-row.
  // A del with no matching add (or vice-versa) leaves the opposite cell empty.
  private renderDiffSplit(path: string, rows: DiffRow[], lang?: string) {
    const pairs = pairRows(rows);
    return html`
      <div class="diff-body split">
        ${pairs.map((p) => p.left?.type === 'gap'
          ? this.gapRow(path, p.left, 2)
          : html`
          <div class="dcell ${p.left ? p.left.type : 'empty'}">
            <span class="gutter">${p.left?.oldLine ?? ''}</span>
            <span class="code">${p.left ? this.hl(p.left.oldText ?? '', lang) : nothing}</span>
          </div>
          <div class="dcell ${p.right ? p.right.type : 'empty'}">
            <span class="gutter">${p.right?.newLine ?? ''}</span>
            <span class="code">${p.right ? this.hl(p.right.newText ?? '', lang) : nothing}</span>
          </div>
        `)}
      </div>
    `;
  }

  // Stable key for a gap within a file: line bounds are deterministic for a
  // given diff, so expanding one hidden context run survives re-rendering.
  private gapKey(path: string, r: DiffRow): string {
    return `${path}@${r.oldLine ?? ''}-${r.newLine ?? ''}`;
  }

  private expandGapAt(path: string, r: DiffRow) {
    const next = new Set(this.expandedGaps);
    next.add(this.gapKey(path, r));
    this.expandedGaps = next;
  }

  private gapRow(path: string, r: DiffRow, cols: number) {
    const n = r.count ?? 0;
    return html`<button
      class="gap"
      style="grid-column: span ${cols}"
      ${tooltip('Expand hidden lines')}
      @click=${() => this.expandGapAt(path, r)}
    >⋯ Expand ${n} unchanged ${n === 1 ? 'line' : 'lines'}</button>`;
  }

  // Highlight one diff line. Empty lines render a non-breaking line box so the
  // row keeps its height.
  private hl(text: string, lang?: string) {
    if (text === '') return html`<br />`;
    return unsafeHTML(highlightLine(text, lang));
  }
}
