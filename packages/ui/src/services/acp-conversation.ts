import type {
  AvailableCommand,
  ContentBlock,
  SessionUpdate,
  TimelineItem,
  ToolCall,
  ToolCallContent,
  PlanEntry,
  UsageInfo,
  CacheUsage,
  TurnUsage,
} from './acp-types.js';
import { exitPlanDoc } from '../components/exit-plan-doc.js';

// Prompt the Summary panel's "Generate summary" button sends. Owned here so
// Conversation can recognise a summary turn on its own during history replay
// (where the sending view's pendingSummary flag isn't set).
export const SUMMARY_PROMPT =
  'Summarize the changes you made in this session as concise markdown. ' +
  'Group by file, and for each explain what changed and why. ' +
  'Keep it scannable — a short intro, then per-file bullets. Do not modify any files.';

// Folds the ordered stream of session/update events into a flat render timeline.
// Message chunks of the same role coalesce into one bubble until a different
// item type interrupts them. Tool calls update in place by toolCallId.
export class Conversation {
  items: TimelineItem[] = [];
  // Bumps on any visible timeline-item change. The array may keep the same
  // identity during streaming so hot-path updates avoid O(history) copies; UI
  // code should use this counter, not array identity, as the render dependency.
  version = 0;
  // Bumps only when item order/length changes. Caches that depend on item
  // positions but not streamed text (prompt index, rendered window shape) can
  // key on this and avoid recomputing for every token.
  structureVersion = 0;
  plan: PlanEntry[] = [];
  // The full plan markdown the agent presents in plan mode (Claude's
  // ExitPlanMode tool), distinct from the `plan` checklist. Latest wins.
  planDoc = '';
  commands: AvailableCommand[] = [];
  // Latest context-window usage from usage_update events; null until the first
  // turn reports it (or for resumed sessions before any new turn runs).
  usage: UsageInfo | null = null;
  private cacheTotals: CacheUsage | null = null;
  private turnTimestamps: number[] = [];
  private compactionSeen = false;
  private seq = 0;
  private readonly toolIndex = new Map<string, number>();
  // Sub-agent tool calls: their toolCallId → the toolCallId of the Task that
  // spawned them, so an in-place update can find its nested child.
  private readonly childParent = new Map<string, string>();
  private lastMessageKey: string | null = null;
  // While capturing, a summary turn is diverted out of the timeline into
  // capturedText so it renders only in the Review panel, not the chat.
  private capturing = false;
  private capturedText = '';
  // Background tasks (Bash / Agent with run_in_background) detach from the turn:
  // the prompt resolves while they keep running, so the session would read
  // "Done" while work continues. A launch is a tool call whose rawInput sets
  // run_in_background; its completion arrives later as a <task-notification>
  // user turn. The notification's task-id isn't the tool-call id, so we can't
  // correlate the two directly — instead we count: outstanding = launches seen
  // − completion notifications seen, floored at zero. Replay-safe, since a task
  // launched and finished within history nets to zero.
  private readonly backgroundLaunchIds = new Set<string>();
  private backgroundDoneCount = 0;

  reset(): void {
    this.items = [];
    this.bumpItems(true);
    this.plan = [];
    this.planDoc = '';
    this.commands = [];
    this.usage = null;
    this.cacheTotals = null;
    this.turnTimestamps = [];
    this.compactionSeen = false;
    this.toolIndex.clear();
    this.childParent.clear();
    this.lastMessageKey = null;
    this.capturing = false;
    this.capturedText = '';
    this.backgroundLaunchIds.clear();
    this.backgroundDoneCount = 0;
  }

  /** How many background tasks (run_in_background Bash/Agent launches) are still
   *  running — i.e. launched but not yet reported complete via a
   *  <task-notification>. Drives the "still working" state after the turn ends. */
  get backgroundActiveCount(): number {
    return Math.max(0, this.backgroundLaunchIds.size - this.backgroundDoneCount);
  }

  /** Zero out background-task tracking. Called once history replay finishes on
   *  resume: any task launched in a prior process died with that subprocess, so
   *  a launch whose completion notification never made it into the on-disk
   *  history must not leave the resumed session stuck "working". */
  clearBackgroundTracking(): void {
    this.backgroundLaunchIds.clear();
    this.backgroundDoneCount = 0;
  }

  /** Start diverting the next turn's chunks into the summary buffer instead
   * of the timeline. Called before sending the summary prompt. */
  beginCapture(): void {
    this.capturing = true;
    this.capturedText = '';
  }

  /** Stop diverting and return the captured summary text. */
  endCapture(): string {
    this.capturing = false;
    return this.capturedText;
  }

  /** The captured summary text without ending capture. */
  get captured(): string {
    return this.capturedText;
  }

  /** Append a finalized user message (what we just sent). */
  pushUserText(text: string): void {
    this.pushUserMessage(text, []);
  }

  /** Append a finalized user turn: its text bubble (if any) followed by any
   * attachment blocks (images, files), echoing what we sent to the agent. */
  pushUserMessage(text: string, attachments: ContentBlock[]): void {
    const added: TimelineItem[] = [];
    if (text) added.push({ kind: 'message', id: `u${this.seq++}`, role: 'user', text, ts: Date.now() });
    for (const block of attachments) {
      added.push({ kind: 'block', id: `b${this.seq++}`, role: 'user', block });
    }
    if (added.length) {
      this.items.push(...added);
      this.bumpItems(true);
    }
    this.lastMessageKey = null;
  }

  /** Append a local-only UI hint (e.g. "turn interrupted by reload"). Not sent to the agent. */
  pushSystemNote(text: string): void {
    this.items.push({ kind: 'note', id: `n${this.seq++}`, text });
    this.bumpItems(true);
    this.lastMessageKey = null;
  }

  apply(update: SessionUpdate): void {
    if (update.sessionUpdate === 'user_message_chunk') {
      const text = textOf((update as { content: ContentBlock }).content);
      // Claude's background tasks (Bash run_in_background) report completion by
      // injecting a <task-notification> block as a user turn. Rendering it raw
      // makes internal plumbing look like something the user typed; collapse it
      // into a compact system note instead. Covers live turns and history replay.
      const taskNote = taskNotification(text);
      if (taskNote) {
        // A background task just reported terminal status — one fewer running.
        this.completeBackgroundTask(taskNote.taskId);
        this.pushSystemNote(taskNote.note);
        return;
      }
      // A summary prompt (live send or replayed from history) opens capture;
      // any other user turn closes it — but keep the buffer so the last
      // summary survives to the load-complete read.
      if (text === SUMMARY_PROMPT) {
        this.beginCapture();
        return;
      }
      if (this.capturing) this.capturing = false;
    }
    // While capturing, divert the summary reply's text into the buffer and
    // drop its other chunks so nothing from the turn reaches the timeline.
    if (this.capturing) {
      switch (update.sessionUpdate) {
        case 'agent_message_chunk':
          this.capturedText = appendAssistantText(this.capturedText, textOf((update as { content: ContentBlock }).content));
          return;
        case 'agent_thought_chunk':
        case 'tool_call':
        case 'tool_call_update':
        case 'plan':
          return;
        default:
          break; // usage/commands are session-global — let them through.
      }
    }
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.appendChunk('user', (update as { content: ContentBlock }).content);
        break;
      case 'agent_message_chunk':
        this.appendChunk('assistant', (update as { content: ContentBlock }).content);
        this.reconcileBackgroundFromAssistant();
        break;
      case 'agent_thought_chunk':
        this.appendThought(textOf((update as { content: ContentBlock }).content));
        break;
      case 'tool_call':
        this.upsertTool(update as unknown as ToolCall, true, parentToolUseId(update));
        this.capturePlanDoc(update as unknown as ToolCall);
        break;
      case 'tool_call_update':
        this.upsertTool(update as unknown as ToolCall, false, parentToolUseId(update));
        this.capturePlanDoc(update as unknown as ToolCall);
        break;
      case 'plan':
        this.plan = (update as { entries: PlanEntry[] }).entries ?? [];
        break;
      case 'available_commands_update':
        this.commands = (update as { availableCommands: AvailableCommand[] }).availableCommands ?? [];
        break;
      case 'usage_update':
        this.applyUsage(update as { used?: number; size?: number; cost?: { amount?: number } });
        break;
      default:
        break;
    }
  }

  // Fold an ExitPlanMode tool call's markdown into planDoc. Additive-only: a
  // later tool_call_update (e.g. status → completed) usually omits rawInput, so
  // don't blank a doc we already captured — the pending event carried it, and
  // the latest ExitPlanMode with a plan string wins.
  private capturePlanDoc(tool: ToolCall): void {
    const doc = exitPlanDoc(tool);
    if (doc) this.planDoc = doc;
  }

  // Fold a usage_update. The adapter sends `used`/`size` after every turn and
  // again after a compaction (where `used` drops sharply); `cost` is cumulative.
  // Carry forward the prior value for any field this event omits so a partial
  // update (e.g. a post-compaction event with no cost) doesn't blank the meter.
  private applyUsage(u: { used?: number; size?: number; cost?: { amount?: number } }): void {
    const prev = this.usage;
    const used = u.used ?? prev?.used ?? 0;
    const size = u.size ?? prev?.size ?? 0;
    const cost = u.cost?.amount ?? prev?.cost;
    if (u.used !== undefined && prev && prev.used > 0 && u.used < prev.used * 0.5) {
      this.compactionSeen = true;
    }
    this.usage = {
      used,
      size,
      ...(cost !== undefined ? { cost } : {}),
      ...(this.cacheTotals ? { cache: this.cacheTotals } : {}),
    };
  }

  addTurnUsage(turn: TurnUsage | undefined, at: number = Date.now()): void {
    if (!turn) return;
    this.turnTimestamps.push(at);
    if (this.turnTimestamps.length > 50) this.turnTimestamps.shift();

    const cachedRead = turn.cachedReadTokens ?? 0;
    const cachedWrite = turn.cachedWriteTokens ?? 0;
    const input = turn.inputTokens ?? 0;
    const output = turn.outputTokens ?? 0;
    if (!this.cacheTotals && cachedRead + cachedWrite + input + output === 0) return;

    const prev = this.cacheTotals;
    const totals: CacheUsage = {
      cachedRead: (prev?.cachedRead ?? 0) + cachedRead,
      cachedWrite: (prev?.cachedWrite ?? 0) + cachedWrite,
      input: (prev?.input ?? 0) + input,
      output: (prev?.output ?? 0) + output,
    };
    const billableInput = totals.cachedRead + totals.input;
    if (billableInput > 0) totals.hitRate = totals.cachedRead / billableInput;
    this.cacheTotals = totals;

    const u = this.usage ?? { used: 0, size: 0 };
    this.usage = { ...u, cache: totals };
  }

  cacheSignals(): { turns: number; medianTurnGapSec?: number; compacted: boolean } {
    const ts = this.turnTimestamps;
    let medianTurnGapSec: number | undefined;
    if (ts.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 1000);
      gaps.sort((a, b) => a - b);
      const mid = Math.floor(gaps.length / 2);
      medianTurnGapSec = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    }
    return {
      turns: ts.length,
      ...(medianTurnGapSec !== undefined ? { medianTurnGapSec } : {}),
      compacted: this.compactionSeen,
    };
  }

  // Route one streamed content block: text coalesces into the current bubble,
  // anything else (image/audio/resource_link/resource) becomes its own timeline
  // item so it interleaves with text in stream order rather than being dropped.
  private appendChunk(role: 'user' | 'assistant', content: ContentBlock | undefined): void {
    if (!content) return;
    if (content.type === 'text') {
      this.appendMessage(role, textOf(content));
    } else {
      this.items.push({ kind: 'block', id: `b${this.seq++}`, role, block: content });
      this.bumpItems(true);
      this.lastMessageKey = null;
    }
  }

  private appendMessage(role: 'user' | 'assistant', text: string): void {
    if (!text) return;
    const key = `message:${role}`;
    const last = this.items[this.items.length - 1];
    if (this.lastMessageKey === key && last && last.kind === 'message' && last.role === role) {
      // Some adapters re-send the whole accumulated reply as a final chunk after
      // streaming it as deltas; concatenating would render the message twice.
      if (text === last.text) return;
      const merged = role === 'assistant' ? appendAssistantText(last.text, text) : last.text + text;
      this.items[this.items.length - 1] = { ...last, text: merged };
      this.bumpItems(false);
    } else {
      this.items.push({ kind: 'message', id: `m${this.seq++}`, role, text, ts: Date.now() });
      this.bumpItems(true);
      this.lastMessageKey = key;
    }
  }

  private appendThought(text: string): void {
    if (!text) return;
    const last = this.items[this.items.length - 1];
    if (this.lastMessageKey === 'thought' && last && last.kind === 'thought') {
      if (text === last.text) return;
      this.items[this.items.length - 1] = { ...last, text: appendAssistantText(last.text, text) };
      this.bumpItems(false);
    } else {
      this.items.push({ kind: 'thought', id: `t${this.seq++}`, text });
      this.bumpItems(true);
      this.lastMessageKey = 'thought';
    }
  }

  // A tool call the ACP adapter attributes to a delegated sub-agent (Claude
  // tags it with `_meta.claudeCode.parentToolUseId`). Nest it under the parent
  // Task's card if we've seen that Task; otherwise fall back to a flat item so
  // an out-of-order or orphaned child still shows rather than vanishing.
  private parentTool(parentToolCallId: string | undefined): (TimelineItem & { kind: 'tool' }) | null {
    if (!parentToolCallId) return null;
    const idx = this.toolIndex.get(parentToolCallId);
    if (idx === undefined) return null;
    const item = this.items[idx];
    return item && item.kind === 'tool' ? item : null;
  }

  private upsertTool(tool: ToolCall, isNew: boolean, parentToolCallId?: string): void {
    const existingIdx = this.toolIndex.get(tool.toolCallId);
    const existing = existingIdx !== undefined && this.items[existingIdx]?.kind === 'tool'
      ? (this.items[existingIdx] as TimelineItem & { kind: 'tool' }).tool
      : undefined;
    const trackingTool: ToolCall = existing
      ? { ...existing, ...tool, content: mergeContent(existing.content, tool.content) }
      : tool;
    // A launch of a background task (Bash / Agent with run_in_background) detaches
    // from the turn and finishes on its own clock; note it so the session stays
    // in a "working" state until its <task-notification> arrives. Keyed by
    // toolCallId so a refining update doesn't double-count the same launch.
    if (isBackgroundLaunch(trackingTool)) this.backgroundLaunchIds.add(tool.toolCallId);
    if (emptyBackgroundTaskSnapshot(trackingTool)) this.clearBackgroundTracking();
    // A child update whose parent we know about (either flagged now or seen on a
    // prior event for this same child) routes into the parent's children array.
    const knownParent = parentToolCallId ?? this.childParent.get(tool.toolCallId);
    const parent = this.parentTool(knownParent);
    if (parent) {
      this.childParent.set(tool.toolCallId, parent.tool.toolCallId);
      this.upsertChild(parent, tool);
      return;
    }

    if (existingIdx !== undefined && !isNew) {
      const prev = this.items[existingIdx];
      if (prev && prev.kind === 'tool') {
        const merged: ToolCall = {
          ...prev.tool,
          ...tool,
          content: mergeContent(prev.tool.content, tool.content),
          // A merge must never drop children accumulated on the parent Task.
          ...(prev.tool.children ? { children: prev.tool.children } : {}),
        };
        this.items[existingIdx] = { ...prev, tool: merged };
        this.bumpItems(false);
      }
      return;
    }
    if (existingIdx !== undefined) return;
    const id = `tool:${tool.toolCallId}`;
    this.items.push({ kind: 'tool', id, tool });
    this.toolIndex.set(tool.toolCallId, this.items.length - 1);
    this.bumpItems(true);
    this.lastMessageKey = null;
  }

  // Insert or merge a sub-agent tool call inside its parent Task's children,
  // mirroring the top-level upsert semantics (update in place by toolCallId).
  private upsertChild(parent: TimelineItem & { kind: 'tool' }, tool: ToolCall): void {
    const idx = this.items.indexOf(parent);
    if (idx === -1) return;
    const children = parent.tool.children ?? [];
    const childIdx = children.findIndex((c) => c.toolCallId === tool.toolCallId);
    let nextChildren: ToolCall[];
    if (childIdx === -1) {
      // A child first seen via an update (not a create) is still appended rather
      // than dropped.
      nextChildren = [...children, tool];
    } else {
      const prev = children[childIdx];
      const merged: ToolCall = { ...prev, ...tool, content: mergeContent(prev.content, tool.content) };
      nextChildren = [...children];
      nextChildren[childIdx] = merged;
    }
    this.items[idx] = { ...parent, tool: { ...parent.tool, children: nextChildren } };
    this.bumpItems(false);
  }

  private bumpItems(structural: boolean): void {
    this.version++;
    if (structural) this.structureVersion++;
  }

  private completeBackgroundTask(taskId?: string): void {
    if (taskId && this.backgroundLaunchIds.delete(taskId)) return;
    this.backgroundDoneCount++;
  }

  private reconcileBackgroundFromAssistant(): void {
    if (this.backgroundActiveCount === 0) return;
    const last = this.items[this.items.length - 1];
    if (last?.kind === 'message' && last.role === 'assistant' && saysNoBackgroundTasks(last.text)) {
      this.clearBackgroundTracking();
    }
  }
}

// Claude's ACP adapter stamps every tool call a sub-agent makes with the parent
// Task's toolCallId here. Absent on ordinary (main-agent) tool calls.
function parentToolUseId(update: SessionUpdate): string | undefined {
  const meta = (update as { _meta?: { claudeCode?: { parentToolUseId?: unknown } } })._meta;
  const id = meta?.claudeCode?.parentToolUseId;
  return typeof id === 'string' && id ? id : undefined;
}

// A tool call that launches detached background work: Claude's Bash and Agent
// tools take `run_in_background: true` in their input and later report completion
// through a Claude-specific <task-notification>. Do not treat arbitrary agent
// payloads with the same field as background work, or adapters that never emit
// that notification can leave the session permanently "working".
function isBackgroundLaunch(tool: ToolCall): boolean {
  const ri = tool.rawInput;
  if (!ri || typeof ri !== 'object') return false;
  if ((ri as { run_in_background?: unknown }).run_in_background !== true) return false;
  const name = claudeToolName(tool);
  if (name) return /^(?:Bash|Agent)$/i.test(name);
  return /^(?:Bash|Agent|Task)$/i.test(tool.title ?? '');
}

// If `text` is a Claude background-task <task-notification> block, return a
// one-line summary suitable for a system note; otherwise null. These arrive as
// a single injected user turn, so we match the whole block rather than a chunk.
function taskNotification(text: string): { note: string; taskId?: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<task-notification>')) return null;
  const taskId = trimmed.match(/<task-id>([\s\S]*?)<\/task-id>/)?.[1]?.trim();
  const summary = trimmed.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim();
  const status = trimmed.match(/<status>([\s\S]*?)<\/status>/)?.[1]?.trim();
  const note = summary || (status ? `Background task ${status}` : 'Background task finished');
  return { note, ...(taskId ? { taskId } : {}) };
}

function emptyBackgroundTaskSnapshot(tool: ToolCall): boolean {
  if (tool.status && tool.status !== 'completed') return false;
  if (!isTaskSearchTool(tool)) return false;

  const queryText = [tool.title, textFromUnknown(tool.rawInput)].join('\n');
  const outputText = [textFromUnknown(tool.rawOutput), textFromToolContent(tool.content)].join('\n');
  const searchedForTasks = /\b(?:background|task|tasks|agent|agents|process|processes|job|jobs)\b/i.test(queryText);
  const outputSaysEmpty = saysNoBackgroundTasks(outputText);

  if (outputSaysEmpty) return true;
  if (!searchedForTasks) return false;
  return isEmptyTaskPayload(tool.rawOutput) || isEmptyTaskPayload(tool.content) || !outputText.trim();
}

function isTaskSearchTool(tool: ToolCall): boolean {
  const name = claudeToolName(tool) ?? tool.title ?? '';
  return /^(?:ToolSearch|TaskSearch)$/i.test(name);
}

function claudeToolName(tool: ToolCall): string | undefined {
  const meta = (tool as { _meta?: { claudeCode?: { toolName?: unknown } } })._meta;
  const name = meta?.claudeCode?.toolName;
  return typeof name === 'string' && name ? name : undefined;
}

function saysNoBackgroundTasks(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  return /\b(?:no|zero|0)\s+(?:active\s+|running\s+)?(?:background\s+)?(?:tasks|agents|processes|jobs)\b/i.test(compact)
    || /\b(?:task|background task)\s+list\s+is\s+empty\b/i.test(compact)
    || /\bdon'?t\s+have\s+any\s+(?:active\s+)?(?:background\s+)?(?:tasks|agents|processes|jobs)\b/i.test(compact);
}

function isEmptyTaskPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  for (const key of ['tasks', 'backgroundTasks', 'jobs', 'processes', 'agents']) {
    if (Array.isArray(record[key])) return record[key].length === 0;
  }
  return false;
}

function textFromToolContent(content: ToolCallContent[] | undefined): string {
  if (!content?.length) return '';
  return content.map((c) => {
    if (c.type === 'content') return textFromUnknown(c.content);
    return '';
  }).filter(Boolean).join('\n');
}

function textFromUnknown(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (depth > 5) return '';
  if (Array.isArray(value)) return value.map((v) => textFromUnknown(v, depth + 1)).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (record.content) return textFromUnknown(record.content, depth + 1);
  return Object.values(record).map((v) => textFromUnknown(v, depth + 1)).filter(Boolean).join('\n');
}

function textOf(content: ContentBlock | undefined): string {
  if (!content) return '';
  if (content.type === 'text') return (content as { text: string }).text ?? '';
  return '';
}

function appendAssistantText(prev: string, next: string): string {
  if (!prev || !next) return prev + next;
  if (!needsSentenceBoundarySpace(prev, next)) return prev + next;
  return `${prev} ${next}`;
}

function needsSentenceBoundarySpace(prev: string, next: string): boolean {
  if (/\s$/.test(prev) || /^\s/.test(next)) return false;
  if (insideOpenFence(prev)) return false;
  return /[.!?][)"'\]}*_~]*$/.test(prev) && /^[("'[*_~]*[A-Z]/.test(next);
}

function insideOpenFence(text: string): boolean {
  let fence: '`' | '~' | null = null;
  for (const line of text.split('\n')) {
    const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1][0] as '`' | '~';
    if (!fence) {
      fence = marker;
    } else if (fence === marker) {
      fence = null;
    }
  }
  return fence !== null;
}

function mergeContent(prev: ToolCallContent[] | undefined, next: ToolCallContent[] | undefined): ToolCallContent[] | undefined {
  if (!next) return prev;
  // Tool updates generally carry the full content array; prefer the latest.
  return next.length ? next : prev;
}
