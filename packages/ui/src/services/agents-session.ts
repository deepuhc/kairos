import { Conversation } from './acp-conversation.js';
import type {
  AvailableCommand,
  ContentBlock,
  PlanEntry,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  TimelineItem,
  UsageInfo,
} from './acp-types.js';

// One whole turn waiting to be sent: the typed text plus any attachments
// (images, files) staged with it. ACP runs one prompt per session at a time, so
// messages typed while the agent is busy queue here and flush FIFO on turn end.
export interface QueuedMessage {
  text: string;
  attachments: ContentBlock[];
}

export interface InflightPrompt {
  blocks: ContentBlock[];
  authRetryAttempted: boolean;
}
import type { ElicitationRequest, PermissionRequest } from './acp.js';
import type { Checkpoint, SessionEntry } from './api.js';

// Per-session phase. Connection-level states (connecting/error) live on the view.
export type SessionPhase = 'ready' | 'thinking' | 'error';

// One in-browser ACP agent session. Each agent type (claude, gemini, …) has one
// subprocess connection that can host several sessions; the view routes updates
// to the right session by id, and groups sessions by `agentId` in the sidebar.
export interface AgentSession {
  id: string;
  /** Which agent runs this session (e.g. 'claude', 'gemini'). */
  agentId: string;
  /** Display name for the agent, from agentInfo (falls back to the registry label). */
  agentName: string;
  cwd: string;
  title: string;
  convo: Conversation;
  items: TimelineItem[];
  /** Monotonic counter for any timeline-item content change. Use as the render
   *  dependency because the items array keeps identity during streaming. */
  itemsVersion: number;
  /** Monotonic counter for item order/length changes only. Use for caches that
   *  do not care about streamed text updates. */
  itemsStructureVersion: number;
  plan: PlanEntry[];
  /** Full plan markdown presented in plan mode (Claude's ExitPlanMode); '' if none. */
  planDoc: string;
  /** Latest context-window usage from usage_update events; null until reported. */
  usage: UsageInfo | null;
  /** Slash commands the agent offers, from available_commands_update. */
  commands: AvailableCommand[];
  /** Unified mode/model/effort selectors from the agent (see SessionConfigOption). */
  configOptions: SessionConfigOption[];
  /** Inferred default config values keyed by option/model scope. */
  configDefaults: ConfigDefaultValues;
  phase: SessionPhase;
  /** Epoch ms when the current thinking turn began; null when idle. Drives the
   *  sidebar's "thinking for m:ss" elapsed readout. */
  turnStartedAt: number | null;
  /** Set when a thinking turn has produced no traffic for a while — the agent may be wedged. */
  stalled: boolean;
  /** Count of background tasks (run_in_background Bash/Agent launches) still
   *  running. Non-zero keeps the session in a "working" state after the prompt
   *  turn resolves, since detached work outlives the turn (see Conversation). */
  backgroundActive: number;
  /** Epoch ms the last turn finished (or an attention event arrived) while idle;
   *  null until the first completion. Drives the sidebar's "Done · Nm ago" readout. */
  doneAt: number | null;
  /** True when the session finished (or asked for input) while the user wasn't
   *  watching it, and hasn't been viewed since. Cleared on switchTo / when watched. */
  unseen: boolean;
  error: string;
  draft: string;
  /** Attachments staged with the current draft (images, files), sent with it. */
  attachments: ContentBlock[];
  /** Transient rejection message shown in the composer when an attachment is
   *  dropped (too large, unreadable, unsupported); cleared on the next attach,
   *  on send, or by the dismiss control. */
  attachError: string;
  /** Turns typed while the agent was busy, sent FIFO once the turn ends. */
  queued: QueuedMessage[];
  /** Prompt currently awaiting an ACP response. Kept so auth expiry can replay it once. */
  inflightPrompt: InflightPrompt | null;
  /** True while Kairos is running devai auth login before replaying inflightPrompt. */
  authRetrying: boolean;
  /** A steer is queued and waiting to interrupt the live turn — armed on send,
   *  fired by cancelling once no file-mutating tool call is in flight. */
  wantsInterrupt?: boolean;
  /** The ACP turn ended (session/prompt resolved) but tool calls are still
   *  in_progress (subagents running). The real transition to 'ready' is deferred
   *  until all tools complete. */
  stopReceived?: boolean;
  permission: PermissionRequest | null;
  /** Pending structured-input request from the agent (form-mode elicitation). */
  elicitation: ElicitationRequest | null;
  terminalOutputs: Map<string, string>;
  /** True while a resumed session is replaying its history. */
  loading: boolean;
  /** Tool ids that arrived during history replay. Kept as a replay hint even
   *  though inline diff bodies now default collapsed for every session. */
  replayedToolIds: Set<string>;
  /** Title is still a placeholder; replace it with the first user message. */
  autoTitle: boolean;
  /** Auto-resolve permission requests with the first `allow_*` option. */
  autoAccept: boolean;
  /** Set when this session runs in an app-created git worktree (provenance for cleanup). */
  worktree?: { worktreePath: string; branch: string; repoRoot: string };
  /** Agent-authored markdown summary of this session's changes, once requested (Summary panel). */
  summary?: string;
  /** Working-tree snapshots taken before each turn; empty for non-git cwds. */
  checkpoints: Checkpoint[];
  /** Standing-instruction text to prepend to the FIRST prompt turn, then clear.
   *  ACP has no system-prompt field, so launch-time global rules and any chosen
   *  role ride in as an extra text block on turn one (see flushQueue in
   *  agents-view.ts). One-shot. */
  pendingPreamble?: string;
  /** Set ONLY on sessions launched from History "Search with <agent>": the pool
   *  of sessions a cited id can resolve to — the FULL History list, not just the
   *  narrowed corpus placed in the prompt (deep search's job is to surface
   *  sessions the metadata filter missed, which live outside that corpus). Its
   *  presence is the sole gate for the resume-chip scan (a normal chat session
   *  leaves this undefined and pays nothing). Used to match cited ids in the
   *  agent's answer back to a resumable entry — see completeStop /
   *  findCitedSessions. */
  searchCandidates?: SessionEntry[];
  /** Candidate sessions the agent cited in its latest answer, in ranked order;
   *  rendered as one-click resume chips above the composer. Recomputed each turn. */
  searchMatches?: SessionEntry[];
}

export function createAgentSession(id: string, cwd: string, opts: Partial<AgentSession> = {}): AgentSession {
  const convo = new Conversation();
  return {
    id,
    agentId: 'claude',
    agentName: 'Claude',
    cwd,
    title: 'New session',
    convo,
    items: convo.items,
    itemsVersion: convo.version,
    itemsStructureVersion: convo.structureVersion,
    plan: [],
    planDoc: '',
    usage: null,
    commands: [],
    configOptions: [],
    configDefaults: new Map(),
    phase: 'ready',
    turnStartedAt: null,
    stalled: false,
    backgroundActive: 0,
    doneAt: null,
    unseen: false,
    error: '',
    draft: '',
    attachments: [],
    attachError: '',
    queued: [],
    inflightPrompt: null,
    authRetrying: false,
    permission: null,
    elicitation: null,
    terminalOutputs: new Map(),
    loading: false,
    replayedToolIds: new Set(),
    autoTitle: true,
    autoAccept: false,
    checkpoints: [],
    ...opts,
  };
}

const MAX_TITLE = 42;

// Condense the first user message into a short sidebar label.
export function deriveSessionTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New session';
  return clean.length > MAX_TITLE ? clean.slice(0, MAX_TITLE - 1).trimEnd() + '…' : clean;
}

// A select-config value the user previously chose, keyed by option id.
export type SavedConfig = Record<string, string>;
export type ConfigDefaultValues = Map<string, string>;

// One config option to re-apply when restoring a saved selection.
export interface ConfigRestoreStep {
  id: string;
  value: string;
  /** Switching this option makes the agent rebuild the others, so apply it
   * first and wait for the new set before applying the rest (see planConfigRestore). */
  rebuilds: boolean;
}

function selectLeaves(
  options: Array<SessionConfigSelectOption | SessionConfigSelectGroup> | undefined,
): SessionConfigSelectOption[] {
  if (!options) return [];
  return options.flatMap((v) => ('group' in v ? v.options : [v]));
}

function currentModelScope(options: SessionConfigOption[]): { id: string; value: string } {
  const model = options.find((o) => o.category === 'model' && typeof o.currentValue === 'string');
  return {
    id: model?.id ?? '__no_model_option__',
    value: (model?.currentValue as string | undefined) ?? '__no_model_value__',
  };
}

function configDefaultKey(optionId: string, modelScope: { id: string; value: string }): string {
  return `${modelScope.id}\u0000${modelScope.value}\u0000${optionId}`;
}

// ACP does not expose a first-class default marker for reasoning effort. The
// best signal we have is the thought_level value an adapter reports when a
// session is first created or when a model switch rebuilds the option set.
export function inferThoughtLevelDefaults(
  defaults: ConfigDefaultValues,
  options: SessionConfigOption[],
): ConfigDefaultValues {
  const modelScope = currentModelScope(options);
  let next = defaults;
  for (const option of options) {
    if (option.category !== 'thought_level' || typeof option.currentValue !== 'string') continue;
    if (next === defaults) next = new Map(defaults);
    next.set(configDefaultKey(option.id, modelScope), option.currentValue);
  }
  return next;
}

export function thoughtLevelDefaultValue(
  defaults: ConfigDefaultValues,
  options: SessionConfigOption[],
  optionId: string,
): string | undefined {
  return defaults.get(configDefaultKey(optionId, currentModelScope(options)));
}

// The Claude adapter always offers a `bypassPermissions` mode, but switching to
// it fails whenever Claude Code's `disableBypassPermissionsMode` setting is on
// (common in managed/shared configs) — the agent rejects the RPC with a
// -32603 error. Rather than surface a mode that errors the instant it's picked,
// drop it from the mode option. The view applies this at every point config
// options arrive (session/new, session/load, and config_option_update) so the
// dropdown, keyboard navigation, and saved-config restore all agree it's gone.
//
// Stripping a leaf can orphan `currentValue`: if the session's active mode is
// the one we removed (e.g. a session created/resumed in bypassPermissions), the
// dropdown would have nothing to highlight and render blank. Keep the value in
// sync by re-pointing it at a still-offered leaf via `coerceModeValue`.
export function stripBypassMode(options: SessionConfigOption[]): SessionConfigOption[] {
  return options.map((o) => {
    if (o.category !== 'mode' || !o.options) return o;
    const filtered = o.options.filter((v) => 'group' in v || v.value !== 'bypassPermissions');
    const currentValue =
      typeof o.currentValue === 'string' ? coerceModeValue(filtered, o.currentValue) : o.currentValue;
    return { ...o, options: filtered, currentValue };
  });
}

// Resolve a desired mode value against the leaves actually offered. If the value
// is still offered (or there are no leaves to validate against), keep it;
// otherwise fall back to `default` when present, else the first remaining leaf.
// Returns the original value unchanged when nothing better is available.
export function coerceModeValue(
  options: Array<SessionConfigSelectOption | SessionConfigSelectGroup> | undefined,
  value: string,
): string {
  const leaves = selectLeaves(options);
  if (!leaves.length || leaves.some((leaf) => leaf.value === value)) return value;
  return leaves.find((leaf) => leaf.value === 'default')?.value ?? leaves[0].value;
}

// Plan how to re-apply a saved mode/model/effort selection onto a freshly
// created session. Returns only the steps that (a) have a saved value, (b)
// differ from the option's current value, and (c) name a value the agent still
// offers — stale saves (a model that no longer exists) are skipped silently.
//
// The model option's category is 'model'; selecting a different model makes the
// adapter rebuild the effort ('thought_level') option, so the model step is
// flagged `rebuilds`. Callers apply rebuild steps first, await the new option
// set, then apply the rest against it — otherwise effort would be set against a
// list the agent is about to replace.
export function planConfigRestore(
  options: SessionConfigOption[],
  saved: SavedConfig,
): ConfigRestoreStep[] {
  const steps: ConfigRestoreStep[] = [];
  for (const o of options) {
    if (o.type !== 'select') continue;
    const want = saved[o.id];
    if (want == null || want === o.currentValue) continue;
    const offered = selectLeaves(o.options).some((leaf) => leaf.value === want);
    if (!offered) continue;
    steps.push({ id: o.id, value: want, rebuilds: o.category === 'model' });
  }
  // Rebuild-triggering steps first so dependent options resolve against the set
  // the agent rebuilds in response.
  steps.sort((a, b) => Number(b.rebuilds) - Number(a.rebuilds));
  return steps;
}
