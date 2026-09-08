import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { guard } from 'lit/directives/guard.js';
import { keyed } from 'lit/directives/keyed.js';
import {
  AcpClient,
  type InitializedInfo,
  type SessionInfo,
  type SessionLoaded,
  type PermissionRequest,
  type ElicitationRequest,
  type AgentCapabilities,
} from '../services/acp.js';
import type { AvailableCommand, ContentBlock, ElicitationResponse, EmbeddedResourceContent, ImageContent, ResourceLinkContent, SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption, SessionUpdate } from '../services/acp-types.js';
import { SUMMARY_PROMPT } from '../services/acp-conversation.js';
import { getWorkspaces, getAgents, resumeSessionFromPoint, createCustomAgent, updateCustomAgent, deleteCustomAgent, setAgentAuth, detectRepo, getGitStatus, createWorktree, inspectWorktree, removeWorktree, createCheckpoint, listCheckpoints, restoreCheckpoint, login, listWorkspaceDir, type WorkspaceEntry, type SessionEntry, type AgentOption, type RepoInfo } from '../services/api.js';
import { coerceModeValue, createAgentSession, deriveSessionTitle, inferThoughtLevelDefaults, planConfigRestore, stripBypassMode, thoughtLevelDefaultValue, type AgentSession, type SavedConfig } from '../services/agents-session.js';
import { countSessionChangedFiles } from '../services/review-changes.js';
import { buildSlashMenuItems, isRewindCommand, isSlashCommandMessage, type SlashMenuItem } from '../services/prompt-util.js';
import { nextPrompt, previousPrompt, type PromptHistoryNavigation, type PromptHistoryStep } from '../services/prompt-history.js';
import { composeLaunchPreamble, formatTrailingLaunchPreamble } from '../services/launch-context.js';
import { hydrateAgentPrefs, pushPrefs, loadLastAgent } from '../services/agent-prefs-sync.js';
import { buildSessionSearchPrompt, findCitedSessions } from '../services/session-search.js';
import { usableSessionDir } from '../services/session-resume.js';
import {
  describeOpenSessions,
  mergeOpenSessionDescriptors,
  normalizeOpenSessionDescriptors,
  openSessionToEntry,
  type PersistedOpenSession,
} from '../services/open-sessions.js';
import { preserveTimelineWindowStart } from '../services/timeline-window.js';
import { hasDeferredStopTools } from '../services/agent-liveness.js';
import { getPrompts, getRoles, getGlobalRules, getSystemUser, renameSession, listAllWorkspaceFiles, type PromptInput, type CustomRoleInput } from '../services/api.js';
import { moveId, reorderByIds, type DropPosition } from '../services/session-order.js';
import { workspacePathFromHref } from '../services/workspace-links.js';
import { fetchWithAuth } from '../services/backend-auth.js';
import { renderItem, renderMarkdown, renderBlock, renderUsage, timelineStyles } from './agents-timeline-render.js';
import { speak, stopSpeaking, speechOutputSupported } from '../services/speech.js';
import { evictMarkdownCache, renderMarkdownCached, type MarkdownLocalLinkDetail } from './markdown.js';
import { collectMatches, totalMatches, locateMatch, type ItemMatch } from '../services/timeline-search.js';
import { applyHighlights, clearHighlights } from './timeline-highlight.js';
import { focusRing } from '../styles/focus.js';
import { icon } from './icons.js';
import './agents-tool-call.js';
import './agents-review.js';
import './agents-summary.js';
import './agents-plan.js';
import './agents-prompts.js';
import './agents-file-tree.js';
import './agents-source-control.js';
import './agents-frames.js';
import './agents-terminal.js';
import './agents-elicitation.js';
import './agents-sidebar.js';
import './agents-pet.js';
import { petMoodFor, type PetMood } from '../services/pet-mood.js';
import './agents-behind-scenes.js';
import './agent-logo.js';
import { hasAgentLogo } from './agent-logo.js';
import './status-indicator.js';
import './copy-button.js';
import { serializeTimeline } from '../services/transcript.js';
import type { ActiveSessionSummary } from './agents-sidebar.js';
import { elideLargeData, type CapturedFrame, type FrameChannel } from '../services/acp-frames.js';
import { notify, clearNotification } from '../services/notify.js';
import { tooltip } from '../directives/tooltip.js';

type ConnState = 'down' | 'connecting' | 'up' | 'auth' | 'error';

// Text-like attachments (sent inline as embedded `resource` blocks when the
// agent advertises embeddedContext). Extensions catch files browsers report
// with an empty or octet-stream MIME (common for source/config files).
const TEXT_ATTACH_EXTS = new Set([
  'json', 'jsonc', 'md', 'markdown', 'txt', 'text', 'log', 'csv', 'tsv',
  'yml', 'yaml', 'xml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'swift', 'kt', 'scala', 'sh',
  'bash', 'zsh', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte',
  'graphql', 'proto', 'gradle', 'dockerfile', 'makefile', 'r', 'm', 'lua', 'pl',
]);
const TEXT_ATTACH_MIMES = new Set([
  'application/json', 'application/xml', 'application/x-yaml', 'application/yaml',
  'application/javascript', 'application/toml', 'application/sql',
]);
// Skip files larger than this to keep uploads from blowing the context window.
const TEXT_ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// `accept` fragment for the file dialog when text attachments are allowed.
const TEXT_ACCEPT = ['text/*', ...TEXT_ATTACH_MIMES, ...Array.from(TEXT_ATTACH_EXTS, (e) => `.${e}`)].join(',');
const APPROVED_AGENT_IDS = new Set(['claude', 'codex', 'gemini']);

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (file.type && TEXT_ATTACH_MIMES.has(file.type)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!ext && TEXT_ATTACH_EXTS.has(ext);
}

type ResumePromptMode = 'overwrite' | 'fork';

interface ResumePromptRequest {
  sessionId: string;
  index: number;
  mode: ResumePromptMode;
}

interface ManualScrollSnapshot {
  sessionId: string;
  scrollTop: number;
  scrollIntentVersion: number;
}

// The custom-agent form keeps free-text fields the user edits; `args` and `env`
// are parsed on submit (args by whitespace, env from KEY=VALUE lines).
interface CustomAgentDraft {
  id: string;
  label: string;
  command: string;
  args: string;
  env: string;
  managedApp: boolean;
}

function emptyCustomDraft(): CustomAgentDraft {
  return { id: '', label: '', command: '', args: '', env: '', managedApp: false };
}

// Rotating "Did you know?" tips for the new-session empty state — each maps to a
// real, easily-missed Agents-tab affordance.
const FEATURE_TIPS: string[] = [
  'Drag files onto the composer, or paste a screenshot straight in.',
  'Type @ to pull in a file from this project by path.',
  'Type / to run a slash command or drop in a saved prompt.',
  'Keep typing while the agent works to steer it mid-turn.',
  'Start a session in an isolated git worktree so edits stay on their own branch.',
  'Every prompt is checkpointed so Edit prompt and Fork can rewind files with the conversation.',
  'Open the Review panel to see every file the agent changed this session.',
  'Running low on context? Hit Compact to summarize and free up room.',
  'Give the agent a Role in Customize to reuse a persona across any engine.',
  'Flip the shield to Auto-accept and the agent runs without pausing for approvals.',
  'Open the Summary panel for a written recap of what changed — kept out of the chat.',
  'Switch mode, model, and reasoning effort mid-session from the composer footer.',
  'Run several agents at once — each session keeps streaming in the sidebar.',
  'Reopen a past chat from Recent and it replays right where you left off.',
  'Prefer your own API key? Toggle it per agent in the New-session picker.',
  'Press ? anywhere to open the help guide.',
  'Open the Frames panel to watch the raw ACP protocol as it streams.',
  'Wire up an MCP server in Customize and it loads into every new session.',
];
const TIP_INDEX_KEY = 'kairos-agents:tip-index';

// Cap the live-inspector buffer so a long-running agent doesn't bloat memory.
// ~60 keeps a couple of turns of context visible even when each turn fans out
// into many tool calls.
const FRAME_LOG_CAP = 60;

// Bottom-anchored timeline window (see timelineWindow). Render the last
// TIMELINE_WINDOW items by default; "Show earlier" reveals TIMELINE_WINDOW_STEP
// more each click. Keep the default conservative: large resumed sessions often
// contain rich diff/tool nodes, and switching sessions pays layout for every
// mounted item.
const TIMELINE_WINDOW = 30;
const TIMELINE_WINDOW_STEP = 100;
const BOTTOM_SCROLL_TOP = 1_000_000_000;

// Per-agent connection: each agent type (claude, gemini, …) has its own
// subprocess, so its connection state, display name, and capabilities are
// tracked independently. Sessions reference their agent by id.
interface AuthMethod {
  id: string;
  name: string;
  description?: string;
  command?: string;
  args?: string[];
  label?: string;
}

interface AgentConn {
  agentId: string;
  state: ConnState;
  name: string;
  capabilities: AgentCapabilities;
  authMethod?: AuthMethod;
  // Last non-empty stderr line from the agent subprocess, kept so a crash/exit
  // can surface the real reason (e.g. "command not found: goose") instead of a
  // generic "process exited" banner.
  stderrTail?: string;
}

// Last working directory used to start a session, so the picker pre-fills it next time.
const LAST_CWD_KEY = 'kairos-agents:last-cwd';
// Last agent chosen in the picker, pre-selected next time.
const LAST_AGENT_KEY = 'kairos-agents:last-agent';
// Auto-accept preference, persisted so it carries across reloads and new sessions.
const AUTO_ACCEPT_KEY = 'kairos-agents:auto-accept';
// One-time nudge shown after the user's first manual permission approval,
// pointing at the Auto-accept toggle. Once dismissed or auto-accept is turned
// on, it never shows again.
const AUTO_ACCEPT_HINT_KEY = 'kairos-agents:auto-accept-hint-seen';
// Last role/persona selected in the picker ('' = none). Global, not per-agent:
// roles are agent-agnostic, so the same choice carries across engine switches.
const LAST_ROLE_KEY = 'kairos-agents:last-role';
// Last mode/model/effort selection, persisted per agent (each agent offers a
// different model list) so new sessions reopen with the user's last choices.
const CONFIG_KEY_PREFIX = 'kairos-agents:config:';
// Sessions the user intentionally left open in the Agents sidebar. Stored in
// localStorage so a full Kairos relaunch/update can offer "Previously open"
// chats; only the focused/mid-turn ones auto-replay on boot.
// Shape: PersistedOpenSession[].
const OPEN_SESSIONS_KEY = 'kairos-agents:open-sessions';
// The session id focused when the open-session set was last persisted.
const ACTIVE_SESSION_KEY = 'kairos-agents:active-session';

// Width of the Files/Review side-panel, persisted globally (not per-session) so
// the panel reopens at the user's chosen size across sessions and reloads.
const PANEL_WIDTH_KEY = 'kairos-agents:panel-width';
const PANEL_WIDTH_MIN = 320;
const PANEL_WIDTH_MAX = 1400;
const PANEL_WIDTH_DEFAULT = 440;
// The chat column never shrinks below this while dragging the panel wider.
const PANEL_CHAT_MIN = 260;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 200;
const COMPOSER_TEXTAREA_RESIZE_EPSILON = 2;
type PanelId = 'files' | 'source' | 'review' | 'summary' | 'plan' | 'prompts' | 'terminal' | 'frames';
type SessionPanelState = { panel: PanelId; open: boolean };
const DEFAULT_SESSION_PANEL_STATE: SessionPanelState = { panel: 'files', open: false };

interface SourceStatusSummary {
  cwd: string;
  isRepo: boolean;
  changes: number;
  branch: string;
  loading: boolean;
  error?: string;
}

function clampPanelWidth(px: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(px)));
}

// Chat status label for a session whose prompt turn resolved but still has
// detached background tasks (run_in_background) running.
function backgroundStatusLabel(count: number): string {
  return count === 1 ? 'Working in the background…' : `Working — ${count} background tasks running…`;
}

// A turn that fails because the kairos gateway token expired is surfaced as raw
// CLI/API text rather than a structured code. Older gateway paths have returned
// both 401 and 404 for this shape.
function isAuthExpiredError(msg: string): boolean {
  return /\b(?:401|404)\b|no subject found|failed to authenticate|not authenticated|token expired|session expired/i.test(msg);
}

function loadPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampPanelWidth(raw) : PANEL_WIDTH_DEFAULT;
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
}

function savePanelWidth(px: number) {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(px));
  } catch { /* quota / disabled — ignore */ }
}

function loadLastCwd(): string {
  try {
    return localStorage.getItem(LAST_CWD_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveLastCwd(cwd: string) {
  try {
    localStorage.setItem(LAST_CWD_KEY, cwd);
  } catch { /* quota / disabled — ignore */ }
  pushPrefs({ lastCwd: cwd });
}

// Agents report a redundant " Agent" suffix in their title (e.g. devai's
// "Claude Agent"); drop it so the header reads just "Claude".
function cleanAgentName(name: string | undefined): string {
  return (name ?? '').replace(/\s+Agent$/i, '').trim();
}

function saveLastAgent(agent: string) {
  try {
    localStorage.setItem(LAST_AGENT_KEY, agent);
  } catch { /* quota / disabled — ignore */ }
  pushPrefs({ lastAgent: agent });
}

function loadLastRole(): string {
  try {
    return localStorage.getItem(LAST_ROLE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveLastRole(roleId: string) {
  try {
    localStorage.setItem(LAST_ROLE_KEY, roleId);
  } catch { /* quota / disabled — ignore */ }
}

function loadAutoAccept(): boolean {
  try {
    return localStorage.getItem(AUTO_ACCEPT_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAutoAccept(on: boolean) {
  try {
    localStorage.setItem(AUTO_ACCEPT_KEY, on ? '1' : '0');
  } catch { /* quota / disabled — ignore */ }
  pushPrefs({ autoAccept: on });
}

// Fallback returns true (treat as "already seen") so a broken/disabled
// localStorage never spams the callout.
function autoAcceptHintSeen(): boolean {
  try {
    return localStorage.getItem(AUTO_ACCEPT_HINT_KEY) === '1';
  } catch {
    return true;
  }
}

function markAutoAcceptHintSeen() {
  try {
    localStorage.setItem(AUTO_ACCEPT_HINT_KEY, '1');
  } catch { /* quota / disabled — ignore */ }
}

// Return the tip index to show now, then persist the next one so the following
// mount advances by one and the set cycles. Falls back to 0 if storage is off.
function advanceTipIndex(): number {
  let n = 0;
  try {
    n = parseInt(localStorage.getItem(TIP_INDEX_KEY) || '0', 10) || 0;
  } catch { /* disabled — start at 0 */ }
  const idx = ((n % FEATURE_TIPS.length) + FEATURE_TIPS.length) % FEATURE_TIPS.length;
  try {
    localStorage.setItem(TIP_INDEX_KEY, String((idx + 1) % FEATURE_TIPS.length));
  } catch { /* quota / disabled — ignore */ }
  return idx;
}

function loadSavedConfig(agentId: string): SavedConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY_PREFIX + agentId);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as SavedConfig) : {};
  } catch {
    return {};
  }
}

function loadOpenSessions(): PersistedOpenSession[] {
  try {
    const raw = localStorage.getItem(OPEN_SESSIONS_KEY)
      // One-time compatibility with the old per-webview reload store.
      ?? sessionStorage.getItem(OPEN_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeOpenSessionDescriptors(parsed);
  } catch {
    return [];
  }
}

function saveOpenSessionDescriptors(descriptors: PersistedOpenSession[], activeId: string | null) {
  try {
    localStorage.setItem(OPEN_SESSIONS_KEY, JSON.stringify(descriptors));
    sessionStorage.removeItem(OPEN_SESSIONS_KEY);
    if (activeId && descriptors.some((s) => s.id === activeId)) {
      localStorage.setItem(ACTIVE_SESSION_KEY, activeId);
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch { /* quota / disabled — ignore */ }
}

function loadActiveSession(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY)
      ?? sessionStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

// Merge one option's new value into the agent's saved selection.
function saveConfigValue(agentId: string, configId: string, value: string) {
  const next = { ...loadSavedConfig(agentId), [configId]: value };
  try {
    localStorage.setItem(CONFIG_KEY_PREFIX + agentId, JSON.stringify(next));
  } catch { /* quota / disabled — ignore */ }
  pushPrefs({ savedConfigs: collectSavedConfigs() });
}

// Gather every agent's saved config from localStorage into the map shape the
// disk store expects.
function collectSavedConfigs(): Record<string, SavedConfig> {
  const map: Record<string, SavedConfig> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CONFIG_KEY_PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (parsed && typeof parsed === 'object') map[key.slice(CONFIG_KEY_PREFIX.length)] = parsed;
      } catch { /* skip */ }
    }
  } catch { /* localStorage unavailable */ }
  return map;
}

@customElement('kairos-agents')
export class DevaiAgents extends LitElement {
  // Whether the Agents tab is the visible view. Reflected to an attribute that
  // the :host CSS rule reads to show/hide the (always-mounted) component, so
  // live sessions survive navigating away. Toggling it off also halts voice
  // dictation — the mic shouldn't stay hot on a hidden tab.
  @property({ type: Boolean, reflect: true }) active = true;
  // Set by the parent when the user hits Resume in the Sessions tab or Dashboard.
  // A fresh SessionEntry reference each click; `updated` picks it up and replays
  // the session inline (with terminal fallback inside resumeAgentSession).
  @property({ attribute: false }) resumeEntry: SessionEntry | null = null;
  // Set by the parent when the user hits "Start session" on an agent-capable app
  // (Dashboard/Apps). A fresh reference each click; `updated` lands on the picker
  // with the agent preselected and the cwd prefilled, leaving Start to the user.
  @property({ attribute: false }) startRequest: { agent: string; cwd?: string } | null = null;
  // Set by the parent when the user hits "Search with <agent>" in History. A
  // fresh reference each search; `updated` launches a session with the MRU agent
  // and auto-sends a transcript-search prompt (no picker step — go straight in).
  @property({ attribute: false }) searchRequest: { query: string; sessions: SessionEntry[]; allSessions?: SessionEntry[] } | null = null;
  @state() private connError = '';
  @state() private resumeReplacementEntry: SessionEntry | null = null;
  // Optional title the user types in the picker; applied when the session opens
  // so the sidebar/header don't wait for the first message to derive a label.
  @state() private sessionName = '';
  @state() private cwd = loadLastCwd();
  // Git detection for the picker's current cwd: null until detected. When the cwd
  // is a repo, the picker offers an isolated-worktree toggle.
  @state() private repoInfo: RepoInfo | null = null;
  @state() private detectingRepo = false;
  // Whether to start this session in a fresh git worktree, and the branch to create.
  @state() private useWorktree = false;
  @state() private worktreeBranch = '';
  // True while awaiting worktree creation, before the session starts.
  @state() private creatingWorktree = false;
  @state() private selectedAgent = loadLastAgent();
  // Agent-agnostic roles/personas, loaded from the server. Applied to any engine
  // at launch by appending the role's text to the session's first prompt turn.
  @state() private roles: CustomRoleInput[] = [];
  // Role selected in the picker ('' = none). Global, not per-agent.
  @state() private selectedRole = loadLastRole();
  // Global standing instructions applied to every session (config-backed). Like
  // a role, injected into the first prompt turn since ACP has no system-prompt
  // field; unlike a role it always applies and isn't picked in the composer.
  @state() private globalRules = '';
  // First name for the empty-state greeting, resolved from the OS/git identity.
  // Empty if unresolved, in which case the greeting drops the trailing name.
  @state() private greetName = '';
  // Which feature tip the empty state shows. Chosen once per mount and advanced
  // in localStorage so repeat visits cycle through the whole set; the "next"
  // button steps it live within a visit.
  @state() private tipIndex = advanceTipIndex();
  @state() private workspaces: WorkspaceEntry[] = [];
  @state() private agentOptions: AgentOption[] = [];
  // Inline API-key editor for the selected agent. When set, an input row is
  // rendered under the auth-mode segmented control so the user can paste a
  // key without leaving the picker. Cleared once the key is saved.
  @state() private keyDraft: { agentId: string; value: string } | null = null;
  @state() private authBusy = false;
  @state() private authError = '';
  // Custom-agent editor: closed, or open in create/edit mode with a draft.
  @state() private customForm: { mode: 'create' | 'edit'; original: string; draft: CustomAgentDraft } | null = null;
  @state() private customFormError = '';
  @state() private customFormBusy = false;
  @state() private sessions: AgentSession[] = [];
  @state() private activeId: string | null = null;
  // Durable chats that were open before the last full relaunch/update but have
  // not been replayed into the current live sidebar yet.
  @state() private previouslyOpenSessions: PersistedOpenSession[] = [];
  // Epoch ms until which the sidebar pet shows its celebrate mood, set on turn
  // completion (see markDone). Read by petMood(); expires on its own.
  @state() private petCelebrateUntil = 0;
  // Picker is busy: connecting the agent or creating/resuming a session.
  @state() private busy = false;
  // Bump to force re-render after mutating a session object in place.
  @state() private rev = 0;
  // Open-session rehydration depends on two async boot inputs: the available
  // agent roster and the disk-backed agent prefs mirrored into localStorage.
  // Gate the one-shot restore until both are ready so resumed sessions pick up
  // the correct saved mode/model/effort defaults.
  private prefsHydrated = false;
  private agentsLoaded = false;
  private restoredOpenSessions = false;
  // Pending rAF handle for coalesced re-renders (see touch()).
  private touchFrame = 0;
  // Pending rAF handle for coalesced scroll-to-bottom (see scrollToBottom()).
  private scrollFrame = 0;
  // Pending rAF handle for restoring manual scrollback after a render.
  private preserveScrollFrame = 0;
  // Incremented by direct scroll gestures so delayed restoration never fights
  // the user if they keep scrolling while a streamed update is rendering.
  private scrollIntentVersion = 0;
  // Memoized `activity` string per session for activeSummaries(); WeakMap so a
  // closed session's entry is GC'd with the session object.
  private activityCache = new WeakMap<AgentSession, { itemsVersion: number; phase: AgentSession['phase']; activity: string }>();
  // Memoized user-prompt list + id→prompt-index map per session. renderItem's
  // per-message hover actions previously called promptMessages(s).findIndex per
  // user message, and promptMessages does a full s.items scan — O(prompts×items)
  // every render of the active timeline (each streaming frame). Recompute only
  // when item order/length changes; streamed text keeps prompt indices stable.
  private promptIndexCache = new WeakMap<AgentSession, {
    itemsStructureVersion: number;
    prompts: Array<Extract<AgentSession['items'][number], { kind: 'message' }>>;
    indexById: Map<string, number>;
  }>();
  // Bottom-anchored render window: only the last N items of each timeline are
  // mounted (all sessions stay mounted at once, so a few long conversations
  // otherwise put thousands of nodes in the DOM). The newest items are always
  // rendered so stick-to-bottom stays trivially correct; a "show earlier"
  // control pages backward by raising this session's cap. Keyed by session id;
  // absent = default cap. Trade-off: in-page find (Ctrl+F) won't hit items above
  // the window until they're revealed — same limitation as Claude.ai/ChatGPT.
  @state() private timelineWindow = new Map<string, number>();
  // Last dependency vector used to render each session's timeline contents. While
  // a session is inactive, keep using the cached deps so sidebar switches only
  // toggle the wrapper class; if the session streamed in the background, it pays
  // one catch-up render when it becomes active again.
  private timelineDepsCache = new WeakMap<AgentSession, unknown[]>();
  // Slash-command menu: open while the draft is a bare `/query`, with one row
  // highlighted for keyboard selection.
  // One-time coach-mark pointing at the Auto-accept toggle, raised after the
  // user's first manual permission approval (see handlePermissionChoice).
  @state() private showAutoAcceptHint = false;
  @state() private slashOpen = false;
  // Same menu, opened by clicking the `/` footer button. Shows the full list
  // unfiltered and toggles independently of the draft so the user's text isn't
  // mutated. Mutually exclusive with `slashOpen` to keep one source of truth.
  @state() private slashButtonOpen = false;
  @state() private slashIndex = 0;
  // Last typed `/query` driving the inline slash menu. Used to reset the
  // highlighted row when a new menu/query starts instead of preserving a stale
  // keyboard or hover index from the previous menu.
  private lastSlashQuery: string | null = null;
  // File-mention menu: open while the draft ends in an `@token`, offering a
  // fuzzy-filtered list of workspace files to attach as resource_links (gated on
  // the agent's embeddedContext). `mentionIndex` is the keyboard-highlighted row.
  @state() private mentionOpen = false;
  @state() private mentionIndex = 0;
  // Per-workdir cache of the flat file list backing @-mention autocomplete,
  // fetched once when the menu first opens for a session's working directory.
  private mentionFiles = new Map<string, string[]>();
  private mentionTruncated = new Set<string>();
  // Workdirs with an in-flight or completed fetch, so we only request once.
  private mentionFetching = new Set<string>();
  // Config popover (model and other long/grouped lists): id of the option whose
  // menu is open, plus the keyboard-highlighted leaf index within it.
  @state() private configMenuId: string | null = null;
  @state() private configMenuIndex = 0;
  // Voice dictation implementation is dormant while the broken composer control
  // is hidden; keep cleanup in place in case it is re-enabled later.
  @state() private listening = false;
  // Which inner pane the .main column shows. The Agents tab itself stays
  // mounted (its socket survives nav); flipping this only swaps the inner
  // content between the session/picker view and the Behind the Scenes pane.
  @state() private view: 'session' | 'behind' = 'session';

  // Per-session "Review changes" slide-over open state; reset on session switch.
  @state() private reviewOpen = false;
  // Per-session "Files" slide-over open state; mutually exclusive with review.
  @state() private treeOpen = false;
  // Per-session git source-control open state; shown only for repo-backed sessions.
  @state() private sourceOpen = false;
  // Per-session "Summary" slide-over open state; mutually exclusive with the others.
  @state() private summaryOpen = false;
  // Per-session "Plan" slide-over open state; mutually exclusive with the others.
  @state() private planOpen = false;
  // Per-session "Prompts" outline open state; mutually exclusive with the others.
  @state() private promptsOpen = false;
  // Per-session "Terminal" shell open state; mutually exclusive with the others.
  @state() private terminalOpen = false;
  // Session whose terminal component should stay mounted while hidden/collapsed.
  private terminalSessionId: string | null = null;
  // Sessions whose terminal has been lazily initialized at least once.
  private initializedTerminalIds = new Set<string>();
  // Per-session "Frames" live ACP inspector open state; mutually exclusive.
  @state() private framesOpen = false;
  // Which panel the layout-toolbar's right toggle reopens for the active session.
  private lastPanel: PanelId = 'files';
  // Per live session: selected side-panel and whether the panel is expanded.
  private sessionPanelStates = new Map<string, SessionPanelState>();
  // Per live session: light git status summary for rail visibility/counts.
  @state() private sourceStatusSummaries = new Map<string, SourceStatusSummary>();
  private sourceStatusInflight = new Map<string, string>();
  @state() private sourceRefreshToken = 0;
  @state() private linkedFileRequest: { path: string; nonce: number } | null = null;
  private linkedFileRequestNonce = 0;
  // Width of the Files/Review side-panel and whether its left edge is being dragged.
  @state() private panelWidth = loadPanelWidth();
  @state() private panelResizing = false;
  @state() private resumePromptDialog: ResumePromptRequest | null = null;
  @state() private resumeAnywhereBusy: ResumePromptRequest | null = null;
  // Session id whose `/rewind` prompt picker is open (the TUI-parity list of
  // prompts to rewind to). Picking a row hands off to handleResumeFromPrompt.
  @state() private rewindPickerId: string | null = null;
  // Session id whose in-flight turn is an agent-authored summary request, so
  // onStop can capture the reply into session.summary.
  @state() private pendingSummary: string | null = null;
  // User-saved, engine-agnostic prompt snippets merged into the composer `/`
  // menu. Loaded once on connect from ~/.kairos/config.json; reloaded when the
  // Customize tab edits them (the Agents tab stays mounted, so we refresh on
  // window focus / a broadcast rather than remount).
  @state() private prompts: PromptInput[] = [];
  // Capped ring buffer of inbound ACP frames for the Behind the Scenes live
  // inspector. Newest goes to the end; we trim from the front past FRAME_LOG_CAP.
  // Deliberately NOT @state: frames are recorded on every ACP event (i.e. every
  // streamed token), and marking this reactive would schedule a full top-level
  // re-render per token even when the inspector is closed and nobody will ever
  // see those frames — silently defeating touch()'s frame-coalescing. recordFrame
  // only requests a render when the inspector is actually open (see below).
  private frameLog: CapturedFrame[] = [];
  // Monotonic id for stable list keys (avoids Date-based ids in render).
  private frameSeq = 0;
  private speechSupported = typeof window !== 'undefined'
    && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  private recognition: any = null;
  // Voice output (text-to-speech): whether the browser can speak, and the id of
  // the assistant message currently being read aloud (drives its button state).
  private speechOutputSupported = speechOutputSupported();
  @state() private speakingItemId: string | null = null;
  // Snapshot of the draft when dictation starts, so we can append rather than
  // overwrite as interim results stream in.
  private dictationBase = '';
  private composerResizeFrame = 0;
  private composerResizeAllowShrink = false;
  private composerResizeTarget: HTMLTextAreaElement | null = null;
  // Auto-scroll only while the user is pinned near the bottom. Scrolling up to
  // read history detaches; sending or switching sessions re-engages.
  private stickToBottom = true;
  // Reactive mirror of `!stickToBottom` for the active timeline, driving the
  // "jump to latest" pill. Kept separate from the plain field so a scroll (which
  // doesn't otherwise touch reactive state) re-renders the pill.
  @state() private scrolledUp = false;

  // "Find in conversation" (Cmd/Ctrl+F). The bar is open only for the active
  // session; `findQuery` is the live input, `findMatches` the ordered per-item
  // occurrence counts (searched over the full in-memory timeline, not just the
  // mounted window), and `findIndex` the current global occurrence. Highlighting
  // is painted via the CSS Custom Highlight API so it never re-renders the
  // timeline (see timeline-highlight.ts).
  @state() private findOpen = false;
  @state() private findQuery = '';
  @state() private findMatches: ItemMatch[] = [];
  @state() private findIndex = 0;
  private findApplyFrame = 0;
  // Sticky scroll intent for the next highlight repaint. Set when navigating to a
  // match; survives the reschedules that a findIndex-driven re-render triggers
  // (updated() also calls scheduleFindHighlight, without scroll), so the jump
  // isn't clobbered before the frame runs. Reset once the frame consumes it.
  private findPendingScroll = false;
  // Timeline item version last searched. The items array keeps identity during
  // streaming; this counter changes only when visible timeline content changes.
  private findItemsVersionRef = -1;

  private client = new AcpClient();
  // Live connections keyed by agentId. A session's agent must be 'up' here
  // before it can prompt; bump `rev` after mutating to re-render.
  private conns = new Map<string, AgentConn>();
  // What to do once an agent connection comes up, or what we're awaiting a
  // server confirmation for. Single field so 'new' and 'resume' can't race;
  // `agent` is the connection it's waiting on.
  private pending:
    | { kind: 'new'; cwd: string; agent: string; roleId: string; title?: string; worktree?: { worktreePath: string; branch: string; repoRoot: string }; initialPrompt?: string; searchCandidates?: SessionEntry[] }
    | { kind: 'resume'; entry: SessionEntry; agent: string }
    | null = null;
  // Config values still to re-apply on a session after a model switch rebuilt
  // its option set. Keyed by session id; cleared once the rebuilt set arrives
  // and the remaining steps are applied (see restoreConfig/onConfigOptions).
  private deferredRestore = new Map<string, SavedConfig>();
  // Session ids whose next configOptions payload should be treated as a model
  // switch rebuild, so the returned thought_level value can be recorded as the
  // default for that model.
  private pendingModelDefaultCapture = new Set<string>();
  // Prompt text to put back in the composer after an edit/fork reloads history.
  private resumeDrafts = new Map<string, string>();
  // Per-session composer history cursor. The history itself is derived from the
  // rendered user prompts so reloads/forks automatically participate.
  private promptHistoryNavigation = new Map<string, PromptHistoryNavigation>();
  // Session ids that were mid-turn when the page last unloaded. On reload they
  // are resumed from disk (the turn is interrupted) and get a hint in the UI.
  private interruptedIds = new Set<string>();
  // Shared relogin request so simultaneous auth-expired prompts do not open
  // multiple browser auth flows.
  private authLoginPromise: Promise<void> | null = null;

  static styles = [focusRing, timelineStyles, css`
    /* theme.css scrollbar rules don't pierce the shadow DOM, so scroll
       containers here fall back to the native macOS overlay scrollbar that
       paints over content. Redeclaring with an explicit width forces a
       space-reserving scrollbar instead. */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--w8); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--w15); }
    :host {
      display: block;
      /* Header only — the full-bleed main drops its frame padding, and the
         terminal bar is hidden on this view, so no other space is reserved.
         --app-chrome-height is measured by <kairos-app> and falls back to 65px
         if the var is ever absent. */
      height: calc(100vh - var(--app-chrome-height, 65px));
      /* Conversational content (timeline + composer) fills the full column,
         matching the Files/Review slide-overs — no artificial width cap. Only
         the user-message bubble keeps a measure of its own (see timelineStyles)
         so a right-aligned bubble doesn't stretch edge-to-edge. */
      --chat-measure: 100%;
    }
    /* Kept mounted but hidden when another tab is active, so live sessions
       persist. The active property reflects to an attribute; an explicit rule
       is needed because :host display:block would otherwise keep it visible. */
    :host(:not([active])) { display: none; }
    .layout { display: flex; height: 100%; }
    /* min-height:0 + overflow lets tall content (e.g. Behind the Scenes) scroll
       inside the pane instead of overflowing and dragging the whole layout. The
       session view's .wrap is height:100% with its own .timeline scroll, so it
       never overflows .main and shows no second scrollbar. */
    /* No horizontal frame — the sidebar sits flush left and the panel rail flush
       right (edge-to-edge, Cursor/Zed style). Chat content carries its own side
       breathing via the session bar / timeline / composer below. */
    .main { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; }
    /* Fills the whole .main column so the Files/Review slide-overs (absolute
       inset:0 inside .session-body) span the full horizontal area. Chat prose
       keeps a reading measure via .timeline/.composer below; the session bar
       spans full width as a toolbar. */
    .wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    /* ── Connect / new-session screen ── */
    .connect {
      margin: auto;
      width: min(640px, 92vw);
      padding: 32px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--surface-modal);
      box-shadow: var(--widget-shadow);
      text-align: center;
    }
    .connect h2 { font-size: var(--font-size-2xl); font-weight: 600; color: var(--bright-white); margin-bottom: 8px; letter-spacing: -0.02em; }
    .connect p { font-size: var(--font-size-md); color: var(--gray); margin-bottom: 24px; line-height: 1.55; }
    .connect-hint { margin: 12px 0 0; font-size: var(--font-size-sm); color: var(--neutral-gray); line-height: 1.5; text-align: center; }
    .field { text-align: left; margin-bottom: 14px; }
    .field label { display: block; font-size: var(--font-size-xs); font-weight: 600; color: var(--neutral-gray); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }

    /* Agent picker — one chip per available ACP agent */
    .agent-picker { display: flex; flex-wrap: wrap; gap: 8px; }
    .agent-picker.primary-agent-picker {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .agent-picker.primary-agent-picker .agent-chip-wrap {
      display: flex;
    }
    .agent-picker.primary-agent-picker .agent-chip {
      width: 100%;
      justify-content: center;
      padding: 13px 16px;
      min-height: 48px;
      border-color: var(--accent-a25);
      background: linear-gradient(180deg, var(--w8), var(--w5));
      color: var(--bright-white);
      font-size: var(--font-size-lg);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
    }
    .agent-picker.primary-agent-picker .agent-chip:hover {
      border-color: var(--accent-a45);
      background: linear-gradient(180deg, var(--w12), var(--w8));
      transform: translateY(-1px);
    }
    .other-agents {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--glass-border);
    }
    .other-agents-heading {
      margin: 0 0 7px;
      font-size: var(--font-size-xs);
      font-weight: 700;
      color: var(--neutral-gray);
      text-transform: uppercase;
      letter-spacing: 0.7px;
    }
    .agent-picker.secondary-agent-picker {
      gap: 6px;
    }
    .agent-picker.secondary-agent-picker .agent-chip {
      padding: 7px 10px;
      background: transparent;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      font-weight: 500;
    }
    .agent-picker.secondary-agent-picker .agent-chip:hover {
      color: var(--white);
      background: var(--w5);
    }
    .agent-picker.secondary-agent-picker .agent-chip.sel {
      color: var(--bright-white);
      background: var(--accent-a15);
    }
    .custom-only-agent-picker {
      margin-top: 10px;
    }
    .agent-warning {
      margin: 0 0 8px;
      padding: 9px 11px;
      border: 1px solid var(--amber-a25);
      border-radius: var(--radius);
      background: var(--amber-a15);
      color: var(--amber);
      font-size: var(--font-size-sm);
      line-height: 1.45;
    }
    .agent-warning strong {
      color: var(--amber);
      font-weight: 700;
    }
    .agent-warning code {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      background: var(--amber-a15);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .agent-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-md);
      font-family: var(--font);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .agent-chip:hover { border-color: var(--accent-a35); background: var(--w8); }
    .agent-chip.sel { border-color: var(--accent); background: var(--accent-a18); color: var(--bright-white); box-shadow: 0 0 0 3px var(--accent-a15); }
    .agent-picker.primary-agent-picker .agent-chip.sel {
      background: linear-gradient(180deg, var(--accent-a25), var(--accent-a18));
    }
    .agent-chip.uninstalled { opacity: 0.7; }
    .chip-tag {
      font-size: var(--font-size-xs);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--amber);
      background: var(--amber-a25, rgba(245, 158, 11, 0.15));
      padding: 1px 6px;
      border-radius: 99px;
    }
    @media (max-width: 620px) {
      .connect {
        padding: 24px;
      }
      .agent-picker.primary-agent-picker {
        grid-template-columns: 1fr;
      }
    }
    /* Custom-agent chip with hover-revealed edit/remove controls */
    .agent-chip-wrap { display: inline-flex; align-items: stretch; }
    .chip-edit {
      display: none;
      align-items: center;
      padding: 0 8px;
      margin-left: 4px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--neutral-gray);
      font-size: var(--font-size-base);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .agent-chip-wrap:hover .chip-edit, .agent-chip-wrap.sel .chip-edit { display: inline-flex; }
    .chip-edit:hover { color: var(--bright-white); border-color: var(--accent-a35); background: var(--w8); }
    .chip-edit svg, .queued-x svg, .attach-x svg, .queued-icon svg { display: block; }
    .add-agent { border-style: dashed; color: var(--neutral-gray); }
    .add-agent:hover { color: var(--bright-white); }
    .chip-tag-ok {
      color: var(--accent);
      background: var(--accent-a18);
    }
    .auth-mode-field { }
    .auth-key-status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: var(--font-size-base);
      color: var(--gray);
    }
    .auth-key-status code {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      background: var(--w8);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .chip-edit-inline { display: inline-flex; margin-left: 0; padding: 2px 8px; }
    .auth-key-editor {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    .auth-key-editor .path-input { flex: 1; }
    .agent-form {
      margin-top: 12px;
      padding: 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg, 12px);
      background: var(--w5);
      text-align: left;
    }
    .agent-form-title { font-weight: 600; color: var(--bright-white); margin-bottom: 10px; }
    .af-row { margin-bottom: 10px; }
    .af-row label { display: block; font-size: var(--font-size-xs); font-weight: 600; color: var(--neutral-gray); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
    .af-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--gray); }
    .af-env { resize: vertical; }
    .af-check { display: flex; align-items: center; gap: 7px; font-size: var(--font-size-base); color: var(--white); margin: 6px 0 12px; cursor: pointer; }
    .af-check code { font-family: var(--font-mono); font-size: var(--font-size-xs); background: var(--w8); padding: 1px 5px; border-radius: 4px; }
    .af-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .af-cancel, .af-save {
      padding: 8px 16px;
      border-radius: var(--radius);
      font-size: var(--font-size-base);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .af-cancel { border: 1px solid var(--glass-border); background: transparent; color: var(--gray); }
    .af-cancel:hover { color: var(--white); border-color: var(--accent-a35); }
    .af-save { border: none; background: var(--accent); color: var(--on-accent); }
    .af-save:hover { background: var(--purple); }
    .af-save:disabled, .af-cancel:disabled { opacity: 0.6; cursor: not-allowed; }
    select, .path-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-md);
      font-family: var(--font);
      outline: none;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .path-input { font-family: var(--font-mono); font-size: var(--font-size-base); }
    select:focus, .path-input:focus { border-color: var(--accent-a35); box-shadow: 0 0 0 3px var(--accent-a15); }
    select option { background: var(--surface-raised); color: var(--white); }
    .primary-btn {
      width: 100%;
      margin-top: 4px;
      padding: 12px;
      border: none;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--on-accent);
      font-size: var(--font-size-md);
      font-weight: 600;
      cursor: pointer;
      transition: background var(--transition-fast), transform var(--transition-fast);
    }
    .primary-btn:hover { filter: brightness(1.12) saturate(1.05); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.18); }
    .primary-btn:active { transform: translateY(1px); filter: brightness(0.95); }
    .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

    /* Live stderr tail shown while an agent connects, so a stuck launch shows
       its real cause (e.g. "command not found") instead of a mute spinner. */
    .connect-log {
      margin: 10px 0 0;
      padding: 8px 10px;
      max-height: 96px;
      overflow: auto;
      border-radius: var(--radius);
      background: var(--surface-sunken, rgba(0, 0, 0, 0.25));
      color: var(--neutral-gray);
      font-family: var(--font-mono, monospace);
      font-size: var(--font-size-sm);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .connect-cancel {
      width: 100%;
      margin-top: 8px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: transparent;
      color: var(--text);
      font-size: var(--font-size-md);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .connect-cancel:hover { background: var(--surface-hover, rgba(255, 255, 255, 0.06)); }

    /* ── Session header ── */
    .session-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--glass-border);
    }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .session-logo { display: inline-flex; flex-shrink: 0; }
    .session-name { font-size: var(--font-size-md); font-weight: 600; color: var(--bright-white); flex-shrink: 0; }
    .session-cwd { font-family: var(--font-mono); font-size: var(--font-size-sm); color: var(--neutral-gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; direction: rtl; }
    .session-branch { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 2px 8px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--accent); background: var(--accent-a15); border: 1px solid var(--accent-a25); }
    .session-spacer { flex: 1; }
    .session-bar .usage { flex-shrink: 0; }
    .usage-group { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .session-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

    /* Isolated-worktree toggle in the connect/new-session picker. */
    .worktree-field { display: flex; flex-direction: column; gap: 8px; }
    .wt-toggle { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; text-transform: none; letter-spacing: normal; font-weight: 500; color: var(--white); }
    .wt-toggle input { margin-top: 2px; accent-color: var(--accent); }
    .wt-branch { font-family: var(--font-mono); }

    /* Context usage meter, message/block/plan styles live in timelineStyles
       (shared with the Behind the Scenes showcase). Header actions reuse the
       composer's .icon-btn base (round 32×32, flex-shrink: 0); the rules below
       only add the header-specific outlined/danger/toggle variants. */
    .session-actions .icon-btn, .usage-group .icon-btn {
      background: transparent;
      color: var(--gray);
      border: 1px solid var(--glass-border);
      width: auto;
      height: 32px;
      gap: 6px;
      padding: 0 12px;
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
    }
    .session-actions .icon-btn .btn-label, .usage-group .icon-btn .btn-label { white-space: nowrap; }
    .session-actions .icon-btn:hover:not(:disabled), .usage-group .icon-btn:hover:not(:disabled) { color: var(--bright-white); border-color: var(--accent-a35); background: var(--accent-a10); }
    .session-actions .icon-btn:disabled, .usage-group .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .session-actions .icon-btn.danger:hover:not(:disabled) { color: var(--red); border-color: var(--red); background: var(--red-a15); }

    /* Auto-accept toggle: only the shield icon turns green when "on"; label stays readable. */
    .auto-accept-btn.on { color: var(--bright-white); border-color: var(--accent); background: var(--accent-a18); }
    .auto-accept-btn.on:hover:not(:disabled) { color: var(--bright-white); border-color: var(--accent); background: var(--accent-a25); }
    .auto-accept-btn.on svg { color: var(--emerald); }

    /* One-time nudge pointing at the Auto-accept toggle. */
    .auto-accept-wrap { position: relative; display: inline-flex; }
    .auto-accept-hint {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 8px;
      width: 260px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: var(--surface-raised);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      box-shadow: var(--shadow-md);
      animation: card-fade-in 0.16s cubic-bezier(0.2, 0, 0, 1) both;
    }
    .auto-accept-hint .aah-body { display: flex; flex-direction: column; gap: 4px; }
    .auto-accept-hint strong { color: var(--bright-white); font-size: var(--font-size-sm); font-weight: 600; }
    .auto-accept-hint span { color: var(--gray); font-size: var(--font-size-sm); line-height: 1.4; }
    .auto-accept-hint .aah-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .auto-accept-hint .aah-enable {
      border: none;
      background: var(--accent);
      color: #fff;
      font-size: var(--font-size-sm);
      font-weight: 600;
      padding: 5px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .auto-accept-hint .aah-enable:hover { filter: brightness(1.08); }
    .auto-accept-hint .aah-dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--gray);
      padding: 4px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .auto-accept-hint .aah-dismiss:hover { color: var(--bright-white); background: var(--w5); }
    @keyframes card-fade-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .resume-backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      z-index: 220;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--overlay-scrim, rgba(0, 0, 0, 0.58));
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      animation: resume-fade-in 0.14s ease-out;
    }
    .resume-dialog {
      width: min(460px, 100%);
      padding: 18px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--surface-modal);
      box-shadow: var(--shadow-lg, 0 18px 60px rgba(0, 0, 0, 0.45));
      animation: resume-pop-in 0.16s cubic-bezier(0.2, 0, 0, 1);
    }
    .resume-kicker {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      padding: 3px 8px;
      border: 1px solid var(--accent-a25);
      border-radius: 999px;
      background: var(--accent-a10);
      color: var(--accent-light, var(--accent));
      font-size: var(--font-size-xs);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .resume-title {
      margin: 0;
      color: var(--bright-white);
      font-size: var(--font-size-xl);
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    .resume-body {
      margin: 8px 0 0;
      color: var(--gray);
      font-size: var(--font-size-sm);
      line-height: 1.55;
    }
    .resume-prompt {
      margin-top: 14px;
      max-height: 140px;
      overflow: auto;
      padding: 11px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .resume-note {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      padding: 10px 11px;
      border: 1px solid var(--accent-a25);
      border-radius: var(--radius);
      background: var(--accent-a10);
      color: var(--gray);
      font-size: var(--font-size-sm);
      line-height: 1.45;
    }
    .resume-note.warn {
      border-color: var(--amber-a35, rgba(245, 158, 11, 0.35));
      background: var(--amber-a15, rgba(245, 158, 11, 0.12));
    }
    .resume-note svg {
      flex-shrink: 0;
      margin-top: 1px;
      color: var(--accent-light, var(--accent));
    }
    .resume-note.warn svg { color: var(--amber); }
    .rewind-dialog { width: min(560px, 100%); }
    .rewind-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 14px;
      max-height: 340px;
      overflow: auto;
      padding-right: 2px;
    }
    .rewind-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 11px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w5);
      color: var(--white);
      font-family: var(--font);
      font-size: var(--font-size-sm);
      text-align: left;
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .rewind-item:hover:not(:disabled) {
      border-color: var(--accent);
      background: var(--w8);
    }
    .rewind-item:disabled { opacity: 0.5; cursor: default; }
    .rewind-num {
      flex-shrink: 0;
      min-width: 20px;
      color: var(--gray);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .rewind-text {
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .rewind-flag {
      flex-shrink: 0;
      display: inline-flex;
      color: var(--accent-light, var(--accent));
    }
    .resume-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 18px;
    }
    .resume-btn {
      padding: 8px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-family: var(--font);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    }
    .resume-btn:hover:not(:disabled) {
      border-color: var(--glass-border-hover);
      background: var(--w8);
    }
    .resume-btn.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--on-accent);
    }
    .resume-btn.primary:hover:not(:disabled) { filter: brightness(1.06); }
    .resume-btn.danger {
      border-color: var(--red-a25, var(--red));
      background: var(--red-a15);
      color: var(--red);
    }
    .resume-btn.danger:hover:not(:disabled) {
      border-color: var(--red);
      background: var(--red);
      color: var(--bright-white);
    }
    .resume-btn:disabled { opacity: 0.5; cursor: default; }
    @keyframes resume-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes resume-pop-in {
      from { opacity: 0; transform: scale(0.97) translateY(4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .resume-backdrop,
      .resume-dialog { animation: none; }
    }

    /* ── Timeline ── */
    /* Below the session bar, the view splits into a chat column (timeline +
       composer) and, when open, a resizable side-panel (Files/Review). The
       chat column reflows narrower as the panel opens rather than being covered. */
    .split {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
    }
    .chat-col {
      flex: 1;
      /* min-width:0 lets the column shrink below its content width so the
         panel can claim space; the timeline/composer reflow to match. */
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .session-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    /* Floating pill shown when the user has scrolled up off the bottom of the
       active timeline. Overlays the lower-center of the chat column, just above
       the composer, mirroring Claude.ai / ChatGPT. */
    .jump-latest {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px 6px 11px;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
      background: var(--surface-modal, var(--bg));
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      box-shadow: var(--shadow-lg);
      z-index: 6;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      animation: jump-pill-in 0.16s ease-out;
    }
    .jump-latest:hover { border-color: var(--accent-a35); background: var(--bg-elevated-hover); }
    .jump-latest svg { display: block; }
    @keyframes jump-pill-in {
      from { opacity: 0; transform: translate(-50%, 6px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
    @media (prefers-reduced-motion: reduce) { .jump-latest { animation: none; } }
    /* Find in conversation bar — floats over the top-right of the chat column,
       above the timeline, like a browser / VS Code find widget. */
    .find-bar {
      position: absolute;
      top: 10px;
      right: 16px;
      z-index: 7;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 6px 5px 10px;
      border-radius: 10px;
      border: 1px solid var(--glass-border);
      background: var(--surface-modal, var(--bg));
      box-shadow: var(--shadow-lg);
      animation: jump-pill-in 0.14s ease-out;
    }
    @media (prefers-reduced-motion: reduce) { .find-bar { animation: none; } }
    .find-input {
      width: 200px;
      border: none;
      outline: none;
      background: transparent;
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: inherit;
    }
    .find-input::placeholder { color: var(--text-tertiary, var(--text-secondary)); }
    .find-count {
      font-size: var(--font-size-xs);
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
      min-width: 42px;
      text-align: right;
      white-space: nowrap;
    }
    .find-count.empty { color: var(--danger, #e5484d); min-width: auto; }
    .find-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .find-btn:hover:not(:disabled) { background: var(--bg-elevated-hover); color: var(--white); }
    .find-btn:disabled { opacity: 0.4; cursor: default; }
    .find-btn svg { display: block; }
    /* CSS Custom Highlight API paints matches without touching the DOM. Scoped to
       this shadow root, where the timeline text lives. */
    ::highlight(kairos-find) {
      background: var(--accent-a35, rgba(59, 130, 246, 0.35));
      color: var(--white);
    }
    ::highlight(kairos-find-current) {
      background: var(--accent, #3b82f6);
      color: #fff;
    }
    .timeline {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      /* Prose stays at a legible measure and centered; the scroll container
         itself still fills the column so the scrollbar rides the far edge.
         border-box keeps the horizontal padding inside width:100% — the global
         reset in theme.css doesn't pierce this shadow root, so without it the
         4px side padding pushes the timeline past .main and forces a spurious
         horizontal scrollbar that clips content on the right. */
      box-sizing: border-box;
      width: 100%;
      max-width: var(--chat-measure);
      margin: 0 auto;
    }
    /* Inactive sessions keep their timeline mounted (so switching is a
       show/hide, not a rebuild) but out of layout and non-scrollable. */
    .timeline.hidden { display: none; }
    /* In-flow side-panel beside the chat column. Width changes are deliberately
       instant: animating a flex width forces every visible diff row in the chat
       column to relayout on each frame, which is pathological for large diffs. */
    .side-panel {
      flex-shrink: 0;
      position: relative;
      height: 100%;
      background: var(--surface-modal, var(--bg));
      overflow: hidden;
    }
    /* Divider only when the panel actually holds content, so a collapsed
       (width:0) panel leaves no stray line beside the rail. */
    .side-panel.open { border-left: 1px solid var(--glass-border); }
    /* While dragging the edge, drop the transition so the panel tracks the pointer. */
    :host([data-panel-resizing]) .side-panel { transition: none; }
    /* Drag handle straddling the panel's left border (mirrors the sidebar's). */
    .panel-resize-handle {
      position: absolute;
      top: 0;
      left: -3px;
      width: 7px;
      height: 100%;
      cursor: col-resize;
      z-index: 5;
      touch-action: none;
    }
    .panel-resize-handle::after {
      content: '';
      position: absolute;
      top: 0;
      left: 3px;
      width: 1px;
      height: 100%;
      background: transparent;
      transition: background var(--transition-fast);
    }
    .panel-resize-handle:hover::after,
    :host([data-panel-resizing]) .panel-resize-handle::after { background: var(--accent); }
    /* Vertical rail on the far right: Files/Review toggles that expand the panel. */
    .panel-rail {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 6px;
      border-left: 1px solid var(--glass-border);
      background: var(--w3);
    }
    .rail-btn {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      width: 48px;
      padding: 8px 2px;
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--gray);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .rail-btn:hover { color: var(--bright-white); background: var(--accent-a10); }
    .rail-btn.on { color: var(--bright-white); background: var(--accent-a18); }
    .rail-btn svg { display: block; }
    .rail-label { font-size: 10px; font-weight: 600; letter-spacing: 0.02em; }
    /* Divider setting the more behind-the-scenes "Frames" toggle apart from the
       task-oriented panels above it. */
    .rail-sep {
      width: 24px;
      height: 1px;
      margin: 4px auto;
      background: var(--glass-border);
    }
    /* The Frames toggle reads as the developer/behind-the-scenes panel: muted by
       default, tinted (not filled) when active. */
    .rail-btn.frames { color: var(--neutral-gray); }
    .rail-btn.frames.on { color: var(--purple-light); background: var(--accent-a10); }
    /* Small dot marking that a summary has already been generated. */
    .rail-dot {
      position: absolute;
      top: 6px;
      right: 8px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
    }
    .review-count {
      position: absolute;
      top: -4px;
      right: -4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 15px;
      height: 15px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--accent);
      color: var(--on-accent);
      font-size: 9px;
      font-weight: 600;
      line-height: 1;
    }
    .empty-session {
      margin: auto;
      text-align: center;
      color: var(--neutral-gray);
      font-size: var(--font-size-md);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      max-width: 480px;
      animation: empty-rise var(--transition-slow) both;
    }
    @keyframes empty-rise {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }
    .empty-session .lead {
      color: var(--bright-white);
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .empty-session .sub { color: var(--gray); font-size: var(--font-size-md); }
    .suggest { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
    .suggest button {
      padding: 7px 13px;
      border: 1px solid var(--border);
      border-radius: 99px;
      background: var(--w4);
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-family: var(--font);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .suggest button:hover { border-color: var(--accent-a35); background: var(--accent-a10); color: var(--bright-white); }
    .empty-session .tip {
      margin-top: 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 420px;
      max-width: 100%;
    }
    .empty-session .tip-text {
      flex: 1;
      height: 68px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 3px;
      font-size: var(--font-size-sm);
      line-height: 1.5;
      text-align: center;
    }
    .empty-session .tip-label { color: var(--gray); font-weight: 600; }
    .empty-session .tip-body { color: var(--neutral-gray); }
    .tip-nav {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 99px;
      background: var(--w4);
      color: var(--neutral-gray);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .tip-nav:hover { border-color: var(--accent-a35); background: var(--accent-a10); color: var(--bright-white); }

    /* Message, thought, and content-block styles live in timelineStyles. */

    /* Live status rows (working / waiting) — the <status-indicator> carries its own label. */
    .thinking-row { display: flex; align-items: center; gap: 9px; padding: 2px 0; }

    .show-earlier {
      align-self: center;
      margin: 4px auto 12px;
      padding: 5px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--surface-raised);
      color: var(--color-text-muted);
      font-size: var(--font-size-xs);
      font-weight: 500;
      cursor: pointer;
    }
    .show-earlier:hover { color: var(--white); border-color: var(--accent-a25); }

    /* Plan checklist styles live in timelineStyles. */

    /* ── Composer ── */
    .composer {
      padding: 8px 20px 12px;
      position: relative;
      /* Match the timeline's reading measure so the input aligns under the
         conversation rather than stretching the full column width. */
      width: 100%;
      max-width: var(--chat-measure);
      margin: 0 auto;
      box-sizing: border-box;
    }

    /* ── Search-with-agent resume chips ── */
    .search-matches {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      width: 100%;
      max-width: var(--chat-measure);
      margin: 0 auto;
      padding: 0 20px;
      box-sizing: border-box;
    }
    .search-matches-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-size-base);
      color: var(--gray);
    }
    .search-match {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 260px;
      padding: 4px 10px;
      border: 1px solid var(--accent-a35);
      border-radius: 999px;
      background: var(--accent-a15);
      color: var(--white);
      font-size: var(--font-size-base);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .search-match:hover { background: var(--accent-a25); }
    .search-match-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Slash-command menu ── */
    .slash-menu {
      position: absolute;
      bottom: 100%;
      left: 20px;
      right: 20px;
      margin-bottom: 6px;
      max-height: 280px;
      overflow-y: auto;
      padding: 5px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      background: var(--surface-modal);
      box-shadow: var(--shadow-lg);
      backdrop-filter: blur(var(--overlay-blur));
      -webkit-backdrop-filter: blur(var(--overlay-blur));
      z-index: 20;
    }
    .slash-item {
      display: flex;
      align-items: baseline;
      gap: 10px;
      width: 100%;
      text-align: left;
      padding: 7px 10px;
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--white);
      font-family: var(--font);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    .slash-item.active { background: var(--accent-a18); }
    .slash-name { font-family: var(--font-mono); font-weight: 600; color: var(--bright-white); flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; }
    .slash-badge {
      font-family: var(--font);
      font-weight: 500;
      font-size: var(--font-size-xs);
      padding: 0 6px;
      border-radius: 99px;
      background: var(--accent-a15);
      color: var(--purple-light);
    }
    .slash-desc { color: var(--neutral-gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .composer-box {
      position: relative;
      min-width: 0;
      border: 1px solid transparent;
      border-radius: var(--radius-lg);
      background: var(--w4);
      box-shadow: none;
      transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .composer-box:focus-within { background: var(--w5); box-shadow: 0 0 0 1px var(--accent-a35), 0 0 0 4px var(--accent-a10); }
    .composer-box.busy:not(:focus-within) { border-color: var(--accent-a25); background: var(--w4); box-shadow: inset 0 0 0 1px var(--accent-a10); }
    textarea {
      display: block;
      box-sizing: border-box;
      width: 100%;
      resize: none;
      /* Fits one full line (14px × 1.55 ≈ 22px) plus the 17px vertical padding,
         so an empty box never clips its placeholder onto the footer chips. */
      min-height: 40px;
      max-height: 200px;
      padding: 13px 16px 4px;
      border: none;
      background: transparent;
      color: var(--white);
      font-size: var(--font-size-md);
      font-family: var(--font);
      line-height: 1.55;
      outline: none;
      overflow-x: hidden;
      overflow-wrap: anywhere;
    }
    .composer-sizer {
      position: absolute;
      inset: 0 0 auto 0;
      height: 0;
      min-height: 0;
      max-height: none;
      overflow: hidden;
      visibility: hidden;
      pointer-events: none;
      user-select: none;
    }
    textarea::placeholder { color: var(--neutral-gray); }
    .composer-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 6px;
      padding: 6px 8px 8px;
      min-width: 0;
    }
    /* Config chips wrap onto extra rows rather than overflowing the box;
       the action icons stay pinned to the bottom-right. */
    .composer-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }
    .composer-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      flex-shrink: 0;
    }
    /* Config controls live in a relative wrapper so each popover anchors to its
       own trigger rather than the whole footer. */
    .config-ctl { position: relative; display: inline-flex; min-width: 0; max-width: 100%; }

    /* Config dropdown trigger. Shows the current value as a compact pill; the
       menu carries names, descriptions, and inferred defaults. */
    .config-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px 4px 11px;
      border: 1px solid transparent;
      border-radius: 99px;
      background: transparent;
      color: var(--gray);
      min-width: 0;
      max-width: 100%;
      font-size: var(--font-size-sm);
      font-family: var(--font);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .config-trigger-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .config-trigger:hover { background: var(--w6); color: var(--bright-white); }
    .config-trigger.open { background: var(--accent-a10); color: var(--bright-white); }
    .config-trigger .caret { width: 9px; height: 9px; opacity: 0.7; transition: transform var(--transition-fast); }
    .config-trigger.open .caret { transform: rotate(180deg); }

    .config-menu {
      position: absolute;
      bottom: calc(100% + 7px);
      left: 0;
      min-width: 240px;
      max-width: 340px;
      max-height: 320px;
      overflow-y: auto;
      padding: 5px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      background: var(--surface-modal);
      box-shadow: var(--shadow-lg);
      backdrop-filter: blur(var(--overlay-blur));
      -webkit-backdrop-filter: blur(var(--overlay-blur));
      z-index: 20;
    }
    .config-group-label {
      padding: 8px 10px 4px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--neutral-gray);
    }
    .config-item {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--white);
      font-family: var(--font);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .config-item:hover, .config-item.active { background: var(--w8); }
    .config-check {
      flex-shrink: 0;
      width: 14px;
      margin-top: 2px;
      color: var(--purple-light);
      font-size: var(--font-size-sm);
    }
    .config-item-body { min-width: 0; }
    .config-item-name { font-size: var(--font-size-sm); font-weight: 500; color: var(--bright-white); }
    .config-item-desc {
      margin-top: 1px;
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      line-height: 1.4;
    }
    .icon-btn {
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      flex-shrink: 0;
      transition: background var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast);
    }
    .icon-btn svg { display: block; }
    .icon-btn.send { background: var(--accent); color: var(--on-accent); }
    .icon-btn.send:hover:not(:disabled) { background: var(--purple); }
    .icon-btn.send:active:not(:disabled) { transform: scale(0.92); }
    .icon-btn.send:disabled { opacity: 0.35; cursor: not-allowed; }
    .icon-btn.stop { background: var(--red); color: var(--on-accent); }
    .icon-btn.stop:hover { background: #dc2626; }
    .stop-sq { width: 11px; height: 11px; border-radius: 2px; background: currentColor; }
    .icon-btn.mic { background: transparent; color: var(--gray); border: 1px solid transparent; }
    .icon-btn.mic:hover:not(:disabled):not(.listening) { color: var(--bright-white); background: var(--accent-a10); }
    .icon-btn.mic:disabled { opacity: 0.35; cursor: not-allowed; }
    .icon-btn.attach { background: transparent; color: var(--gray); border: 1px solid transparent; }
    .icon-btn.attach:hover:not(:disabled) { color: var(--bright-white); background: var(--accent-a10); }
    .icon-btn.attach:disabled { opacity: 0.35; cursor: not-allowed; }
    .icon-btn.slash { background: transparent; color: var(--gray); border: 1px solid transparent; font-family: var(--font-mono); }
    .icon-btn.slash:hover:not(:disabled) { color: var(--bright-white); background: var(--accent-a10); }
    .icon-btn.slash.active { color: var(--bright-white); background: var(--accent-a10); }
    .icon-btn.slash:disabled { opacity: 0.35; cursor: not-allowed; }
    .file-input { display: none; }
    .icon-btn.mic.listening {
      background: var(--red);
      color: var(--on-accent);
      border-color: var(--red);
      animation: mic-pulse 1.4s ease-in-out infinite;
    }
    .icon-btn.mic.listening:hover:not(:disabled) { background: #dc2626; border-color: #dc2626; }
    @keyframes mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--red-a15, rgba(239, 68, 68, 0.35)); }
      50% { box-shadow: 0 0 0 6px transparent; }
    }

    /* ── Queued steers ── */
    .queued { display: flex; flex-direction: column; gap: 5px; margin-bottom: 7px; }
    .queued-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px 6px 11px;
      border: 1px dashed var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a10);
    }
    .queued-icon { color: var(--purple-light); font-size: var(--font-size-sm); flex-shrink: 0; }
    .queued-text {
      flex: 1;
      min-width: 0;
      font-size: var(--font-size-sm);
      color: var(--gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .queued-x {
      flex-shrink: 0;
      width: 20px; height: 20px;
      display: flex; align-items: center; justify-content: center;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .queued-x:hover { background: var(--red-a15); color: var(--red); }

    /* ── Pending attachments ── */
    .attachments { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 8px 0; }
    .attach-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 8px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w4);
      max-width: 220px;
    }
    .attach-thumb { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .attach-icon { color: var(--accent); font-weight: 600; flex-shrink: 0; }
    .attach-name {
      min-width: 0;
      font-size: var(--font-size-sm);
      color: var(--gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .attach-x {
      flex-shrink: 0;
      width: 18px; height: 18px;
      display: flex; align-items: center; justify-content: center;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .attach-x:hover { background: var(--red-a15); color: var(--red); }

    /* .system-note style lives in timelineStyles. */
    .banner-error {
      margin: 8px 20px 0;
      padding: 9px 13px;
      border-radius: var(--radius);
      background: var(--red-a15);
      border: 1px solid var(--red-a25);
      color: var(--red);
      font-size: var(--font-size-sm);
    }
    .banner-error.attach-error {
      margin: 0 0 8px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .banner-error.attach-error > span { flex: 1; }
    .attach-error-x {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border: none;
      background: transparent;
      color: inherit;
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0.7;
    }
    .attach-error-x:hover { opacity: 1; background: var(--red-a25); }
    .auth-panel {
      margin: 8px 0 0;
      padding: 14px 16px;
      border-radius: var(--radius);
      background: var(--accent-a08);
      border: 1px solid var(--accent-a18);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .auth-panel .auth-desc {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      line-height: 1.4;
    }
    .banner-stalled {
      margin: 8px 20px 0;
      padding: 9px 13px;
      border-radius: var(--radius);
      background: var(--amber-a15);
      border: 1px solid var(--amber-a25);
      color: var(--amber);
      font-size: var(--font-size-sm);
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .banner-stalled .banner-actions { display: flex; gap: 8px; flex-shrink: 0; }
    .banner-stalled button {
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--amber-a25);
      background: transparent;
      color: var(--amber);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    .banner-stalled button:hover { background: var(--amber-a15); }
    .banner-stalled button.primary {
      background: var(--amber);
      border-color: var(--amber);
      color: var(--bg);
      font-weight: 500;
    }
    .banner-stalled button.primary:hover { opacity: 0.9; }
    .banner-stalled button.ghost { border-color: var(--border); color: var(--color-text-muted); }
    .banner-stalled button.ghost:hover { background: var(--glass-bg-hover); color: var(--color-text); }
    .loading-pane {
      margin: auto;
      text-align: center;
      color: var(--gray);
      display: flex; flex-direction: column; align-items: center; gap: 12px;
    }
    .loading-pane .pip { width: 8px; height: 8px; border-radius: 50%; background: var(--purple-light); animation: pulse 1.2s ease-in-out infinite; }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.client.setHandlers({
      onInitialized: (info) => {
        this.recordFrame('initialized', info, undefined, `${info.agentId} · v${info.protocolVersion}`);
        this.onInitialized(info);
      },
      onSession: (info) => {
        this.recordFrame('session', info, info.sessionId, `new · ${info.agentId}`);
        this.onSession(info);
      },
      onSessionLoaded: (info) => this.onSessionLoaded(info),
      onUpdate: (sid, update) => {
        this.recordFrame('update', update, sid, (update as { sessionUpdate?: string }).sessionUpdate ?? 'update');
        this.onUpdate(sid, update);
      },
      onConfigOptions: (sid, configOptions) => {
        this.recordFrame('config-options', { sessionId: sid, configOptions }, sid, `${configOptions.length} option${configOptions.length === 1 ? '' : 's'}`);
        this.onConfigOptions(sid, configOptions);
      },
      onPermissionRequest: (req) => {
        this.recordFrame('permission-request', req, req.sessionId, req.toolCall?.title ?? 'permission');
        this.onPermissionRequest(req);
      },
      onElicitationRequest: (req) => {
        this.recordFrame('elicitation-request', req, req.sessionId, req.message?.slice(0, 60) || 'elicitation');
        this.onElicitationRequest(req);
      },
      onTerminalOutput: (sid, terminalId, output) => this.onTerminalOutput(sid, terminalId, output),
      onTerminalAuthOpened: (success, error) => {
        if (!success) this.connError = error || 'Failed to open login terminal.';
      },
      onStop: (sid, stopReason, usage) => {
        this.recordFrame('stop', { sessionId: sid, stopReason, usage }, sid, stopReason || 'end_turn');
        const s = this.session(sid);
        if (s) {
          s.convo.addTurnUsage(usage);
          s.usage = s.convo.usage;
        }
        this.onStop(sid);
      },
      onStalled: (sid, secs) => this.onStalled(sid, secs),
      onAgentRestarted: (agentId) => this.onAgentRestarted(agentId),
      onError: (msg, sid, agentId) => this.onError(msg, sid, agentId),
      onLoadError: (sid, msg) => this.onLoadError(sid, msg),
      onExit: (_code, agentId, detail) => this.onExit(agentId, detail),
      onLog: (stream, text, agentId) => this.onLog(stream, text, agentId),
    });
    // Reconcile browser-local prefs with the on-disk stores (and run the
    // one-time localStorage→disk migration), then refresh the reactive fields
    // that were seeded synchronously from localStorage at construction.
    hydrateAgentPrefs().then(() => {
      this.cwd = loadLastCwd();
      this.selectedAgent = loadLastAgent();
      this.prefsHydrated = true;
      this.maybeRestoreOpenSessions();
    });
    this.loadWorkspaces();
    this.loadAgents();
    // Detect git status for the pre-filled cwd so the worktree toggle appears
    // without requiring the user to touch the path field first.
    const initialCwd = this.cwd.trim();
    if (initialCwd) {
      this.detectingRepo = true;
      this.detectRepoForCwd(initialCwd);
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('keydown', this.onGlobalKeydown);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('workspace-changed', this.onWorkspacesChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.listening) this.stopDictation();
    if (this.speakingItemId) this.stopSpeaking();
    document.removeEventListener('click', this.closeConfigMenu);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('keydown', this.onGlobalKeydown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('workspace-changed', this.onWorkspacesChanged);
    if (this.touchFrame) { cancelAnimationFrame(this.touchFrame); this.touchFrame = 0; }
    if (this.scrollFrame) { cancelAnimationFrame(this.scrollFrame); this.scrollFrame = 0; }
    if (this.preserveScrollFrame) { cancelAnimationFrame(this.preserveScrollFrame); this.preserveScrollFrame = 0; }
    if (this.composerResizeFrame) { cancelAnimationFrame(this.composerResizeFrame); this.composerResizeFrame = 0; }
    if (this.findApplyFrame) { cancelAnimationFrame(this.findApplyFrame); this.findApplyFrame = 0; }
    clearHighlights();
    if (this.panelResizing) this.endPanelResize();
    this.client.dispose();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('sessions')) {
      this.terminateRemovedSessionTerminals(changed.get('sessions') as AgentSession[] | undefined);
    }
    // Navigated away from the Agents tab: stop dictation so the mic isn't left
    // live on a hidden view. Sessions and the socket stay up.
    if (changed.has('active') && !this.active && this.listening) this.stopDictation();
    if (changed.has('active') && !this.active && this.speakingItemId) this.stopSpeaking();
    if (changed.has('activeId')) this.linkedFileRequest = null;
    if (changed.has('activeId') || changed.has('sessions')) this.refreshActiveSourceStatus();
    // Came back to (or focused a different session within) the Agents tab — the
    // user is looking again, so drop any tab-notification badge.
    if (changed.has('active') || changed.has('activeId') || changed.has('view')) this.maybeClearNotification();
    // Switching sessions (or leaving the session view) drops the find bar — its
    // matches are session-scoped. Otherwise, while find is open, re-derive matches
    // as timeline content changes and repaint the highlight after each render.
    if (this.findOpen && (changed.has('activeId') || (changed.has('view') && this.view !== 'session'))) {
      this.closeFind();
    } else if (this.findOpen && this.findQuery) {
      if (this.current && this.current.itemsVersion !== this.findItemsVersionRef) this.recomputeFind();
      else this.scheduleFindHighlight();
    }
    // A Resume click from Sessions/Dashboard hands us an entry to open inline.
    if (changed.has('resumeEntry') && this.resumeEntry) {
      this.resumeAgentSession(this.resumeEntry);
    }
    // A "Start session" click on an agent-capable app prefills the picker.
    if (changed.has('startRequest') && this.startRequest) {
      this.prefillNewSession(this.startRequest);
    }
    // A "Search with <agent>" click from History launches a search session.
    if (changed.has('searchRequest') && this.searchRequest) {
      this.launchSearchSession(this.searchRequest);
    }
    if (
      changed.has('active') ||
      changed.has('activeId') ||
      changed.has('view') ||
      changed.has('panelWidth')
    ) {
      this.scheduleComposerResize(true);
    }
  }

  // Launch a fresh session with the MRU agent and auto-send a prompt that
  // searches the History transcripts for the session the user is after. Unlike
  // prefillNewSession, this goes straight in (no picker step) — the query is
  // already committed. The cwd is the picker's current/last cwd so the agent's
  // `kairos sessions export` sees the same session store.
  private launchSearchSession(req: { query: string; sessions: SessionEntry[]; allSessions?: SessionEntry[] }) {
    const agent = loadLastAgent();
    const cwd = this.cwd.trim() || loadLastCwd();
    const prompt = buildSessionSearchPrompt(req.query, req.sessions);
    const title = `Search: ${req.query}`;
    this.selectedAgent = agent;
    // No role for a search session — the canned prompt is the whole instruction.
    // The match pool rides along so the answer's cited ids become resume chips.
    // Deep search's job is to surface sessions the metadata filter missed, so the
    // pool is the FULL History list, not just the narrowed corpus in the prompt.
    this.startSession(cwd, agent, '', undefined, title, prompt, req.allSessions ?? req.sessions);
  }

  // Land on the new-session picker with the agent preselected and (when given)
  // the working directory prefilled. The user reviews the cwd + worktree toggle
  // and clicks Start — we don't auto-launch, so they can adjust first.
  private prefillNewSession(req: { agent: string; cwd?: string }) {
    this.saveActivePanelState();
    this.activeId = null;
    this.restorePanelState(null);
    this.view = 'session';
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.resumeReplacementEntry = null;
    this.connError = '';
    this.selectedAgent = req.agent;
    if (req.cwd) this.onCwdChanged(req.cwd);
  }

  private onVisibilityChange = () => {
    if (!document.hidden) this.maybeClearNotification();
  };

  // The VS Code workspace picker broadcasts `workspace-changed` after a config
  // save or rescan; refresh our cached list so the new-session dropdown stays
  // in sync instead of holding the paths captured at mount time.
  private onWorkspacesChanged = () => {
    this.loadWorkspaces();
  };

  // Guard against accidentally closing the tab while an agent is mid-turn —
  // the socket dies with the page and takes the live subprocess with it. Any
  // session that's thinking or awaiting an answer counts as "active". The
  // returnValue text is legally required to trigger the prompt but browsers
  // show their own generic message, not ours.
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    const busy = this.sessions.some(
      (s) => s.phase === 'thinking' || s.authRetrying || s.backgroundActive > 0 || s.permission !== null || s.elicitation !== null,
    );
    if (!busy) return;
    e.preventDefault();
    e.returnValue = '';
  };

  // Document-level listener catches global session shortcuts regardless of which
  // element is focused.
  private onGlobalKeydown = (e: KeyboardEvent) => {
    if (this.rewindPickerId) {
      if (e.key === 'Escape') { e.preventDefault(); this.closeRewindPicker(); }
      return;
    }
    if (this.resumePromptDialog) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeResumePromptDialog();
        return;
      }
      if (e.key === 'Enter' && !e.repeat) {
        if (this.shadowRoot?.activeElement instanceof HTMLButtonElement) return;
        e.preventDefault();
        void this.confirmResumeFromPrompt();
        return;
      }
      return;
    }
    // Cmd/Ctrl+F opens Find in conversation for the active session. The webview
    // gives no native find bar, so we own the shortcut. Only within a live
    // session view — elsewhere it falls through to the browser default.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF' && !e.altKey && !e.shiftKey) {
      if (!this.active || this.view !== 'session' || !this.current || this.current.items.length === 0) return;
      e.preventDefault();
      this.openFind();
      return;
    }
    // Escape closes the find bar even when focus has drifted out of it (the bar
    // itself stops propagation, so in-bar Enter/Escape are handled locally).
    if (this.findOpen && e.key === 'Escape') { e.preventDefault(); this.closeFind(); return; }
  };

  // The user is "watching" session `sid` only when the Agents tab is the
  // foreground view (browser tab visible, this view active, session pane — not
  // Behind the Scenes) AND that session is the focused one. Anything else counts
  // as away, so a finished or input-blocked turn raises a tab notification.
  private isWatching(sid: string): boolean {
    return this.active && !document.hidden && this.view === 'session' && this.activeId === sid;
  }

  private notifyIfAway(sid: string, level: 'done' | 'ask') {
    if (!this.isWatching(sid)) notify(level);
  }

  private announceSuccessfulSession() {
    window.dispatchEvent(new CustomEvent('kairos-agent-done'));
  }

  // Stamp a session's finished/attention state so the sidebar can show
  // "Done · Nm ago", and flag it unread when the user isn't watching it — the
  // same guard the notify chime uses, so the row's unread dot and the chime agree.
  private markDone(sid: string) {
    const s = this.session(sid);
    if (!s) return;
    s.doneAt = Date.now();
    if (!this.isWatching(sid)) s.unseen = true;
    // A genuine completion (not a permission/elicitation pause) gives the
    // sidebar pet a short celebrate beat. Same trigger point as the done chime.
    if (s.permission === null && s.elicitation === null) {
      this.petCelebrateUntil = Date.now() + 1500;
      // Re-render once the window lapses so the pet settles back out of celebrate.
      setTimeout(() => this.touch(), 1600);
    }
  }

  // Aggregate mood for the sidebar pet, derived purely from session state.
  private petMood(): PetMood {
    return petMoodFor(this.sessions, this.petCelebrateUntil, Date.now());
  }

  private isDeveloperMode(): boolean {
    return document.documentElement.getAttribute('data-app-mode') === 'developer';
  }

  private currentMode(): string {
    return document.documentElement.getAttribute('data-app-mode') || 'default';
  }

  private modeHeading(): string {
    switch (this.currentMode()) {
      case 'kids': return 'Hey there! 👋';
      case 'professional': return 'Assistant';
      case 'developer': return 'Agents';
      default: return 'Chat';
    }
  }

  /** Default working directory for non-developer modes — users don't need to think about paths. */
  private getDefaultCwd(): string {
    // Try last-used first
    const last = loadLastCwd();
    if (last) return last;
    // Fall back to a safe default — the backend will resolve '~' to the user's home
    return '~';
  }

  private modeDescription(): string {
    switch (this.currentMode()) {
      case 'kids': return 'Pick a helper and ask anything — homework, stories, science experiments, or just for fun!';
      case 'professional': return 'Choose your AI assistant for writing, analysis, research, or document review.';
      case 'developer': return 'Start an agent session. Use Claude, Codex, or Gemini through the Kairos gateway, or connect your own key.';
      default: return 'Choose an AI assistant and start a conversation.';
    }
  }

  private maybeClearNotification() {
    if (this.active && !document.hidden && this.view === 'session') {
      clearNotification();
      // The focused session is being watched now — drop its unread mark even if
      // the user arrived via tab focus / visibility rather than a sidebar click.
      const s = this.activeId ? this.session(this.activeId) : null;
      if (s && s.unseen) { s.unseen = false; this.touch(); }
    }
  }

  private async loadWorkspaces() {
    try {
      const result = await getWorkspaces();
      this.workspaces = result.workspaces.filter((w) => w.exists);
    } catch {
      // empty is fine — user can type a path
    }
  }

  private async loadAgents() {
    try {
      const result = await getAgents();
      this.agentOptions = result.agents;
      // Keep the picker's selection valid if the saved agent is unknown.
      if (!result.agents.some((a) => a.id === this.selectedAgent) && result.agents.length) {
        this.selectedAgent = result.agents[0].id;
      }
    } catch {
      // Fall back to a Claude-only picker if the agents endpoint is unavailable.
      this.agentOptions = [{ id: 'claude', label: 'Claude', managedApp: false, installed: true }];
    }
    this.loadRoles();
    this.loadGlobalRules();
    this.loadPrompts();
    this.loadGreetName();
    this.agentsLoaded = true;
    this.maybeRestoreOpenSessions();
  }

  private maybeRestoreOpenSessions() {
    if (!this.prefsHydrated || !this.agentsLoaded || this.restoredOpenSessions) return;
    this.restoredOpenSessions = true;
    this.restoreOpenSessions();
  }

  private async loadGlobalRules() {
    try {
      this.globalRules = (await getGlobalRules()).rules;
    } catch {
      // Optional; an unavailable endpoint just means no global instructions.
      this.globalRules = '';
    }
  }

  private async loadGreetName() {
    try {
      // Take the first word of the resolved display name ("Rajat Sehgal" →
      // "Rajat"); backend falls back to login when no real name is available.
      const { displayName } = await getSystemUser();
      this.greetName = (displayName || '').trim().split(/\s+/)[0] ?? '';
    } catch {
      this.greetName = '';
    }
  }

  private greeting(): string {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    // No resolvable name degrades to just the time-of-day greeting.
    if (!this.greetName) return part;
    const name = this.greetName.charAt(0).toUpperCase() + this.greetName.slice(1);
    return `${part}, ${name}`;
  }

  private currentTip(): string {
    return FEATURE_TIPS[this.tipIndex];
  }

  // Step tips live (wrapping both ways) and keep the persisted index in sync so a
  // reload continues from where the user left off.
  private stepTip(delta: number) {
    const n = FEATURE_TIPS.length;
    this.tipIndex = (this.tipIndex + delta + n) % n;
    try {
      localStorage.setItem(TIP_INDEX_KEY, String((this.tipIndex + 1) % n));
    } catch { /* quota / disabled — ignore */ }
  }

  private async loadRoles() {
    try {
      this.roles = (await getRoles()).roles;
      // Drop a stale selection if the role was deleted elsewhere.
      if (this.selectedRole && !this.roles.some((r) => r.id === this.selectedRole)) {
        this.selectedRole = '';
      }
    } catch {
      // Roles are optional; an unavailable endpoint just means no role chips.
      this.roles = [];
    }
  }

  // Prompt snippets for the `/` menu. Reloaded whenever the menu opens (below) so
  // edits made in the Customize tab appear without remounting the Agents tab.
  private async loadPrompts(resetSlashIndex = false) {
    try {
      this.prompts = (await getPrompts()).prompts;
    } catch {
      this.prompts = [];
    }
    if (resetSlashIndex && (this.slashOpen || this.slashButtonOpen)) {
      this.slashIndex = 0;
    }
  }

  private openCreateAgent() {
    this.customForm = { mode: 'create', original: '', draft: emptyCustomDraft() };
    this.customFormError = '';
  }

  private openEditAgent(id: string) {
    const opt = this.agentOptions.find((a) => a.id === id);
    if (!opt) return;
    // The picker only carries display fields; the user re-enters command/args
    // to change them. Pre-fill what we know so editing label/install is cheap.
    this.customForm = {
      mode: 'edit',
      original: id,
      draft: { id, label: opt.label, command: '', args: '', env: '', managedApp: opt.managedApp },
    };
    this.customFormError = '';
  }

  private closeAgentForm() {
    this.customForm = null;
    this.customFormError = '';
    this.customFormBusy = false;
  }

  private patchDraft(patch: Partial<CustomAgentDraft>) {
    if (!this.customForm) return;
    this.customForm = { ...this.customForm, draft: { ...this.customForm.draft, ...patch } };
  }

  private async submitAgentForm() {
    if (!this.customForm) return;
    const { mode, original, draft } = this.customForm;
    const id = draft.id.trim();
    const label = draft.label.trim();
    const command = draft.command.trim();
    const args = draft.args.trim().split(/\s+/).filter(Boolean);
    if (mode === 'create' && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      this.customFormError = 'ID must be lowercase letters, digits or hyphens.';
      return;
    }
    if (!label) { this.customFormError = 'Display name is required.'; return; }
    if (args.length === 0) { this.customFormError = 'At least one argument is required.'; return; }

    const env: Record<string, string> = {};
    for (const line of draft.env.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const eq = line.indexOf('=');
      if (eq < 1) { this.customFormError = `Bad env line (need KEY=VALUE): ${line}`; return; }
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    const body = {
      label,
      command: command || undefined,
      args,
      env: Object.keys(env).length ? env : undefined,
      managedApp: draft.managedApp || undefined,
    };

    this.customFormBusy = true;
    this.customFormError = '';
    try {
      if (mode === 'create') await createCustomAgent({ id, ...body });
      else await updateCustomAgent(original, body);
      this.closeAgentForm();
      await this.loadAgents();
      this.selectedAgent = mode === 'create' ? id : original;
    } catch (err) {
      this.customFormError = (err as Error).message || 'Failed to save agent.';
    } finally {
      this.customFormBusy = false;
    }
  }

  private async removeAgent(id: string) {
    const opt = this.agentOptions.find((a) => a.id === id);
    if (!confirm(`Remove custom agent "${opt?.label ?? id}"?`)) return;
    try {
      await deleteCustomAgent(id);
      if (this.selectedAgent === id) this.selectedAgent = 'claude';
      await this.loadAgents();
    } catch (err) {
      this.connError = (err as Error).message || 'Failed to remove agent.';
    }
  }

  // Switch the selected agent to gateway auth. Clears any stored key server-
  // side. Called from the segmented control in the picker.
  private async chooseGatewayAuth(id: string) {
    this.authBusy = true;
    this.authError = '';
    try {
      await setAgentAuth(id, { mode: 'gateway' });
      this.keyDraft = null;
      await this.loadAgents();
    } catch (err) {
      this.authError = (err as Error).message || 'Failed to save auth mode.';
    } finally {
      this.authBusy = false;
    }
  }

  // Switch to key mode. If a key is already stored we send `{ mode: 'key' }`
  // with no `apiKey` — the server keeps the existing key. Otherwise open the
  // inline key input; the user pastes a key and clicks Save, which calls
  // saveApiKey() below.
  private async chooseKeyAuth(id: string) {
    const opt = this.agentOptions.find((a) => a.id === id);
    if (!opt?.keyEnvVar) return;
    this.authError = '';
    if (opt.hasKey) {
      this.authBusy = true;
      try {
        await setAgentAuth(id, { mode: 'key' });
        this.keyDraft = null;
        await this.loadAgents();
      } catch (err) {
        this.authError = (err as Error).message || 'Failed to save auth mode.';
      } finally {
        this.authBusy = false;
      }
      return;
    }
    // No key on file yet — open the input.
    this.keyDraft = { agentId: id, value: '' };
  }

  private async saveApiKey() {
    if (!this.keyDraft) return;
    const { agentId, value } = this.keyDraft;
    const key = value.trim();
    if (!key) { this.authError = 'API key is required.'; return; }
    this.authBusy = true;
    this.authError = '';
    try {
      await setAgentAuth(agentId, { mode: 'key', apiKey: key });
      this.keyDraft = null;
      await this.loadAgents();
    } catch (err) {
      this.authError = (err as Error).message || 'Failed to save API key.';
    } finally {
      this.authBusy = false;
    }
  }

  private openKeyEditor(id: string) {
    this.keyDraft = { agentId: id, value: '' };
    this.authError = '';
  }

  private cancelKeyEditor() {
    this.keyDraft = null;
    this.authError = '';
  }

  // On page load, rehydrate the sessions that were open when the user left.
  // Only the focused session (and any that was mid-turn) auto-resume immediately;
  // everything else stays in "Previously open" — one click away and distinct
  // from timestamp-sorted Recent.
  private restoreOpenSessions() {
    const persisted = loadOpenSessions();
    if (persisted.length === 0) return;

    const savedActiveId = loadActiveSession();
    this.previouslyOpenSessions = persisted;

    // Resume the focused session + any that was mid-turn when the page unloaded.
    // The interrupted-turn hint is injected by onSessionLoaded via interruptedIds.
    for (const p of persisted) {
      const shouldResume = p.id === savedActiveId || p.wasThinking;
      if (shouldResume) {
        if (p.wasThinking) this.interruptedIds.add(p.id);
        this.resumeAgentSession(openSessionToEntry(p), p.worktree);
      }
    }
  }

  // ── Per-agent connection helpers ─────────────────────────────────────────────
  private conn(agentId: string): AgentConn | undefined {
    return this.conns.get(agentId);
  }

  private connState(agentId: string): ConnState {
    return this.conns.get(agentId)?.state ?? 'down';
  }

  private setConn(agentId: string, patch: Partial<AgentConn>) {
    const existing = this.conns.get(agentId) ?? { agentId, state: 'down' as ConnState, name: '', capabilities: {} };
    this.conns.set(agentId, { ...existing, ...patch });
    this.rev++;
  }

  private agentLabel(agentId: string): string {
    return this.agentOptions.find((a) => a.id === agentId)?.label
      ?? agentId.charAt(0).toUpperCase() + agentId.slice(1);
  }

  // ── Session helpers ────────────────────────────────────────────────────────
  private persistOpenSessions() {
    // Only live sessions that exist on disk can be resumed after a relaunch. An
    // ACP agent doesn't write a session until its first turn, so blank new
    // sessions intentionally don't enter the durable restore list.
    const live = describeOpenSessions(this.sessions);
    saveOpenSessionDescriptors(
      mergeOpenSessionDescriptors(live, this.previouslyOpenSessions),
      this.activeId,
    );
  }

  private forgetPreviouslyOpenSession(id: string) {
    if (!this.previouslyOpenSessions.some((s) => s.id === id)) return;
    this.previouslyOpenSessions = this.previouslyOpenSessions.filter((s) => s.id !== id);
  }

  private previouslyOpenEntries(): SessionEntry[] {
    const activeIds = new Set(this.sessions.map((s) => s.id));
    return this.previouslyOpenSessions
      .filter((s) => !activeIds.has(s.id))
      .map(openSessionToEntry);
  }

  private get current(): AgentSession | undefined {
    return this.sessions.find((s) => s.id === this.activeId);
  }

  private session(id: string): AgentSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  // A manual rename from the sidebar. The durable override is already written
  // backend-side; here we patch the live session so the header/sidebar update
  // and the durable open-session restore list stays in sync. `autoTitle` is cleared so
  // the first user message won't clobber the chosen title (see onSessionUpdate).
  private handleRenameSession({ id, title }: { id: string; title: string }) {
    const s = this.session(id);
    if (!s) return;
    if (title) s.title = title;
    s.autoTitle = false;
    this.touch();
    this.persistOpenSessions();
  }

  private handleReorderActiveSessions({ sourceId, targetId, position }: {
    sourceId: string;
    targetId: string;
    position: DropPosition;
  }) {
    const ids = this.sessions.map((s) => s.id);
    const nextIds = moveId(ids, sourceId, targetId, position);
    if (ids.length === nextIds.length && ids.every((id, index) => id === nextIds[index])) return;
    this.sessions = reorderByIds(this.sessions, nextIds, (s) => s.id);
    this.persistOpenSessions();
  }

  /** Mutated a session object in place — flag a re-render.
   *
   * Streamed turns fire an `acp:update` per token, each in its own event-loop
   * turn, so Lit can't coalesce them: a naive `this.rev++` per token forces one
   * full top-level re-render (sidebar + activeSummaries + composer + timeline
   * stack) per token — hundreds/sec against a 60fps ceiling, which reads as
   * sluggish. Coalesce to one re-render per animation frame instead: token
   * granularity is imperceptible, and frame cadence matches the display.
   * `flush` forces the bump synchronously for the rare caller that needs the DOM
   * updated before its own follow-up work (none today, but keeps the escape
   * hatch explicit). */
  private touch(flush = false) {
    if (flush) {
      if (this.touchFrame) { cancelAnimationFrame(this.touchFrame); this.touchFrame = 0; }
      this.rev++;
      return;
    }
    if (this.touchFrame) return;
    this.touchFrame = requestAnimationFrame(() => {
      this.touchFrame = 0;
      this.rev++;
    });
  }

  // Per-session snapshot the sidebar renders: identity + phase plus the
  // at-a-glance affordances (Needs-you state, current activity, token meter,
  // queue depth) that used to power the Mission Control board.
  //
  // Recomputed on every (frame-coalesced) render. The only non-trivial part is
  // deriving `activity` by scanning `items` back-to-front, so memoize just that
  // per session — keyed on the `items` reference and `phase` (both reassigned,
  // never mutated in place, so identity comparison is valid). Everything else is
  // a cheap field copy done fresh each call.
  private activeSummaries(): ActiveSessionSummary[] {
    return this.sessions.map((s) => {
      const cached = this.activityCache.get(s);
      let activity: string;
      if (cached && cached.itemsVersion === s.itemsVersion && cached.phase === s.phase) {
        activity = cached.activity;
      } else {
        activity = this.deriveActivity(s);
        this.activityCache.set(s, { itemsVersion: s.itemsVersion, phase: s.phase, activity });
      }
      return {
        id: s.id,
        title: s.title,
        cwd: s.cwd,
        agentId: s.agentId,
        agentName: s.agentName,
        phase: s.phase,
        turnStartedAt: s.turnStartedAt,
        stalled: s.stalled,
        backgroundActive: s.backgroundActive,
        hasPermission: s.permission !== null,
        hasElicitation: s.elicitation !== null,
        loading: s.loading,
        activity,
        usage: s.usage,
        queuedCount: s.queued.length,
        unseen: s.unseen,
        doneAt: s.doneAt,
      };
    });
  }

  // The back-to-front items scan behind an ActiveSessionSummary's `activity`.
  private deriveActivity(s: AgentSession): string {
    if (s.authRetrying) return 'Signing in again…';
    let lastAssistant = '';
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (it.kind === 'tool' && it.tool.status === 'in_progress') {
        return it.tool.title || it.tool.kind || 'Working…';
      }
      if (!lastAssistant && it.kind === 'message' && it.role === 'assistant') {
        const text = it.text.replace(/\s+/g, ' ').trim();
        lastAssistant = text.length > 80 ? text.slice(0, 79) + '…' : text;
      }
    }
    if (s.phase === 'thinking') return 'Working…';
    return lastAssistant;
  }

  // ── Connection / session lifecycle ──────────────────────────────────────────
  // Enter from the path field / workspace dropdown starts the session, matching
  // the primary button. No-op while the button would be disabled or auth is pending.
  private onConnectPathKeydown(e: KeyboardEvent, disabled: boolean) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (disabled || this.connState(this.selectedAgent) === 'auth') return;
    this.handleStart();
  }

  private async handleStart() {
    let cwd = this.cwd.trim();
    // In non-developer modes, auto-default to home directory if no cwd is set
    if (!cwd && !this.isDeveloperMode()) {
      cwd = this.getDefaultCwd();
      this.cwd = cwd;
    }
    if (!cwd) { this.connError = 'Choose a working directory first.'; return; }
    if (this.resumeReplacementEntry) {
      await this.resumeWithReplacementCwd(cwd);
      return;
    }
    const agent = this.selectedAgent;
    const opt = this.agentOptions.find((a) => a.id === agent);
    if (opt && opt.managedApp && !opt.installed) {
      this.connError = `${opt.label} isn't installed yet. Run \`kairos apps install ${agent}\` first.`;
      return;
    }
    this.connError = '';
    const title = this.sessionName.trim();
    saveLastCwd(cwd);
    saveLastAgent(agent);
    saveLastRole(this.selectedRole);

    // Isolated worktree: create it first, then start the session in the new
    // checkout. Await before touching `busy` so startSession's guard doesn't
    // early-return; the button stays disabled via `creatingWorktree`.
    if (this.useWorktree && this.repoInfo?.isRepo) {
      const branch = this.worktreeBranch.trim() || this.defaultBranchName(cwd);
      this.creatingWorktree = true;
      try {
        const wt = await createWorktree(cwd, branch, agent);
        this.creatingWorktree = false;
        this.startSession(wt.worktreePath, agent, this.selectedRole, {
          worktreePath: wt.worktreePath, branch: wt.branch, repoRoot: wt.repoRoot,
        }, title);
      } catch (err: any) {
        this.creatingWorktree = false;
        this.connError = `Couldn't create worktree: ${err?.message ?? err}`;
      }
      return;
    }
    this.startSession(cwd, agent, this.selectedRole, undefined, title);
  }

  // Create a brand-new session in `cwd` on `agent`, connecting that agent first
  // if it isn't already up. Other agents' connections are untouched. A non-empty
  // `roleId` names the persona to inject into the first turn. `worktree`, when
  // set, records that `cwd` is an app-created worktree so the session carries
  // cleanup provenance. A non-empty `title` is the user-chosen session name.
  private startSession(cwd: string, agent: string, roleId = '', worktree?: { worktreePath: string; branch: string; repoRoot: string }, title = '', initialPrompt = '', searchCandidates?: SessionEntry[]) {
    if (this.busy || this.connState(agent) === 'connecting') return;
    // If still awaiting auth, don't re-connect — the auth panel handles this.
    if (this.connState(agent) === 'auth') return;
    this.busy = true;
    this.pending = { kind: 'new', cwd, agent, roleId, title: title || undefined, worktree, initialPrompt: initialPrompt || undefined, searchCandidates };
    if (this.connState(agent) === 'up') {
      this.client.newSession(cwd, agent);
    } else {
      this.setConn(agent, { state: 'connecting', name: this.agentLabel(agent), stderrTail: undefined });
      this.client.connect(cwd, agent);
    }
  }

  private async resumeWithReplacementCwd(cwd: string) {
    const entry = this.resumeReplacementEntry;
    if (!entry) return;
    if (!(await this.directoryExists(cwd))) {
      this.connError = `Choose an existing folder to resume this session. Kairos could not access: ${cwd}`;
      return;
    }
    this.resumeReplacementEntry = null;
    this.connError = '';
    await this.resumeAgentSession({ ...entry, dir: cwd });
  }

  private async directoryExists(cwd: string): Promise<boolean> {
    try {
      await listWorkspaceDir(cwd);
      return true;
    } catch {
      return false;
    }
  }

  // ── Worktree picker helpers ─────────────────────────────────────────────────
  // Pending debounce timer + the cwd it was scheduled for, so a stale result
  // (user changed the field again) can be discarded.
  private repoDetectTimer: ReturnType<typeof setTimeout> | null = null;

  // Called from the picker's cwd <select>/<input>. Resets the toggle, then
  // debounces a git detection so we don't probe on every keystroke.
  private onCwdChanged(cwd: string) {
    this.cwd = cwd;
    this.repoInfo = null;
    this.useWorktree = false;
    this.worktreeBranch = '';
    this.connError = '';
    if (this.repoDetectTimer) clearTimeout(this.repoDetectTimer);
    const target = cwd.trim();
    if (!target) { this.detectingRepo = false; return; }
    this.detectingRepo = true;
    this.repoDetectTimer = setTimeout(() => this.detectRepoForCwd(target), 250);
  }

  private async detectRepoForCwd(cwd: string) {
    try {
      const info = await detectRepo(cwd);
      // Drop the result if the field moved on while we were detecting.
      if (cwd !== this.cwd.trim()) return;
      this.repoInfo = info;
      if (info.isRepo && !this.worktreeBranch) this.worktreeBranch = this.defaultBranchName(cwd);
    } catch {
      if (cwd === this.cwd.trim()) this.repoInfo = { isRepo: false };
    } finally {
      if (cwd === this.cwd.trim()) this.detectingRepo = false;
    }
  }

  // Auto-filled branch name: `agent/<repo-basename>-<MMDD-HHmm>`. The timestamp
  // keeps parallel sessions collision-free; the `agent/` prefix groups them.
  private defaultBranchName(cwd: string): string {
    const base = (cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'session')
      .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const stamp = `${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    return `agent/${base}-${stamp}`;
  }

  private onInitialized(info: InitializedInfo) {
    const agentId = info.agentId;
    const name = cleanAgentName(info.agentInfo?.title || info.agentInfo?.name) || this.agentLabel(agentId);
    const capabilities = info.agentCapabilities ?? {};

    // If the agent reports auth methods AND is running in API-key mode (not
    // through the kairos gateway), park in the 'auth' state so the picker shows a
    // login prompt. Gateway-mode agents are already authenticated by devai — some
    // adapters (Codex) still advertise authMethods even when they aren't needed,
    // which would otherwise block resume with an invisible login prompt.
    const methods = info.authMethods ?? [];
    const opt = this.agentOptions.find((a) => a.id === agentId);
    const isGateway = !opt?.authMode || opt.authMode === 'gateway';
    const m = methods[0];
    const authMethod: AuthMethod | undefined = m ? {
      id: m.id,
      name: m.name,
      description: m.description,
      command: m._meta?.['terminal-auth']?.command,
      args: m._meta?.['terminal-auth']?.args,
      label: m._meta?.['terminal-auth']?.label,
    } : undefined;
    if (methods.length > 0 && !isGateway) {
      this.setConn(agentId, { state: 'auth', name, capabilities, authMethod });
      this.busy = false;
      return;
    }

    this.setConn(agentId, { state: 'up', name, capabilities, authMethod });
    // Carry out the request that triggered this agent's connection.
    const pending = this.pending;
    if (!pending || pending.agent !== agentId) return;
    if (pending.kind === 'resume') {
      const entry = pending.entry;
      const resumeDir = usableSessionDir(entry.dir);
      if (this.conn(agentId)?.capabilities.loadSession && resumeDir) {
        this.client.loadSession(entry.id, resumeDir, agentId);
      } else {
        this.showInlineResumeUnavailable(entry, `${this.agentLabel(agentId)} does not support inline session replay.`);
      }
    } else {
      this.client.newSession(pending.cwd, agentId);
    }
  }

  private openAgentLogin(agentId: string) {
    const conn = this.conn(agentId);
    if (!conn?.authMethod?.command) return;
    this.client.terminalAuth(conn.authMethod.command, conn.authMethod.args ?? []);
  }

  private retryAfterAuth(agentId: string) {
    const conn = this.conn(agentId);
    if (!conn) return;
    this.setConn(agentId, { state: 'up' });
    this.connError = '';
    const pending = this.pending;
    if (pending && pending.agent === agentId) {
      this.busy = true;
      if (pending.kind === 'resume') {
        const entry = pending.entry;
        const resumeDir = usableSessionDir(entry.dir);
        if (conn.capabilities.loadSession && resumeDir) {
          this.client.loadSession(entry.id, resumeDir, agentId);
        } else {
          this.showInlineResumeUnavailable(entry, `${this.agentLabel(agentId)} does not support inline session replay.`);
        }
      } else {
        this.client.newSession(pending.cwd, agentId);
      }
    } else {
      this.startSession(this.cwd.trim(), agentId, this.selectedRole);
    }
  }

  private onSession(info: SessionInfo) {
    const pending = this.pending?.kind === 'new' ? this.pending : null;
    const cwd = info.cwd ?? pending?.cwd ?? this.cwd.trim();
    // Global rules and a chosen role are both injected into the first prompt
    // turn (ACP has no system-prompt field). Global rules always apply and lead;
    // the role's persona follows. Resolve now; flushQueue appends it once.
    const role = pending?.roleId ? this.roles.find((r) => r.id === pending.roleId) : undefined;
    const preamble = composeLaunchPreamble({ globalRules: this.globalRules, role });
    // A name typed in the picker becomes the durable title; skip deriving one
    // from the first message and persist the override so it survives reloads.
    const chosenTitle = pending?.title?.trim();
    // A canned first prompt (e.g. the History "Search with <agent>" flow) is
    // sent automatically instead of waiting for the user to type — captured
    // before `pending` is cleared below.
    const initialPrompt = pending?.initialPrompt?.trim();
    const configOptions = stripBypassMode(info.configOptions ?? []);
    const session = createAgentSession(info.sessionId, cwd, {
      agentId: info.agentId,
      agentName: this.conn(info.agentId)?.name ?? this.agentLabel(info.agentId),
      configOptions,
      autoAccept: loadAutoAccept(),
      worktree: pending?.worktree,
      pendingPreamble: preamble || undefined,
      searchCandidates: pending?.searchCandidates,
      ...(chosenTitle ? { title: chosenTitle, autoTitle: false } : {}),
    });
    session.configDefaults = inferThoughtLevelDefaults(session.configDefaults, configOptions);
    if (chosenTitle) renameSession(info.sessionId, chosenTitle).catch(() => {});
    this.saveActivePanelState();
    this.sessions = [...this.sessions, session];
    this.sessionPanelStates.set(session.id, { ...DEFAULT_SESSION_PANEL_STATE });
    this.activeId = session.id;
    this.restorePanelState(session.id);
    this.view = 'session';
    this.pending = null;
    this.busy = false;
    this.sessionName = '';
    this.restoreConfig(session, loadSavedConfig(session.agentId));
    if (initialPrompt) {
      session.queued = [...session.queued, { text: initialPrompt, attachments: [] }];
      this.flushQueue(session);
    }
    this.focusComposer();
    this.persistOpenSessions();
  }

  private onSessionLoaded(info: SessionLoaded) {
    const s = this.session(info.sessionId);
    if (!s) return;
    this.setSessionConfigOptions(s, info.configOptions ?? []);
    this.restoreConfig(s, loadSavedConfig(s.agentId));
    s.loading = false;
    // Background tasks from the prior process died with that subprocess; a
    // launch whose completion never reached on-disk history would otherwise
    // leave the resumed session falsely "working".
    s.convo.clearBackgroundTracking();
    s.backgroundActive = 0;
    // History replay diverts any summary turn into the capture buffer; read
    // the last one back so the Summary panel is populated across reloads.
    const captured = s.convo.endCapture();
    if (captured.trim()) s.summary = captured;
    const resumeDraft = this.resumeDrafts.get(info.sessionId);
    if (resumeDraft !== undefined) {
      s.draft = resumeDraft;
      this.resumeDrafts.delete(info.sessionId);
    }
    this.pending = null;
    this.busy = false;
    if (this.interruptedIds.has(info.sessionId)) {
      this.interruptedIds.delete(info.sessionId);
      s.convo.pushSystemNote('Turn was interrupted by a page reload.');
      this.syncConversationState(s);
    }
    this.touch();
    if (info.sessionId === this.activeId) this.scrollToBottom(true);
  }

  // ── Resume a past on-disk session ───────────────────────────────────────────
  // `worktree` is supplied only on page-reload rehydration of a worktree-backed
  // session, so its provenance survives (the checkout already exists — we adopt,
  // never recreate). Dashboard/Sessions-tab resume omits it.
  private async resumeAgentSession(entry: SessionEntry, worktree?: { worktreePath: string; branch: string; repoRoot: string }) {
    // Already open as a live session? Just switch to it.
    const open = this.session(entry.id);
    if (open) {
      this.forgetPreviouslyOpenSession(entry.id);
      this.switchTo(entry.id);
      this.persistOpenSessions();
      return;
    }
    // Which agent owns this session — `tool` is the recorded backend (e.g.
    // 'claude', 'gemini'); unknown/blank falls back to Claude.
    const agent = (entry.tool || 'claude').toLowerCase();
    if (this.busy || this.connState(agent) === 'connecting') return;
    const resumeDir = usableSessionDir(entry.dir);
    if (!resumeDir) {
      this.requestResumeReplacement(entry, 'This session does not have a usable working directory. Choose a replacement folder to replay it inline.');
      return;
    }
    if (!(await this.directoryExists(resumeDir))) {
      this.requestResumeReplacement(entry, `The original working directory no longer exists or cannot be accessed: ${resumeDir}. Choose a replacement folder to replay this session inline.`);
      return;
    }

    // Agent already up but can't replay history.
    if (this.connState(agent) === 'up' && !this.conn(agent)?.capabilities.loadSession) {
      this.showInlineResumeUnavailable(entry, `${this.agentLabel(agent)} does not support inline session replay.`);
      return;
    }

    const knownTitle = entry.title || entry.firstMessage || '';
    const session = createAgentSession(entry.id, resumeDir, {
      agentId: agent,
      agentName: this.conn(agent)?.name ?? this.agentLabel(agent),
      title: knownTitle || 'Resumed session',
      // Only auto-title from the replay if we don't already have a real one.
      autoTitle: !knownTitle,
      loading: true,
      autoAccept: loadAutoAccept(),
      worktree,
    });
    this.saveActivePanelState();
    this.sessions = [...this.sessions, session];
    this.sessionPanelStates.set(session.id, { ...DEFAULT_SESSION_PANEL_STATE });
    this.activeId = session.id;
    this.forgetPreviouslyOpenSession(entry.id);
    this.restorePanelState(session.id);
    this.view = 'session';
    this.busy = true;
    this.pending = { kind: 'resume', entry, agent };
    // Rehydrate this session's checkpoints from the server registry so
    // resume-from-prompt can restore files across reloads.
    this.loadCheckpoints(session);

    if (this.connState(agent) === 'up') {
      // loadSession capability already confirmed by the guard above.
      this.client.loadSession(entry.id, resumeDir, agent);
    } else {
      // Connect first; onInitialized rechecks the capability before loading.
      this.setConn(agent, { state: 'connecting', name: this.agentLabel(agent), stderrTail: undefined });
      this.client.connect(resumeDir, agent);
    }
    this.persistOpenSessions();
  }

  private requestResumeReplacement(entry: SessionEntry, message: string) {
    const agent = (entry.tool || 'claude').toLowerCase();
    this.pending = null;
    this.busy = false;
    this.sessions = this.sessions.filter((s) => s.id !== entry.id);
    this.sessionPanelStates.delete(entry.id);
    if (this.activeId === entry.id) {
      this.activeId = this.sessions.length ? this.sessions[this.sessions.length - 1].id : null;
      this.restorePanelState(this.activeId);
    }
    this.resumeReplacementEntry = entry;
    this.selectedAgent = agent;
    this.cwd = '';
    this.sessionName = '';
    this.selectedRole = '';
    this.useWorktree = false;
    this.repoInfo = null;
    this.worktreeBranch = '';
    this.view = 'session';
    this.activeId = null;
    this.restorePanelState(null);
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.connError = message;
  }

  private showInlineResumeUnavailable(entry: SessionEntry, message: string) {
    const agent = (entry.tool || 'claude').toLowerCase();
    this.pending = null;
    this.busy = false;
    this.sessions = this.sessions.filter((s) => s.id !== entry.id);
    this.sessionPanelStates.delete(entry.id);
    if (this.activeId === entry.id) {
      this.activeId = this.sessions.length ? this.sessions[this.sessions.length - 1].id : null;
      this.restorePanelState(this.activeId);
    }
    this.resumeReplacementEntry = null;
    this.selectedAgent = agent;
    this.cwd = usableSessionDir(entry.dir) ?? '';
    this.view = 'session';
    this.activeId = null;
    this.restorePanelState(null);
    this.connError = message;
  }

  private switchTo(id: string) {
    const target = this.session(id);
    if (target) {
      if (this.listening) this.stopDictation();
      this.saveActivePanelState();
      target.unseen = false;
      this.activeId = id;
      this.restorePanelState(id);
      this.view = 'session';
      this.slashOpen = false;
      this.slashButtonOpen = false;
      this.rewindPickerId = null;
      this.configMenuId = null;
      this.linkedFileRequest = null;
      this.scrollToBottom(true);
      this.persistOpenSessions();
    }
  }

  private handleNewSession() {
    // Drop to the picker; existing sessions stay live in the sidebar.
    this.saveActivePanelState();
    this.activeId = null;
    this.restorePanelState(null);
    this.view = 'session';
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.resumeReplacementEntry = null;
    this.connError = '';
  }

  // Sidebar's quick-start: reuse the last-used agent + cwd, skipping the picker.
  // Falls back to the picker if either is missing or the agent is uninstalled.
  private handleQuickStart() {
    const cwd = loadLastCwd().trim();
    const agent = loadLastAgent();
    if (!cwd || !agent) { this.handleNewSession(); return; }
    const opt = this.agentOptions.find((a) => a.id === agent);
    if (opt?.managedApp && !opt.installed) { this.handleNewSession(); return; }
    this.connError = '';
    this.resumeReplacementEntry = null;
    this.cwd = cwd;
    this.selectedAgent = agent;
    this.selectedRole = loadLastRole();
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.view = 'session';
    // Keep the current view (existing session or picker) until onSession swaps
    // in the new session — nulling activeId here would flash the picker.
    this.startSession(cwd, agent, this.selectedRole);
  }

  // Best label we can show for the saved agent in the sidebar's split button:
  // prefer the loaded agentOptions entry, fall back to a title-cased id.
  private lastAgentLabel(): string {
    const id = loadLastAgent();
    if (!id) return '';
    const opt = this.agentOptions.find((a) => a.id === id);
    if (opt?.managedApp && !opt.installed) return '';
    return opt?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
  }

  private cancelResumeReplacement() {
    this.resumeReplacementEntry = null;
    this.connError = '';
    this.cwd = loadLastCwd();
    this.selectedAgent = loadLastAgent();
  }

  private async closeSession(id: string) {
    const closed = this.session(id);
    // Offer worktree cleanup before tearing down the connection, so the agent
    // isn't holding file handles in the checkout we're about to remove.
    if (closed?.worktree) await this.cleanupWorktree(closed.worktree);
    const wasActive = this.activeId === id;
    if (wasActive) this.saveActivePanelState();
    this.deferredRestore.delete(id);
    evictMarkdownCache(`${id}:`);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.sessionPanelStates.delete(id);
    if (wasActive) {
      this.activeId = this.sessions.length ? this.sessions[this.sessions.length - 1].id : null;
      this.restorePanelState(this.activeId);
    }
    // Drop an agent's connection once its last session closes; other agents stay up.
    if (closed && !this.sessions.some((s) => s.agentId === closed.agentId)) {
      this.client.disconnect(closed.agentId);
      this.conns.delete(closed.agentId);
      this.rev++;
    }
    this.refreshSidebarRecent();
    this.persistOpenSessions();
  }

  // Try a clean removal of an app-created worktree on session end. If it's dirty
  // or has unmerged commits (or we can't reach the server to check), escalate to
  // a forced confirm that spells out what would be lost — default is to keep it.
  private async cleanupWorktree(wt: { worktreePath: string; branch: string; repoRoot: string }) {
    let status: { dirty: boolean; ahead: number; unmergedToHead: boolean } | null = null;
    try {
      status = await inspectWorktree(wt.worktreePath, wt.repoRoot, wt.branch);
    } catch { /* offline / git error — treat as risky below */ }

    const risky = !status || status.dirty || status.unmergedToHead;
    if (risky) {
      const lost: string[] = [];
      if (status?.dirty) lost.push('uncommitted changes');
      if (status?.unmergedToHead) lost.push(`${status.ahead} unmerged commit${status.ahead === 1 ? '' : 's'}`);
      const detail = lost.length ? `has ${lost.join(' and ')}` : 'could not be inspected';
      if (!confirm(`Branch "${wt.branch}" ${detail}.\n\nRemove the worktree and DELETE the branch anyway? This cannot be undone.`)) {
        return; // Keep — worktree stays on disk and registered for later cleanup.
      }
    } else if (!confirm(`Remove the isolated worktree and its branch "${wt.branch}"?`)) {
      return;
    }

    try {
      await removeWorktree(wt.worktreePath, wt.repoRoot, wt.branch, { force: risky, deleteBranch: true });
    } catch (err: any) {
      this.connError = `Worktree cleanup failed: ${err?.message ?? err}`;
    }
  }

  private refreshSidebarRecent() {
    const sidebar = this.shadowRoot?.querySelector('agents-sidebar') as
      | (HTMLElement & { loadRecent: () => void })
      | null;
    sidebar?.loadRecent();
  }

  // ── Behind the Scenes live frame capture ───────────────────────────────────
  // Push one captured ACP frame into the ring buffer, eliding any oversized
  // base64 `data` strings first so the inspector stays readable and memory
  // doesn't grow unbounded on an image-heavy turn.
  private recordFrame(channel: FrameChannel, payload: unknown, sessionId?: string, label?: string) {
    const frame: CapturedFrame = {
      id: ++this.frameSeq,
      ts: Date.now(),
      channel,
      sessionId,
      label: label ?? channel,
      payload: elideLargeData(payload),
    };
    const next = [...this.frameLog, frame];
    this.frameLog = next.length > FRAME_LOG_CAP ? next.slice(next.length - FRAME_LOG_CAP) : next;
    // Only re-render for a captured frame when a viewer is actually on screen;
    // otherwise the buffer accumulates silently and is read fresh from the field
    // on next open. Two viewers: the full-page Behind the Scenes reference, and
    // the per-session Frames side panel. The panel only cares about frames for
    // the focused session (or connection-level handshake frames, which have no
    // sessionId), so background-session traffic doesn't churn its render.
    // Coalesced through touch() so a streaming turn still caps at one render per
    // frame.
    const framesPanelWatching =
      this.framesOpen && (sessionId === undefined || sessionId === this.activeId);
    if (this.view === 'behind' || framesPanelWatching) this.touch();
  }

  // ── Event routing ───────────────────────────────────────────────────────────
  private syncConversationState(s: AgentSession) {
    s.items = s.convo.items;
    s.itemsVersion = s.convo.version;
    s.itemsStructureVersion = s.convo.structureVersion;
    s.plan = s.convo.plan;
    s.planDoc = s.convo.planDoc;
    s.usage = s.convo.usage;
    s.commands = s.convo.commands;
  }

  private onUpdate(sessionId: string, update: SessionUpdate) {
    const s = this.session(sessionId);
    if (!s) return;
    const previousItemCount = s.items.length;
    const manualScroll = this.manualScrollSnapshot(sessionId);
    // Any update means the turn is alive again — drop a stale stall warning.
    s.stalled = false;
    if (update.sessionUpdate === 'config_option_update') {
      // The agent rebuilds the whole set (e.g. a model switch changes which
      // effort levels are offered), so adopt it wholesale.
      this.setSessionConfigOptions(
        s,
        (update as { configOptions: AgentSession['configOptions'] }).configOptions ?? [],
        this.consumePendingModelDefaultCapture(s.id),
      );
      this.applyDeferredRestore(s);
      this.touch();
      return;
    }
    if (update.sessionUpdate === 'current_mode_update') {
      // The agent can report a mode we deliberately hide (bypassPermissions);
      // coerce it to a still-offered leaf so the control never points at a value
      // with no matching segment.
      const mode = s.configOptions.find((o) => o.id === 'mode');
      const value = coerceModeValue(mode?.options, (update as { currentModeId: string }).currentModeId);
      this.setConfigValue(s, 'mode', value);
      this.touch();
      return;
    }
    if (s.loading && (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update')) {
      const id = (update as { toolCallId?: unknown }).toolCallId;
      if (typeof id === 'string' && id) s.replayedToolIds.add(id);
    }
    s.convo.apply(update);
    this.syncConversationState(s);
    this.preserveTimelineWindowOnAppend(sessionId, previousItemCount, s.items.length);
    const bgWas = s.backgroundActive;
    s.backgroundActive = s.convo.backgroundActiveCount;
    // The turn already resolved but we held "Done" back while a background task
    // ran (see onStop). Now that the last one has reported in, stamp done and
    // chime — the same completion signal the user would otherwise never see.
    if (s.phase === 'ready' && bgWas > 0 && s.backgroundActive === 0 && s.queued.length === 0) {
      this.markDone(sessionId);
      this.notifyIfAway(sessionId, 'done');
      this.announceSuccessfulSession();
    }
    // Placeholder-titled sessions adopt their first user message as the title.
    if (s.autoTitle && update.sessionUpdate === 'user_message_chunk') {
      const first = s.items.find((i) => i.kind === 'message' && i.role === 'user');
      if (first && first.kind === 'message' && first.text.trim()) {
        s.title = deriveSessionTitle(first.text);
        s.autoTitle = false;
        this.persistOpenSessions();
      }
    }
    // The ACP turn ended while a known deferred sub-agent Task was still
    // streaming. Now that a tool_call_update arrived, re-check: if all deferred
    // tools finished, complete the stop transition.
    if (s.stopReceived && !hasDeferredStopTools(s.items)) {
      this.completeStop(s);
      if (sessionId === this.activeId) {
        if (manualScroll) this.preserveManualScrollAfterRender(manualScroll);
        this.scrollToBottom();
      }
      return;
    }
    // An armed steer that was held back for an in-flight edit fires as soon as
    // that tool call reports completion.
    this.maybeInterrupt(s);
    this.touch();
    if (sessionId === this.activeId) {
      if (manualScroll) this.preserveManualScrollAfterRender(manualScroll);
      this.scrollToBottom();
    }
  }

  // Reply to session/set_config_option: a model switch rebuilds the effort
  // option, so adopt the returned set wholesale.
  private onConfigOptions(sessionId: string, configOptions: AgentSession['configOptions']) {
    const s = this.session(sessionId);
    if (!s) return;
    this.setSessionConfigOptions(s, configOptions ?? [], this.consumePendingModelDefaultCapture(s.id));
    this.applyDeferredRestore(s);
    this.touch();
  }

  private setSessionConfigOptions(s: AgentSession, configOptions: AgentSession['configOptions'], captureDefaults = false) {
    const stripped = stripBypassMode(configOptions);
    if (captureDefaults) s.configDefaults = inferThoughtLevelDefaults(s.configDefaults, stripped);
    s.configOptions = stripped;
  }

  private consumePendingModelDefaultCapture(sessionId: string): boolean {
    if (!this.pendingModelDefaultCapture.has(sessionId)) return false;
    this.pendingModelDefaultCapture.delete(sessionId);
    return true;
  }

  // A model-switch restore step left the remaining options (e.g. effort) pending
  // until the agent rebuilt them. The rebuilt set can arrive as the
  // set_config_option response or a config_option_update notification, so both
  // paths call this. Re-plan against the new options so only still-valid values
  // are applied.
  private applyDeferredRestore(s: AgentSession) {
    const deferred = this.deferredRestore.get(s.id);
    if (!deferred) return;
    this.deferredRestore.delete(s.id);
    for (const step of planConfigRestore(s.configOptions, deferred)) {
      this.sendConfigChange(s, step.id, step.value);
    }
  }

  private onPermissionRequest(req: PermissionRequest) {
    const s = this.session(req.sessionId);
    if (!s) return;
    if (s.autoAccept) {
      const pick = req.options.find((o) => o.kind.startsWith('allow'));
      if (pick) {
        this.client.resolvePermission(req.requestId, { outcome: 'selected', optionId: pick.optionId });
        return;
      }
    }
    s.permission = req;
    // The agent is now blocked on the user, not on disk — a held steer can fire.
    this.maybeInterrupt(s);
    this.touch();
    this.markDone(req.sessionId);
    this.notifyIfAway(req.sessionId, 'ask');
    if (req.sessionId === this.activeId) this.scrollToBottom();
  }

  private onElicitationRequest(req: ElicitationRequest) {
    const s = this.session(req.sessionId);
    if (!s) return;
    s.elicitation = req;
    // The agent is now blocked on the user, not on disk — a held steer can fire.
    this.maybeInterrupt(s);
    this.touch();
    this.markDone(req.sessionId);
    this.notifyIfAway(req.sessionId, 'ask');
    if (req.sessionId === this.activeId) this.scrollToBottom();
  }

  private onTerminalOutput(sessionId: string, terminalId: string, output: string) {
    const s = this.session(sessionId);
    if (!s) return;
    // Reassign the Map (not mutate in place) so the timeline's guard() sees the
    // change — inactive timelines are otherwise frozen against a stable Map ref.
    s.terminalOutputs = new Map(s.terminalOutputs).set(terminalId, output);
    this.touch();
  }

  private onStop(sessionId: string) {
    const s = this.session(sessionId);
    if (s && s.phase === 'thinking') {
      // Only known deferred sub-agent Tasks may outlive session/prompt. Generic
      // stale in_progress tool states (seen from Codex adapters) must not keep
      // the whole session stuck on "Working" after the prompt resolved.
      if (hasDeferredStopTools(s.items)) {
        s.stopReceived = true;
        s.stalled = false;
        this.touch();
        return;
      }
      this.completeStop(s);
    }
  }

  private completeStop(s: AgentSession) {
    s.phase = 'ready';
    s.turnStartedAt = null;
    s.stalled = false;
    s.stopReceived = false;
    s.inflightPrompt = null;
    s.authRetrying = false;
    // Search sessions only: turn the ids the agent cited in its answer into
    // one-click resume chips. Gated on searchCandidates so a normal chat session
    // does zero work here beyond this property check.
    if (s.searchCandidates) this.updateSearchMatches(s);
    // A summary request's reply was diverted out of the timeline into the
    // capture buffer; read it into the session for the Review panel.
    if (this.pendingSummary === s.id) {
      const text = s.convo.endCapture();
      if (text.trim()) s.summary = text;
      this.pendingSummary = null;
    }
    this.refreshSourceStatus(s, true);
    this.persistOpenSessions();
    this.touch();
    // Notify "done" only when nothing more will fire on its own: a queued steer
    // flushes straight into another turn, so the chime would be premature;
    // likewise a detached background task (run_in_background) outlives this turn,
    // so defer "Done" until its <task-notification> lands (see onUpdate).
    const willContinue = s.queued.length > 0 || s.backgroundActive > 0;
    this.flushQueue(s);
    if (!willContinue) { this.markDone(s.id); this.notifyIfAway(s.id, 'done'); this.announceSuccessfulSession(); }
  }

  // Recompute a search session's resume chips from the agent's latest answer.
  // Scans only the most recent assistant message so the chips track the freshest
  // ranking (a follow-up "actually it was the other one" replaces them). Matches
  // against the known candidate set, so only sessions we handed the agent surface.
  private updateSearchMatches(s: AgentSession) {
    if (!s.searchCandidates) return;
    const answer = [...s.items]
      .reverse()
      .find((it) => it.kind === 'message' && it.role === 'assistant');
    const text = answer && answer.kind === 'message' ? answer.text : '';
    s.searchMatches = findCitedSessions(text, s.searchCandidates);
  }

  // The server saw a thinking turn go silent past the stall threshold. Surface
  // it so the user can interrupt or force-restart instead of waiting forever.
  private onStalled(sessionId: string, _secondsIdle: number) {
    const s = this.session(sessionId);
    if (!s || s.phase !== 'thinking') return;
    s.stalled = true;
    this.touch();
    this.markDone(sessionId);
    this.notifyIfAway(sessionId, 'ask');
  }

  // The agent subprocess was force-killed and is gone from the server pool.
  // Tear down the dead in-UI sessions and re-resume the one the user was
  // looking at through the normal resume path, so they land back in a live,
  // history-replayed session instead of a dead "error" state (the agent replays
  // from its own on-disk history, so the conversation survives the restart).
  // Other background sessions of this agent drop to Recent and resume on click.
  private onAgentRestarted(agentId: string) {
    const owned = this.sessions.filter((s) => s.agentId === agentId);
    if (owned.length === 0) return;
    const focused = owned.find((s) => s.id === this.activeId) ?? owned[0];
    const entry: SessionEntry = {
      id: focused.id,
      tool: focused.agentId,
      dir: focused.cwd,
      title: focused.title,
      firstActive: '',
      lastActive: '',
      messages: 0,
      active: false,
    };
    const worktree = focused.worktree;
    // Drop the dead connection + its sessions so resumeAgentSession rebuilds the
    // focused one cleanly rather than short-circuiting on an already-open id.
    this.sessions = this.sessions.filter((s) => s.agentId !== agentId);
    for (const session of owned) this.sessionPanelStates.delete(session.id);
    if (this.activeId && !this.session(this.activeId)) {
      this.activeId = null;
      this.restorePanelState(null);
    }
    this.conns.delete(agentId);
    this.pending = null;
    this.busy = false;
    this.touch();
    void this.resumeAgentSession(entry, worktree);
  }

  // Let the app shell raise its global "session expired" banner immediately,
  // without waiting for the backend auth poll to notice the flip.
  private notifyAuthExpired() {
    this.dispatchEvent(new CustomEvent('auth-expired', { bubbles: true, composed: true }));
  }

  private abandonSummaryCapture(s: AgentSession) {
    if (this.pendingSummary !== s.id) return;
    s.convo.endCapture();
    this.pendingSummary = null;
  }

  private ensureGatewayLogin(): Promise<void> {
    if (!this.authLoginPromise) {
      this.authLoginPromise = login()
        .then((result) => {
          if (!result.success) {
            const detail = result.output?.trim();
            throw new Error(detail || 'Login failed.');
          }
        })
        .finally(() => {
          this.authLoginPromise = null;
        });
    }
    return this.authLoginPromise;
  }

  private startAuthRetry(s: AgentSession): boolean {
    const prompt = s.inflightPrompt;
    if (!prompt || prompt.authRetryAttempted || s.authRetrying) return false;
    prompt.authRetryAttempted = true;
    s.authRetrying = true;
    s.error = 'Your kairos session expired — signing in again, then retrying this message.';
    this.notifyAuthExpired();
    this.touch();
    void this.reloginAndRetryPrompt(s.id, prompt);
    return true;
  }

  private async reloginAndRetryPrompt(sessionId: string, prompt: AgentSession['inflightPrompt']) {
    try {
      await this.ensureGatewayLogin();
      const s = this.session(sessionId);
      if (!s || s.inflightPrompt !== prompt) return;
      s.authRetrying = false;
      s.error = '';
      if (this.connState(s.agentId) !== 'up') {
        s.inflightPrompt = null;
        this.abandonSummaryCapture(s);
        s.error = 'Signed in, but the agent connection is no longer available. Reopen the session and send again.';
        this.touch();
        return;
      }
      this.sendInflightPrompt(s);
    } catch (err) {
      const s = this.session(sessionId);
      if (!s || s.inflightPrompt !== prompt) return;
      s.authRetrying = false;
      s.inflightPrompt = null;
      this.abandonSummaryCapture(s);
      s.error = `Automatic sign-in failed: ${(err as Error).message || err}`;
      this.touch();
    }
  }

  private onError(msg: string, sessionId?: string, agentId?: string) {
    // A connection that never came up — abandon the in-flight request and any
    // optimistic session it created (e.g. a resume that was waiting to load).
    // Match on the agent the error belongs to (or the one we're awaiting).
    const failedAgent = agentId ?? (this.pending?.agent);
    if (failedAgent && this.connState(failedAgent) === 'connecting') {
      this.setConn(failedAgent, { state: 'error' });
      this.connError = msg;
      this.busy = false;
      this.abandonPending();
      return;
    }
    // A per-session RPC failure routes to its own session, even in the background.
    const s = sessionId ? this.session(sessionId) : null;
    if (s) {
      s.stalled = false;
      if (s.phase === 'thinking') s.phase = 'ready';
      s.turnStartedAt = null;
      if (isAuthExpiredError(msg)) {
        if (this.startAuthRetry(s)) return;
        this.notifyAuthExpired();
        s.inflightPrompt = null;
        s.authRetrying = false;
        this.abandonSummaryCapture(s);
        s.error = 'Your kairos session expired — sign in again and retry this message.';
      } else {
        s.inflightPrompt = null;
        s.authRetrying = false;
        this.abandonSummaryCapture(s);
        s.error = msg;
      }
      this.persistOpenSessions();
      this.touch();
      return;
    }
    // "Authentication required" from session/new → flip the agent back to auth
    // state so the login panel resurfaces rather than showing a generic error.
    if (failedAgent && /authentication required/i.test(msg) && this.conn(failedAgent)?.authMethod) {
      this.setConn(failedAgent, { state: 'auth' });
      this.busy = false;
      return;
    }
    // No owning session. If a request was in flight (e.g. session/new failed on
    // a live connection), abandon it so the picker recovers instead of hanging
    // on "Connecting…"; otherwise surface it on the active session.
    if (this.busy || this.pending) {
      this.connError = msg;
      this.busy = false;
      this.abandonPending();
      return;
    }
    const cur = this.current;
    if (cur) { cur.error = msg; this.touch(); }
    else this.connError = msg;
  }

  private onLoadError(sessionId: string, msg: string) {
    // Inline replay failed or timed out (the wedged-codex-on-Windows case). The
    // conversation is intact on disk and terminal resume works, so drop the dead
    // inline session and fall back to it rather than stranding a spinner/error.
    const entry = this.pending?.kind === 'resume' && this.pending.entry.id === sessionId ? this.pending.entry : null;
    this.pending = null;
    this.busy = false;
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    this.sessionPanelStates.delete(sessionId);
    if (this.activeId === sessionId) {
      this.activeId = this.sessions.length ? this.sessions[this.sessions.length - 1].id : null;
      this.restorePanelState(this.activeId);
    }
    this.connError = `Couldn't replay this conversation inline (${msg}). Choose a replacement folder to retry.`;
    this.view = 'session';
    this.touch();
    if (entry) this.requestResumeReplacement(entry, this.connError);
  }

  // Drop a pending request and any optimistic (still-loading) session it created.
  private abandonPending() {
    if (this.pending?.kind === 'resume') {
      const id = this.pending.entry.id;
      this.sessions = this.sessions.filter((s) => s.id !== id);
      this.sessionPanelStates.delete(id);
      if (this.activeId === id) {
        this.activeId = this.sessions.length ? this.sessions[this.sessions.length - 1].id : null;
        this.restorePanelState(this.activeId);
      }
    } else if (this.pending?.kind === 'new') {
      // A quick-start (sidebar "New session") keeps the current session view
      // visible until onSession swaps in the new one. When it fails instead —
      // e.g. the saved working directory no longer exists — the error only
      // lives on the picker's banner, so drop to the picker to surface it
      // rather than silently leaving the old session up. The cwd/agent the
      // attempt used are already staged, so the picker lands pre-filled.
      this.saveActivePanelState();
      this.activeId = null;
      this.restorePanelState(null);
      this.view = 'session';
    }
    this.pending = null;
  }

  // User gave up on a connect that hasn't resolved (the backend backstop is 2
  // min; this is the immediate escape hatch). Drop the in-flight subprocess and
  // reset the picker so a retry starts clean.
  private cancelConnecting(agentId: string) {
    this.client.disconnect(agentId);
    this.setConn(agentId, { state: 'down', stderrTail: undefined });
    this.busy = false;
    this.abandonPending();
    this.connError = '';
  }

  // Track the last stderr line per agent so an exit can report the real cause.
  // Built-in agents (goose, opencode, etc.) aren't bundled — a missing binary
  // exits immediately with "command not found: <agent>" on stderr, which is far
  // more useful than the generic "process exited" banner.
  private onLog(stream: string, text: string, agentId?: string) {
    if (stream !== 'stderr' || !agentId) return;
    const line = text.split('\n').map((l) => l.trim()).filter(Boolean).pop();
    if (line) this.setConn(agentId, { stderrTail: line });
  }

  // `closeDetail` is the stderr tail the bridge carried on the WS close reason
  // (e.g. an expired-auth message). It survives even when no `_ext/log` frame
  // arrived before the close, so prefer it over the locally-tailed stderr.
  private onExit(agentId?: string, closeDetail?: string) {
    // Without an agentId (older server) treat it as every live connection.
    const agents = agentId ? [agentId] : [...this.conns.keys()];
    for (const a of agents) {
      if (this.connState(a) === 'down') continue;
      const reason = closeDetail || this.conns.get(a)?.stderrTail;
      this.setConn(a, { state: 'error' });
      const owned = this.sessions.filter((s) => s.agentId === a);
      const detail = reason ? `: ${reason}` : '.';
      if (owned.length === 0) this.connError = `The ${this.agentLabel(a)} agent process exited${detail}`;
      for (const s of owned) {
        s.phase = 'error';
        s.stalled = false;
        s.turnStartedAt = null;
        s.stopReceived = false;
        s.inflightPrompt = null;
        s.authRetrying = false;
        this.abandonSummaryCapture(s);
        s.error = `The agent process exited${detail}`;
        this.markDone(s.id);
      }
      if (owned.length > 0) this.persistOpenSessions();
      // If a connect/session request for this agent was still in flight, clear
      // it — the socket-close rejection that used to reset these is now skipped
      // so this exit path stays the single reporter. Leaving them set would
      // wedge the picker on "Connecting…". `busy`/`pending` are coupled and
      // global, so only reset when this exiting agent owns the pending request.
      if (this.pending?.agent === a) {
        this.abandonPending();
        this.busy = false;
      }
    }
    this.touch();
  }

  // ── Messaging ────────────────────────────────────────────────────────────────
  // Every send routes through the queue: when the agent is idle the head fires
  // at once; while it's mid-turn normal prose interrupts the live turn so it's
  // steered promptly. Slash commands are control turns, so they wait behind the
  // active turn instead of cancelling it. ACP accepts one prompt per session at
  // a time, so a steer works by cancelling the current turn (which resolves its
  // prompt) and letting onStop flush the queued message.
  private handleSend() {
    const s = this.current;
    if (!s) return;
    const text = s.draft.trim();
    const attachments = s.attachments;
    if ((!text && attachments.length === 0) || this.connState(s.agentId) !== 'up' || s.phase === 'error' || s.authRetrying) return;
    // `/rewind` is a TUI built-in the ACP adapter rejects — intercept it and open
    // Kairos's native prompt-rewind picker instead of sending it to the agent.
    if (isRewindCommand(text)) {
      this.clearComposer(s);
      this.openRewindPicker(s);
      this.touch();
      return;
    }
    s.queued = [...s.queued, { text, attachments }];
    this.promptHistoryNavigation.delete(s.id);
    this.clearComposer(s);
    if (s.phase === 'thinking' && !isSlashCommandMessage(text)) {
      s.wantsInterrupt = true;
      this.maybeInterrupt(s);
    } else {
      this.flushQueue(s);
    }
    this.touch();
    this.scrollToBottom(true);
  }

  // Fire an armed steer by cancelling the live turn — but hold off while a
  // file-mutating tool call (edit/delete/move) is in flight so we never abort a
  // half-written file. A turn blocked on a permission/elicitation prompt is
  // interrupted immediately (the agent is waiting on the user, not on disk).
  // Cancelling resolves the in-flight prompt, and onStop flushes the queued turn.
  private maybeInterrupt(s: AgentSession) {
    if (!s.wantsInterrupt || s.phase !== 'thinking') return;
    // The steer may have been removed from the queue before it could fire.
    if (s.queued.length === 0) { s.wantsInterrupt = false; return; }
    const blocked = s.permission !== null || s.elicitation !== null;
    if (!blocked && this.hasInflightMutation(s)) return;
    s.wantsInterrupt = false;
    this.client.cancel(s.id);
  }

  private hasInflightMutation(s: AgentSession): boolean {
    return s.items.some(
      (i) =>
        i.kind === 'tool' &&
        i.tool.status === 'in_progress' &&
        (i.tool.kind === 'edit' || i.tool.kind === 'delete' || i.tool.kind === 'move'),
    );
  }

  // Drain the next queued turn into a new prompt, if the agent is idle. The
  // prompt is the text block (when present) followed by any attachment blocks.
  private flushQueue(s: AgentSession) {
    if (s.phase !== 'ready' || s.authRetrying || s.queued.length === 0 || this.connState(s.agentId) !== 'up') return;
    // This steer is being sent as its own turn now, so disarm any pending
    // interrupt — otherwise the stale flag would cancel the fresh turn.
    s.wantsInterrupt = false;
    const [next, ...rest] = s.queued;
    s.queued = rest;
    s.convo.pushUserMessage(next.text, next.attachments);
    this.syncConversationState(s);
    if (s.autoTitle && next.text) { s.title = deriveSessionTitle(next.text); s.autoTitle = false; }
    this.persistOpenSessions();
    // Launch-time global rules + role prime the first turn only: send their
    // text as a separate trailing block, then clear it so later turns aren't re-primed.
    // It's sent to the agent but never pushed to the transcript, so the
    // conversation stays clean. The preamble TRAILS the user's prompt: the CLI
    // derives the persisted session title from the first text block, so leading
    // with the rules would title every session with the rules text. The block
    // starts with its own separator because some adapters flatten text blocks.
    const preamble = s.pendingPreamble;
    s.pendingPreamble = undefined;
    const trailingPreamble = preamble ? formatTrailingLaunchPreamble(preamble) : '';
    const blocks: ContentBlock[] = [
      ...(next.text ? [{ type: 'text', text: next.text } as ContentBlock] : []),
      ...(trailingPreamble ? [{ type: 'text', text: trailingPreamble } as ContentBlock] : []),
      ...next.attachments,
    ];
    // Snapshot the working tree before the turn so resume-from-prompt can
    // restore files to this point. Fire-and-forget: a non-git cwd returns
    // checkpoint:null and a failure must never block sending.
    this.captureCheckpoint(s, next.text);
    s.inflightPrompt = { blocks, authRetryAttempted: false };
    this.sendInflightPrompt(s);
  }

  private sendInflightPrompt(s: AgentSession) {
    if (!s.inflightPrompt || this.connState(s.agentId) !== 'up') return;
    this.client.prompt(s.id, s.inflightPrompt.blocks);
    s.phase = 'thinking';
    s.turnStartedAt = Date.now();
    s.authRetrying = false;
    s.error = '';
    this.persistOpenSessions();
    this.touch();
    if (s.id === this.activeId) this.scrollToBottom(true);
  }

  private removeQueued(s: AgentSession, index: number) {
    s.queued = s.queued.filter((_, i) => i !== index);
    this.touch();
  }

  // The directory whose working tree a session edits — the isolated worktree when
  // one is in use, else the session cwd. Checkpoints snapshot/restore against this.
  private sessionWorkdir(s: AgentSession): string {
    return s.worktree?.worktreePath ?? s.cwd;
  }

  // Snapshot the working tree before a turn. Best-effort: errors are swallowed so
  // sending is never blocked, and a non-git cwd yields a null checkpoint.
  private async captureCheckpoint(s: AgentSession, promptText: string) {
    try {
      const { checkpoint } = await createCheckpoint({
        cwd: this.sessionWorkdir(s),
        sessionId: s.id,
        turnIndex: s.checkpoints.length,
        promptText,
      });
      if (checkpoint) {
        s.checkpoints = [...s.checkpoints, checkpoint];
        this.touch();
      }
    } catch {
      // Snapshotting is a safety net, not a gate — ignore failures.
    }
  }

  // Rehydrate a session's checkpoints from the server registry (survives reload).
  private async loadCheckpoints(s: AgentSession) {
    try {
      const { checkpoints } = await listCheckpoints(s.id);
      if (checkpoints.length) { s.checkpoints = checkpoints; this.touch(); }
    } catch {
      // Registry unavailable — leave the in-memory list as-is.
    }
  }

  private promptInfo(s: AgentSession) {
    const cached = this.promptIndexCache.get(s);
    if (cached && cached.itemsStructureVersion === s.itemsStructureVersion) return cached;
    const prompts = s.items.filter((i) => i.kind === 'message' && i.role === 'user') as Array<
      Extract<AgentSession['items'][number], { kind: 'message' }>
    >;
    const indexById = new Map<string, number>();
    prompts.forEach((p, i) => indexById.set(p.id, i));
    const entry = { itemsStructureVersion: s.itemsStructureVersion, prompts, indexById };
    this.promptIndexCache.set(s, entry);
    return entry;
  }

  private promptMessages(s: AgentSession) {
    return this.promptInfo(s).prompts;
  }

  private checkpointBeforePrompt(s: AgentSession, promptIndex: number) {
    return s.checkpoints.find((c) => c.turnIndex === promptIndex) ?? null;
  }

  private resetForReload(s: AgentSession, retainedPromptCount: number) {
    s.loading = true;
    s.phase = 'ready';
    s.turnStartedAt = null;
    s.stalled = false;
    s.backgroundActive = 0;
    s.stopReceived = false;
    s.error = '';
    s.draft = '';
    s.attachments = [];
    s.attachError = '';
    s.queued = [];
    s.inflightPrompt = null;
    s.authRetrying = false;
    s.wantsInterrupt = false;
    s.permission = null;
    s.elicitation = null;
    s.terminalOutputs = new Map();
    s.summary = undefined;
    s.searchMatches = undefined;
    s.replayedToolIds = new Set();
    s.checkpoints = s.checkpoints.filter((c) => c.turnIndex < retainedPromptCount);
    s.convo.reset();
    this.syncConversationState(s);
    evictMarkdownCache(`${s.id}:`);
    const nextWindow = new Map(this.timelineWindow);
    nextWindow.delete(s.id);
    this.timelineWindow = nextWindow;
  }

  // Open the `/rewind` prompt picker (TUI parity). Shares the same preconditions
  // as handleResumeFromPrompt so the two never fight; a session with no prompts
  // yet surfaces a friendly note instead of an empty menu.
  private openRewindPicker(s: AgentSession) {
    if (this.resumePromptDialog || this.rewindPickerId || this.resumeAnywhereBusy || this.busy || s.loading || s.phase !== 'ready' || s.backgroundActive > 0) return;
    if (this.promptMessages(s).length === 0) {
      s.error = 'Nothing to rewind to yet.';
      this.touch();
      return;
    }
    this.rewindPickerId = s.id;
    this.touch();
  }

  private closeRewindPicker() {
    this.rewindPickerId = null;
    this.touch();
  }

  private handleResumeFromPrompt(
    s: AgentSession,
    detail: { index: number; mode: ResumePromptMode },
  ) {
    if (this.resumePromptDialog || this.resumeAnywhereBusy || this.busy || s.loading || s.phase !== 'ready' || s.backgroundActive > 0) return;
    const prompts = this.promptMessages(s);
    const prompt = prompts[detail.index];
    if (!prompt) return;
    if (detail.mode === 'overwrite' && !this.conn(s.agentId)?.capabilities.loadSession) {
      s.error = 'This agent cannot reload a trimmed session inline.';
      this.touch();
      return;
    }
    this.resumePromptDialog = { sessionId: s.id, index: detail.index, mode: detail.mode };
  }

  private resumePromptContext() {
    const req = this.resumePromptDialog;
    if (!req) return null;
    const s = this.session(req.sessionId);
    if (!s) return null;
    const prompt = this.promptMessages(s)[req.index];
    if (!prompt) return null;
    const restorePoint = this.checkpointBeforePrompt(s, req.index);
    return { req, s, prompt, restorePoint };
  }

  private closeResumePromptDialog() {
    this.resumePromptDialog = null;
  }

  private async confirmResumeFromPrompt() {
    const ctx = this.resumePromptContext();
    if (!ctx) {
      this.resumePromptDialog = null;
      return;
    }
    const { req, s, prompt, restorePoint } = ctx;
    if (this.resumeAnywhereBusy || this.busy || s.loading || s.phase !== 'ready' || s.backgroundActive > 0) return;
    if (req.mode === 'overwrite' && !this.conn(s.agentId)?.capabilities.loadSession) {
      this.resumePromptDialog = null;
      s.error = 'This agent cannot reload a trimmed session inline.';
      this.touch();
      return;
    }

    this.resumePromptDialog = null;
    this.resumeAnywhereBusy = req;
    try {
      if (restorePoint) await restoreCheckpoint(this.sessionWorkdir(s), restorePoint.sha, s.id);
      const title = req.mode === 'fork' ? `${s.title || 'Session'} (fork)` : undefined;
      const result = await resumeSessionFromPoint(s.id, { turnIndex: req.index, mode: req.mode, title, includeSelected: false });
      if (req.mode === 'overwrite') {
        this.resumeDrafts.set(s.id, prompt.text);
        this.resetForReload(s, req.index);
        this.touch();
        this.client.loadSession(s.id, s.cwd, s.agentId);
      } else {
        this.resumeDrafts.set(result.session.id, prompt.text);
        await this.resumeAgentSession(result.session);
      }
      this.refreshSidebarRecent();
    } catch (err) {
      s.error = (err as Error).message || 'Failed to resume from this prompt.';
      this.touch();
    } finally {
      this.resumeAnywhereBusy = null;
    }
  }

  // ── Attachments ──────────────────────────────────────────────────────────────
  // The agent advertises which content kinds it accepts via promptCapabilities;
  // build the file picker's `accept` from that. Text-like files ride the
  // embeddedContext capability (sent inline as `resource` blocks). Returns ''
  // when the agent takes none of them, which hides the attach affordance.
  private attachAccept(s: AgentSession): string {
    const caps = this.conn(s.agentId)?.capabilities.promptCapabilities;
    const types: string[] = [];
    if (caps?.image) types.push('image/*');
    if (caps?.audio) types.push('audio/*');
    if (caps?.embeddedContext) types.push(TEXT_ACCEPT);
    return types.join(',');
  }

  private openFilePicker(_accept: string) {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('.file-input');
    input?.click();
  }

  private handleFileInput(s: AgentSession, e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) this.addFiles(s, input.files);
    input.value = '';
  }

  private handlePaste(s: AgentSession, e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files && files.length && this.attachAccept(s)) {
      e.preventDefault();
      this.addFiles(s, files);
    }
  }

  private handleDrop(s: AgentSession, e: DragEvent) {
    const dt = e.dataTransfer;
    if (!dt || !this.attachAccept(s)) return;
    // Always swallow the drop once the composer accepts attachments — otherwise a
    // payload that carries no `files` (some macOS screenshot drags expose the
    // image only via `items`) lets the browser fall back to opening the image.
    e.preventDefault();
    // Prefer `files`, but fall back to `items` — dragging a macOS screenshot
    // (especially the floating thumbnail) often surfaces the image there instead.
    let files = dt.files?.length ? Array.from(dt.files) : [];
    if (!files.length && dt.items?.length) {
      files = Array.from(dt.items)
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => f != null);
    }
    if (files.length) this.addFiles(s, files);
  }

  // Read dropped/pasted/picked files and stage them as content blocks, honouring
  // the agent's advertised prompt capabilities. Images/audio go base64 as their
  // own block kinds; text-like files (JSON, code, markdown, csv…) are read as
  // UTF-8 and sent inline as embedded `resource` blocks (uploads have no stable
  // path, so resource_link/@-mention doesn't fit).
  private async addFiles(s: AgentSession, files: FileList | File[]) {
    const caps = this.conn(s.agentId)?.capabilities.promptCapabilities;
    // Reset any prior rejection message — a fresh pick/drop/paste starts clean.
    s.attachError = '';
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('audio/') ? 'audio'
        : isTextLike(file) ? 'text'
        : null;
      if (!kind
        || (kind === 'image' && !caps?.image)
        || (kind === 'audio' && !caps?.audio)
        || (kind === 'text' && !caps?.embeddedContext)) {
        rejected.push(`Can't attach ${file.name} — unsupported file type.`);
        continue;
      }
      if (kind === 'text') {
        if (file.size > TEXT_ATTACH_MAX_BYTES) {
          rejected.push(`File too large — ${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB (max 10 MB).`);
          continue;
        }
        const text = await this.readAsText(file);
        if (text == null) {
          rejected.push(`Couldn't read ${file.name}.`);
          continue;
        }
        s.attachments = [...s.attachments, {
          type: 'resource',
          resource: { uri: `file:///${file.name}`, text, mimeType: file.type || 'text/plain' },
        }];
      } else {
        const data = await this.readAsBase64(file);
        if (data == null) {
          rejected.push(`Couldn't read ${file.name}.`);
          continue;
        }
        s.attachments = [...s.attachments, { type: kind, mimeType: file.type, data }];
      }
      this.touch();
    }
    if (rejected.length) s.attachError = rejected.join(' ');
    this.touch();
  }

  private readAsText(file: File): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  }

  private readAsBase64(file: File): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Strip the `data:<mime>;base64,` prefix — ACP carries the raw base64.
        const comma = typeof result === 'string' ? result.indexOf(',') : -1;
        resolve(comma >= 0 ? (result as string).slice(comma + 1) : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  private dismissAttachError(s: AgentSession) {
    s.attachError = '';
    this.touch();
  }

  private removeAttachment(s: AgentSession, index: number) {
    s.attachments = s.attachments.filter((_, i) => i !== index);
    s.attachError = '';
    this.touch();
  }

  private clearComposer(s: AgentSession) {
    s.draft = '';
    s.attachments = [];
    s.attachError = '';
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.slashIndex = 0;
    this.mentionOpen = false;
    this.promptHistoryNavigation.delete(s.id);
    if (this.listening) this.stopDictation();
    const ta = this.activeComposerTextarea();
    if (ta) {
      ta.value = '';
      this.scheduleComposerResize(true, ta);
    }
  }

  // Compact the running context. `/compact` is a normal prompt the adapter
  // intercepts — it streams "Compacting…"/"Compacting completed." back and emits
  // a fresh usage_update with the shrunk size. Only when idle: ACP runs one turn
  // per session, so we skip the steering queue and never compact mid-turn.
  private handleCompact() {
    const s = this.current;
    if (!s || s.phase !== 'ready' || s.authRetrying || this.connState(s.agentId) !== 'up') return;
    s.inflightPrompt = {
      blocks: [{ type: 'text', text: '/compact' }],
      authRetryAttempted: false,
    };
    this.sendInflightPrompt(s);
  }

  // Ask the agent to narrate the changes it made this session. Sent as a normal
  // prompt (modeled on handleCompact), but beginCapture diverts the reply out of
  // the chat timeline into session.summary so it renders only in the
  // Summary panel — onStop reads the captured text back once the turn ends.
  private handleSummary(s: AgentSession) {
    if (s.phase !== 'ready' || s.authRetrying || this.connState(s.agentId) !== 'up') return;
    s.convo.beginCapture();
    s.inflightPrompt = {
      blocks: [{ type: 'text', text: SUMMARY_PROMPT }],
      authRetryAttempted: false,
    };
    this.pendingSummary = s.id;
    this.sendInflightPrompt(s);
  }

  private handleStop() {
    const s = this.current;
    if (!s) return;
    this.client.cancel(s.id);
    s.phase = 'ready';
    s.turnStartedAt = null;
    s.stopReceived = false;
    s.inflightPrompt = null;
    s.authRetrying = false;
    this.abandonSummaryCapture(s);
    this.persistOpenSessions();
    // Stopping is a clean reset — drop pending steers rather than fire them
    // into a turn the user just interrupted. Server-side `cancel` also resolves
    // any in-flight elicitation with `{action:'cancel'}`, so the local card is
    // dead anyway — clear it so the user can compose freely.
    s.queued = [];
    s.elicitation = null;
    this.touch();
  }

  // Primary stall recovery: cancel the wedged turn, then nudge the same session
  // back to work — no process kill, no session loss. We queue "Continue." first
  // so the normal turn-end path (onStop → flushQueue) fires it the moment the
  // cancelled turn winds down; ACP allows only one prompt per session at a time,
  // so sending before the cancel lands would be rejected.
  private interruptAndContinue(s: AgentSession) {
    if (this.connState(s.agentId) !== 'up') return;
    s.stalled = false;
    s.elicitation = null;
    s.queued = [{ text: 'Continue.', attachments: [] }];
    this.client.cancel(s.id);
    this.touch();
  }

  // Hard recovery when a turn is wedged and a soft cancel can't reach it: kill
  // the agent subprocess (and its runaway children) and resume on the server's
  // acp:agent-restarted reply.
  private forceRestartAgent(s: AgentSession) {
    s.stalled = false;
    this.touch();
    this.client.forceRestart(s.agentId);
  }

  // Browser Web Speech API dictation. Streams interim results onto the draft so
  // the user sees words as they speak; final results lock in. Stopping the
  // session, switching, or losing the connection all halt recognition.
  private toggleDictation() {
    if (this.listening) { this.stopDictation(); return; }
    this.startDictation();
  }

  // Honest label about where dictation audio is processed. The Web Speech API is
  // on-device in Safari (like iMessage dictation) but streams audio to Google's
  // servers in Chrome/Edge — so we say so rather than implying it's always local.
  private dictationTooltip(): string {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isChromium = /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua);
    return isChromium
      ? 'Dictate a message (Chrome sends audio to Google for transcription)'
      : 'Dictate a message (on-device speech recognition)';
  }

  private startDictation() {
    const s = this.current;
    if (!s || !this.speechSupported) return;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    this.dictationBase = s.draft.length && !s.draft.endsWith(' ') ? `${s.draft} ` : s.draft;
    rec.onresult = (e: any) => {
      const active = this.current;
      if (!active) return;
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      const cleanFinal = finalText.replace(/\s+/g, ' ').trim();
      const cleanInterim = interimText.replace(/\s+/g, ' ').trim();
      if (cleanFinal) {
        const baseTrimmed = this.dictationBase.replace(/ +$/, '');
        this.dictationBase = baseTrimmed ? `${baseTrimmed} ${cleanFinal} ` : `${cleanFinal} `;
      }
      const baseTrimmed = this.dictationBase.replace(/ +$/, '');
      active.draft = cleanInterim
        ? (baseTrimmed ? `${baseTrimmed} ${cleanInterim}` : cleanInterim)
        : this.dictationBase;
      this.touch();
      this.scheduleComposerResize(false);
    };
    rec.onerror = () => { this.stopDictation(); };
    rec.onend = () => {
      this.listening = false;
      this.recognition = null;
    };
    try {
      rec.start();
      this.recognition = rec;
      this.listening = true;
    } catch {
      this.recognition = null;
      this.listening = false;
    }
  }

  private stopDictation() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* already stopped */ }
    }
    this.listening = false;
  }

  // Voice output: read an assistant message aloud with the browser's on-device
  // speech synthesis. Clicking the speaking message stops it; clicking a
  // different one switches to it. `speak()` cancels any prior utterance itself.
  private toggleSpeak(item: Extract<AgentSession['items'][number], { kind: 'message' }>) {
    if (this.speakingItemId === item.id) { this.stopSpeaking(); return; }
    this.speakingItemId = item.id;
    speak(item.text, {
      onEnd: () => {
        // Only clear if this message is still the active one — a rapid switch to
        // another message must not blank the newer one's state.
        if (this.speakingItemId === item.id) { this.speakingItemId = null; }
      },
    });
  }

  private stopSpeaking() {
    stopSpeaking();
    this.speakingItemId = null;
  }

  private handleKeydown(e: KeyboardEvent) {
    const s = this.current;
    // While the slash menu is open, arrows/enter/tab drive it instead of the
    // composer; Escape dismisses it without clearing the draft.
    if ((this.slashOpen || this.slashButtonOpen) && s) {
      const matches = this.slashItems(s);
      if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSlash(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSlash(-1); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.slashOpen = false;
        this.slashButtonOpen = false;
        this.slashIndex = 0;
        this.lastSlashQuery = null;
        document.removeEventListener('click', this.closeSlashMenu);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        const pick = matches[this.slashIndex];
        if (pick) { e.preventDefault(); this.chooseSlashItem(s, pick); return; }
      }
    }
    // The file-mention menu: arrows navigate, Enter/Tab commits the highlighted
    // file, Escape hides. Falls through to a verbatim attach when nothing matches.
    if (this.mentionOpen && s) {
      const matches = this.mentionItems(s);
      if (e.key === 'ArrowDown') { e.preventDefault(); this.moveMention(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.moveMention(-1); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.mentionOpen = false; return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        this.chooseMention(s, matches[this.mentionIndex]);
        return;
      }
    }
    if (s && this.handlePromptHistoryKeydown(s, e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  private handlePromptHistoryKeydown(s: AgentSession, e: KeyboardEvent): boolean {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const ta = e.currentTarget instanceof HTMLTextAreaElement
      ? e.currentTarget
      : this.activeComposerTextarea();
    if (!ta) return false;

    const active = this.promptHistoryNavigation.get(s.id) ?? null;
    if (ta.selectionStart !== ta.selectionEnd) return false;
    if (active && ta.selectionStart !== ta.value.length) return false;
    if (!active && e.key === 'ArrowDown') return false;
    if (!active && !this.shouldStartPromptHistory(ta)) return false;

    const history = this.promptMessages(s).map((m) => m.text);
    const step = e.key === 'ArrowUp'
      ? previousPrompt(history, active, s.draft)
      : nextPrompt(history, active);
    if (!step) return false;

    e.preventDefault();
    this.applyPromptHistoryStep(s, ta, step);
    return true;
  }

  private shouldStartPromptHistory(ta: HTMLTextAreaElement): boolean {
    return ta.value.length === 0 || ta.selectionStart === 0;
  }

  private applyPromptHistoryStep(s: AgentSession, ta: HTMLTextAreaElement, step: PromptHistoryStep) {
    if (step.navigation) this.promptHistoryNavigation.set(s.id, step.navigation);
    else this.promptHistoryNavigation.delete(s.id);
    s.draft = step.text;
    ta.value = step.text;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    this.scheduleComposerResize(true, ta);
    this.syncSlashMenu(s);
    this.syncMentionMenu(s);
    this.touch();
  }

  private handlePermissionChoice(e: CustomEvent) {
    const { requestId, outcome } = e.detail;
    this.client.resolvePermission(requestId, outcome);
    const s = this.current;
    // Whether the user chose an "allow" option — checked before we clear the
    // pending request, so we can resolve the optionId against its options.
    const approved = !!(s?.permission && outcome?.outcome === 'selected' &&
      s.permission.options.find((o) => o.optionId === outcome.optionId)?.kind.startsWith('allow'));
    if (s) { s.permission = null; this.touch(); }
    // First manual approval with auto-accept off → tempt them toward it, once ever.
    if (s && approved && !s.autoAccept && !autoAcceptHintSeen()) {
      this.showAutoAcceptHint = true;
    }
  }

  private handleElicitationResponse(e: CustomEvent) {
    const { requestId, response } = e.detail as { requestId: string; response: ElicitationResponse };
    this.client.resolveElicitation(requestId, response);
    const s = this.current;
    if (s) { s.elicitation = null; this.touch(); }
  }

  // Auto-accept: future permission requests resolve immediately with the first
  // `allow_*` option. Toggling it on while a request is already pending clears
  // that pending modal too, so the user doesn't have to dismiss it manually.
  private toggleAutoAccept() {
    const s = this.current;
    if (!s) return;
    s.autoAccept = !s.autoAccept;
    saveAutoAccept(s.autoAccept);
    if (s.autoAccept && s.permission) {
      const pick = s.permission.options.find((o) => o.kind.startsWith('allow'));
      if (pick) {
        this.client.resolvePermission(s.permission.requestId, { outcome: 'selected', optionId: pick.optionId });
        s.permission = null;
      }
    }
    // Interacting with the toggle retires the nudge for good.
    if (this.showAutoAcceptHint) { this.showAutoAcceptHint = false; markAutoAcceptHintSeen(); }
    this.touch();
  }

  // "Turn on" from the nudge: enable auto-accept (only if off) and retire the hint.
  private enableAutoAcceptFromHint() {
    const s = this.current;
    if (s && !s.autoAccept) this.toggleAutoAccept();
    else { this.showAutoAcceptHint = false; markAutoAcceptHintSeen(); this.touch(); }
  }

  private dismissAutoAcceptHint() {
    this.showAutoAcceptHint = false;
    markAutoAcceptHintSeen();
    this.touch();
  }

  // Mode, model, and effort controls all flow through the same config-option
  // RPC. The agent echoes the change back via config_option_update (and a model
  // switch may rebuild the effort option), so the optimistic local update here
  // is just to keep the control responsive. The choice is persisted per-agent so
  // the next session reopens with it. Picking from a popover also closes it.
  private handleConfigChange(configId: string, value: string) {
    const s = this.current;
    if (!s) return;
    this.sendConfigChange(s, configId, value);
    saveConfigValue(s.agentId, configId, value);
    if (this.configMenuId === configId) this.configMenuId = null;
    this.touch();
  }

  private sendConfigChange(s: AgentSession, configId: string, value: string) {
    const option = s.configOptions.find((o) => o.id === configId);
    if (option?.category === 'model') this.pendingModelDefaultCapture.add(s.id);
    this.setConfigValue(s, configId, value);
    this.client.setConfigOption(s.id, configId, value);
  }

  private setConfigValue(s: AgentSession, configId: string, value: string) {
    s.configOptions = s.configOptions.map((o) => (o.id === configId ? { ...o, currentValue: value } : o));
  }

  // Re-apply the agent's last-used mode/model/effort selection onto a fresh
  // session. Switching model makes the agent rebuild the effort option, so the
  // model is applied first and
  // the rest deferred until the rebuilt set arrives in onConfigOptions (which
  // re-plans against it). Without a rebuild step every step applies immediately.
  private restoreConfig(s: AgentSession, saved: SavedConfig) {
    const steps = planConfigRestore(s.configOptions, saved);
    if (!steps.length) return;
    const rebuilds = steps.some((step) => step.rebuilds);
    for (const step of steps) {
      this.sendConfigChange(s, step.id, step.value);
      // After a rebuild step we stop; the remaining steps re-apply once the
      // agent sends the rebuilt option set.
      if (step.rebuilds) break;
    }
    if (rebuilds) this.deferredRestore.set(s.id, saved);
    this.touch();
  }

  // Popover open/close for large config lists. Opening one closes any other
  // (and the slash menu); the highlight starts on the current value. A deferred
  // one-shot document listener closes it on the next outside click (rAF skips
  // the click that opened it), matching the split-button menu in app.ts. We
  // clear any prior listener first so switching between two triggers can't leave
  // a stale closer that immediately shuts the newly opened menu.
  private toggleConfigMenu(o: SessionConfigOption) {
    document.removeEventListener('click', this.closeConfigMenu);
    if (this.configMenuId === o.id) { this.configMenuId = null; return; }
    this.configMenuId = o.id;
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.configMenuIndex = Math.max(0, this.configLeaves(o).findIndex((l) => l.value === o.currentValue));
    requestAnimationFrame(() => {
      document.addEventListener('click', this.closeConfigMenu, { once: true });
    });
  }

  private closeConfigMenu = () => {
    this.configMenuId = null;
  };

  // Flatten an option's choices (groups → their leaves) in display order, which
  // is also the order arrow-key navigation walks.
  private configLeaves(o: SessionConfigOption): SessionConfigSelectOption[] {
    if (!o.options) return [];
    return o.options.flatMap((v) => ('group' in v ? v.options : [v]));
  }

  private configLeafName(o: SessionConfigOption, leaf: SessionConfigSelectOption): string {
    if (o.category !== 'thought_level') return leaf.name;
    const s = this.current;
    if (!s) return leaf.name;
    const defaultValue = thoughtLevelDefaultValue(s.configDefaults, s.configOptions, o.id);
    return defaultValue === leaf.value ? `${leaf.name} (default)` : leaf.name;
  }

  private moveConfigMenu(delta: number) {
    const o = this.current?.configOptions.find((c) => c.id === this.configMenuId);
    if (!o) return;
    const count = this.configLeaves(o).length;
    if (count === 0) return;
    this.configMenuIndex = (this.configMenuIndex + delta + count) % count;
  }

  // force: user intent (sending, switching/loading a session) re-pins to the
  // bottom regardless of scroll position. Streaming updates pass no force, so
  // they only scroll while the user is already pinned.
  private scrollToBottom(force = false) {
    if (force) { this.stickToBottom = true; this.scrolledUp = false; }
    if (!this.stickToBottom) return;
    this.cancelManualScrollRestore();
    // Streaming calls this per token; coalesce to one scroll per frame so we
    // don't queue dozens of rAF callbacks that each force a synchronous layout
    // (read scrollHeight + write scrollTop). One write per frame is enough to
    // stay pinned to the bottom.
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (!this.stickToBottom) return;
      const el = this.activeTimelineElement();
      // Avoid reading scrollHeight here. This runs during session switches and
      // streaming, and the read forces layout on large timelines. Browsers clamp
      // oversized scrollTop values to the actual bottom.
      if (el) el.scrollTop = BOTTOM_SCROLL_TOP;
    });
  }

  private onTimelineScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    // Within a small threshold of the bottom counts as pinned, so the flag
    // re-engages when the user scrolls back down.
    const nextStick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!nextStick && this.scrollFrame) {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = 0;
    }
    if (nextStick) this.cancelManualScrollRestore();
    this.stickToBottom = nextStick;
    // Only the active timeline fires this (inactive ones are display:none), so
    // it's safe to mirror straight into the pill's reactive flag.
    if (this.scrolledUp === this.stickToBottom) this.scrolledUp = !this.stickToBottom;
  }

  // The pill click: hard re-pin and scroll to the newest message.
  private jumpToLatest = () => this.scrollToBottom(true);

  private activeTimelineElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.timeline.active') as HTMLElement | null;
  }

  private manualScrollSnapshot(sessionId: string): ManualScrollSnapshot | null {
    if (sessionId !== this.activeId || this.stickToBottom) return null;
    const el = this.activeTimelineElement();
    return el ? { sessionId, scrollTop: el.scrollTop, scrollIntentVersion: this.scrollIntentVersion } : null;
  }

  private preserveTimelineWindowOnAppend(sessionId: string, previousLength: number, nextLength: number) {
    if (sessionId !== this.activeId || this.stickToBottom) return;
    const cap = this.timelineWindow.get(sessionId) ?? TIMELINE_WINDOW;
    const nextCap = preserveTimelineWindowStart(cap, previousLength, nextLength);
    if (nextCap === cap) return;
    const next = new Map(this.timelineWindow);
    next.set(sessionId, nextCap);
    this.timelineWindow = next;
  }

  private preserveManualScrollAfterRender(snapshot: ManualScrollSnapshot) {
    if (this.preserveScrollFrame) return;
    this.preserveScrollFrame = requestAnimationFrame(() => {
      this.preserveScrollFrame = 0;
      void this.updateComplete.then(() => {
        if (
          this.activeId !== snapshot.sessionId ||
          this.stickToBottom ||
          this.scrollIntentVersion !== snapshot.scrollIntentVersion
        ) return;
        const el = this.activeTimelineElement();
        if (!el) return;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(snapshot.scrollTop, maxTop);
      });
    });
  }

  private onTimelineScrollIntent = () => {
    this.scrollIntentVersion++;
  };

  private cancelManualScrollRestore() {
    if (!this.preserveScrollFrame) return;
    cancelAnimationFrame(this.preserveScrollFrame);
    this.preserveScrollFrame = 0;
  }

  private focusComposer() {
    requestAnimationFrame(() => {
      const ta = this.activeComposerTextarea();
      ta?.focus();
      if (ta) this.scheduleComposerResize(true, ta);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  render() {
    const s = this.current;
    const showBehind = this.view === 'behind';
    // The right side-panel only exists within a live session view (not the
    // connect screen or Behind the Scenes), so the toolbar button is enabled
    // only then; it reflects whichever panel (Files/Review/Summary/Plan) is open.
    const rightAvailable = !!s && !showBehind;
    return html`
      <div class="layout">
        <agents-sidebar
          .active=${this.activeSummaries()}
          .previouslyOpen=${this.previouslyOpenEntries()}
          .activeId=${this.activeId}
          .behindActive=${showBehind}
          .lastCwd=${loadLastCwd()}
          .lastAgentLabel=${this.lastAgentLabel()}
          .rightPanelAvailable=${rightAvailable}
          .rightPanelOpen=${rightAvailable && this.panelOpen}
          .petMood=${this.petMood()}
          ?developer-mode=${this.isDeveloperMode()}
          @toggle-right-panel=${this.toggleRightPanel}
          @new-session=${this.handleNewSession}
          @new-session-quick=${this.handleQuickStart}
          @switch-session=${(e: CustomEvent) => this.switchTo(e.detail)}
          @close-session=${(e: CustomEvent) => this.closeSession(e.detail)}
          @resume-session=${(e: CustomEvent) => this.resumeAgentSession(e.detail)}
          @rename-session=${(e: CustomEvent) => this.handleRenameSession(e.detail)}
          @reorder-active-sessions=${(e: CustomEvent) => this.handleReorderActiveSessions(e.detail)}
          @show-behind-scenes=${this.handleShowBehindScenes}
        ></agents-sidebar>
        <div class="main">
          ${showBehind
            ? this.renderBehindScenes()
            : s ? this.renderSession(s) : this.renderConnect()}
        </div>
      </div>
      ${this.renderRewindPicker()}
      ${this.renderResumePromptDialog()}
    `;
  }

  // The `/rewind` picker: a TUI-parity list of the session's prompts. Picking one
  // hands off to handleResumeFromPrompt in overwrite mode, which opens the
  // existing "Edit prompt and rewind?" confirm dialog — so the picker is only a
  // selection surface and the restore/trim/reload logic stays in one place.
  private renderRewindPicker() {
    if (!this.rewindPickerId) return nothing;
    const s = this.session(this.rewindPickerId);
    if (!s) return nothing;
    const prompts = this.promptMessages(s);
    if (prompts.length === 0) return nothing;
    const busy = !!this.resumeAnywhereBusy || this.busy || s.loading || s.phase !== 'ready' || s.backgroundActive > 0;
    const canReload = !!this.conn(s.agentId)?.capabilities.loadSession;

    return html`
      <div class="resume-backdrop" @click=${() => this.closeRewindPicker()}>
        <div
          class="resume-dialog rewind-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rewind-title"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="resume-kicker">
            ${icon.refresh(13)}
            <span>Rewind</span>
          </div>
          <h2 class="resume-title" id="rewind-title">Rewind to a prompt</h2>
          <p class="resume-body">
            Pick a prompt to rewind to. Later conversation is removed and files are
            restored to the checkpoint from before that prompt ran.
          </p>
          ${!canReload
            ? html`<div class="resume-note warn"><span>${icon.circle(15)}</span><span>This agent cannot reload a trimmed session inline, so rewind is unavailable here.</span></div>`
            : html`
              <div class="rewind-list" role="listbox">
                ${prompts
                  .map((prompt, index) => ({ prompt, index }))
                  .reverse()
                  .map(({ prompt, index }) => {
                    const restorePoint = this.checkpointBeforePrompt(s, index);
                    return html`
                      <button
                        class="rewind-item"
                        role="option"
                        ?disabled=${busy}
                        @click=${() => this.chooseRewind(s, index)}
                      >
                        <span class="rewind-num">${index + 1}</span>
                        <span class="rewind-text">${prompt.text || '(no prompt text)'}</span>
                        <span class="rewind-flag" title=${restorePoint ? 'Files restore to a checkpoint' : 'No file checkpoint — conversation only'}>
                          ${restorePoint ? icon.check(14) : icon.circle(14)}
                        </span>
                      </button>
                    `;
                  })}
              </div>
            `}
          <div class="resume-actions">
            <button class="resume-btn" ?disabled=${busy} @click=${() => this.closeRewindPicker()}>Never mind</button>
          </div>
        </div>
      </div>
    `;
  }

  private chooseRewind(s: AgentSession, index: number) {
    this.rewindPickerId = null;
    this.handleResumeFromPrompt(s, { index, mode: 'overwrite' });
  }

  private renderResumePromptDialog() {
    const ctx = this.resumePromptContext();
    if (!ctx) return nothing;
    const { req, prompt, restorePoint } = ctx;
    const isFork = req.mode === 'fork';
    const title = isFork ? 'Fork from this prompt?' : 'Edit prompt and rewind?';
    const body = isFork
      ? 'This creates a new session from before this prompt and keeps the original conversation. The prompt text will open in the new composer so you can adjust it before sending.'
      : 'This removes later conversation from this session, reloads the trimmed history, and puts this prompt back in the composer for editing.';
    const fileNote = restorePoint
      ? 'Files will be restored to the checkpoint from before this prompt ran.'
      : 'No checkpoint exists for this prompt. The conversation will rewind, but files in the workspace will stay as they are.';
    const confirmLabel = isFork ? 'Fork session' : 'Edit & rewind';
    const confirmClass = isFork ? 'resume-btn primary' : 'resume-btn danger';
    const busy = !!this.resumeAnywhereBusy || this.busy || ctx.s.loading || ctx.s.phase !== 'ready' || ctx.s.backgroundActive > 0;

    return html`
      <div class="resume-backdrop" @click=${() => this.closeResumePromptDialog()}>
        <div
          class="resume-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="resume-prompt-title"
          aria-describedby="resume-prompt-body resume-prompt-note"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="resume-kicker">
            ${isFork ? icon.gitFork(13) : icon.pencil(13)}
            <span>Prompt ${req.index + 1}</span>
          </div>
          <h2 class="resume-title" id="resume-prompt-title">${title}</h2>
          <p class="resume-body" id="resume-prompt-body">${body}</p>
          <div class="resume-prompt">${prompt.text}</div>
          <div class="resume-note ${restorePoint ? '' : 'warn'}" id="resume-prompt-note">
            ${restorePoint ? icon.check(15) : icon.circle(15)}
            <span>${fileNote}</span>
          </div>
          <div class="resume-actions">
            <button class="resume-btn" ?disabled=${busy} @click=${() => this.closeResumePromptDialog()}>Cancel</button>
            <button class=${confirmClass} ?disabled=${busy} autofocus @click=${() => void this.confirmResumeFromPrompt()}>
              ${confirmLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private handleShowBehindScenes = () => {
    if (this.view === 'behind') {
      // Already open → return to the live session view (which has stayed mounted).
      this.view = 'session';
      return;
    }
    this.view = 'behind';
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.configMenuId = null;
  };

  // Behind the Scenes pane — the curated protocol → UI reference. The session/
  // picker view stays mounted (just hidden behind this), so live sockets and
  // subprocesses are unaffected, and the user's last live session is one sidebar
  // click away. The *live* frame inspector lives in the session's Frames panel.
  private renderBehindScenes() {
    return html`<agents-behind-scenes></agents-behind-scenes>`;
  }

  private renderAgentChip(a: AgentOption, prominence: 'primary' | 'secondary' = 'secondary') {
    return html`
      <div class="agent-chip-wrap ${a.id === this.selectedAgent ? 'sel' : ''}">
        <button
          class="agent-chip ${prominence === 'primary' ? 'primary-agent' : 'secondary-agent'} ${a.id === this.selectedAgent ? 'sel' : ''} ${a.managedApp && !a.installed ? 'uninstalled' : ''}"
          @click=${() => { this.selectedAgent = a.id; this.connError = ''; }}
          ${tooltip(a.managedApp && !a.installed ? `Run \`kairos apps install ${a.id}\` to enable` : '')}
        >
          ${hasAgentLogo(a.id) ? html`<agent-logo .agent=${a.id} .size=${prominence === 'primary' ? 18 : 14}></agent-logo>` : nothing}
          ${a.label}
          ${a.managedApp && !a.installed ? html`<span class="chip-tag">not installed</span>` : nothing}
        </button>
        ${a.custom ? html`
          <button class="chip-edit" ${tooltip(`Edit ${a.label}`)} @click=${() => this.openEditAgent(a.id)}>${icon.pencil(13)}</button>
          <button class="chip-edit" ${tooltip(`Remove ${a.label}`)} @click=${() => this.removeAgent(a.id)}>${icon.close(13)}</button>
        ` : nothing}
      </div>
    `;
  }

  private renderConnect() {
    const connecting = this.busy || this.creatingWorktree || this.connState(this.selectedAgent) === 'connecting';
    const needsAuth = this.connState(this.selectedAgent) === 'auth';
    const replacement = this.resumeReplacementEntry;
    const firstSession = !replacement && this.sessions.length === 0;
    const agents = this.agentOptions.length
      ? this.agentOptions
      : [{ id: 'claude', label: 'Claude', managedApp: false, installed: true }];
    const approvedAgents = agents.filter((a) => APPROVED_AGENT_IDS.has(a.id));
    const otherAgents = agents.filter((a) => !APPROVED_AGENT_IDS.has(a.id));
    const selected = agents.find((a) => a.id === this.selectedAgent);
    const needsInstall = !!selected?.managedApp && !selected.installed;
    const heading = replacement ? 'Choose replacement folder' : firstSession ? this.modeHeading() : 'New session';
    const description = replacement
      ? 'The original working directory for this conversation is gone or unavailable. Pick an existing folder to replay the session inline.'
      : firstSession
        ? this.modeDescription()
        : 'Pick an AI assistant for this session. Your other sessions stay open in the sidebar.';
    return html`
      <div class="wrap">
        <div class="connect">
          <h2>${heading}</h2>
          <p>${description}</p>
          ${replacement ? html`
            <div class="field">
              <label>Session</label>
              <div class="connect-hint">
                ${replacement.title || replacement.firstMessage || replacement.id.slice(0, 8)} · ${this.agentLabel(this.selectedAgent)}
              </div>
              ${replacement.dir ? html`<div class="connect-hint">Original folder: ${replacement.dir}</div>` : nothing}
            </div>
          ` : html`
            <div class="field">
              <label>Agent</label>
              <div class="agent-picker primary-agent-picker">
                ${approvedAgents.map((a) => this.renderAgentChip(a, 'primary'))}
              </div>
              ${otherAgents.length ? html`
                <div class="other-agents">
                  <div class="other-agents-heading">Other agents</div>
                  <div class="agent-warning" role="note">
                    <strong>Use approved kairos agents for normal work.</strong>
                    Agents outside Claude, Codex, and Gemini are not intended for general use unless explicitly approved.
                  </div>
                  <div class="agent-picker secondary-agent-picker">
                    ${otherAgents.map((a) => this.renderAgentChip(a, 'secondary'))}
                    ${this.isDeveloperMode() ? html`<button class="agent-chip add-agent" @click=${this.openCreateAgent} ${tooltip('Connect your own ACP agent')}>+ Custom</button>` : nothing}
                  </div>
                </div>
              ` : html`
                ${this.isDeveloperMode() ? html`<div class="agent-picker secondary-agent-picker custom-only-agent-picker">
                  <button class="agent-chip add-agent" @click=${this.openCreateAgent} ${tooltip('Connect your own ACP agent')}>+ Custom</button>` : nothing}
                </div>
              `}
              ${this.customForm ? this.renderAgentForm() : nothing}
            </div>
            ${this.renderAuthModeField()}
            ${this.renderRolePicker()}
          `}
          ${this.workspaces.length ? html`
            <div class="field">
              <label>VS Code Workspace</label>
              <select @change=${(e: Event) => this.onCwdChanged((e.target as HTMLSelectElement).value)} @keydown=${(e: KeyboardEvent) => this.onConnectPathKeydown(e, connecting || needsInstall)} .value=${this.cwd}>
                <option value="" ?selected=${!this.cwd}>Select a workspace…</option>
                ${this.workspaces.map((w) => html`<option value=${w.root ?? w.path}>${w.name} — ${w.root ?? w.path}</option>`)}
              </select>
            </div>
          ` : nothing}
          ${this.isDeveloperMode() ? html`
          <div class="field">
            <label>${this.workspaces.length ? 'Or enter a path' : 'Working directory'}</label>
            <input class="path-input" type="text" placeholder="/absolute/path/to/project" .value=${this.cwd} @input=${(e: Event) => this.onCwdChanged((e.target as HTMLInputElement).value)} @keydown=${(e: KeyboardEvent) => this.onConnectPathKeydown(e, connecting || needsInstall)} />
          </div>
          ` : nothing}
          ${replacement ? nothing : html`
            ${this.isDeveloperMode() ? html`
            <div class="field">
              <label>Name <span class="af-hint">— optional; defaults to your first message</span></label>
              <input class="path-input" type="text" placeholder="Name this session" .value=${this.sessionName} @input=${(e: Event) => { this.sessionName = (e.target as HTMLInputElement).value; }} @keydown=${(e: KeyboardEvent) => this.onConnectPathKeydown(e, connecting || needsInstall)} />
            </div>
            ${this.renderWorktreeField()}
            ` : nothing}
          `}
          ${this.connError ? html`<div class="banner-error">${this.connError}</div>` : nothing}
          ${needsAuth ? this.renderAuthPanel() : html`
            <button class="primary-btn" ?disabled=${connecting || needsInstall} @click=${this.handleStart}>
              ${this.creatingWorktree
                ? 'Creating worktree…'
                : connecting
                  ? 'Connecting…'
                  : needsInstall
                    ? `Install ${selected?.label} to start`
                    : replacement
                      ? 'Resume session'
                      : 'Start session'}
            </button>
            ${replacement ? html`<button class="ghost-btn connect-cancel" @click=${this.cancelResumeReplacement}>Cancel</button>` : nothing}
            ${connecting && !this.creatingWorktree ? html`
              <p class="connect-hint">Starting the ${selected?.label ?? 'agent'} agent… If its adapter hasn't finished downloading in the background yet, the first launch can take a minute.</p>
              ${this.conn(this.selectedAgent)?.stderrTail
                ? html`<pre class="connect-log">${this.conn(this.selectedAgent)!.stderrTail}</pre>`
                : nothing}
              <button class="ghost-btn connect-cancel" @click=${() => this.cancelConnecting(this.selectedAgent)}>Cancel</button>
            ` : nothing}
          `}
        </div>
      </div>
    `;
  }

  // Isolated-worktree toggle — only shown once the cwd is detected as a git repo.
  // Checking it reveals an editable branch name (auto-filled). Absent for non-git
  // dirs and while detection is still in flight, so the picker stays clean.
  private renderWorktreeField() {
    if (!this.repoInfo?.isRepo) return nothing;
    const base = this.repoInfo.currentBranch || 'HEAD';
    return html`
      <div class="field worktree-field">
        <label class="wt-toggle">
          <input type="checkbox" .checked=${this.useWorktree}
            @change=${(e: Event) => { this.useWorktree = (e.target as HTMLInputElement).checked; }} />
          <span>Run in an isolated git worktree
            <span class="af-hint">— separate checkout + branch, off ${base}</span>
          </span>
        </label>
        ${this.useWorktree ? html`
          <input class="path-input wt-branch" placeholder="agent/my-task"
            .value=${this.worktreeBranch}
            @input=${(e: Event) => { this.worktreeBranch = (e.target as HTMLInputElement).value; }} />
        ` : nothing}
      </div>
    `;
  }

  private renderAuthPanel() {
    const agent = this.selectedAgent;
    const conn = this.conn(agent);
    const method = conn?.authMethod;
    const hasTerminalCmd = !!method?.command;
    const label = method?.label || method?.name || 'Log in';
    const desc = method?.description || `${this.agentLabel(agent)} requires authentication before starting a session.`;
    return html`
      <div class="auth-panel">
        <p class="auth-desc">${desc}</p>
        ${hasTerminalCmd ? html`
          <button class="primary-btn" @click=${() => this.openAgentLogin(agent)}>
            ${label}
          </button>
          <p class="connect-hint">A terminal window will open. Complete the login, then click below.</p>
        ` : html`
          <p class="connect-hint">Run the login command in your terminal, then click below.</p>
        `}
        <button class="primary-btn" @click=${() => this.retryAfterAuth(agent)}>
          Done — start session
        </button>
      </div>
    `;
  }

  // Gateway-vs-key toggle for the selected agent. Hidden for agents that don't
  // expose a keyEnvVar (Copilot uses GitHub login; Goose/OpenCode/Mistral/Kiro
  // use their own local config; custom agents run verbatim with author-supplied
  // env). Persisted server-side under config.agentAuth so the choice is stable
  // across sessions and browsers.
  private renderAuthModeField() {
    const opt = this.agentOptions.find((a) => a.id === this.selectedAgent);
    if (!opt || !opt.keyEnvVar) return nothing;
    const mode = opt.authMode ?? 'gateway';
    const editing = this.keyDraft?.agentId === opt.id;
    return html`
      <div class="field auth-mode-field">
        <label>Auth <span class="af-hint">— how ${opt.label} authenticates</span></label>
        <div class="agent-picker">
          <button
            class="agent-chip ${mode === 'gateway' && !editing ? 'sel' : ''}"
            ?disabled=${this.authBusy}
            @click=${() => this.chooseGatewayAuth(opt.id)}
            ${tooltip('Launch through the kairos gateway — no API key needed')}
          >kairos gateway</button>
          <button
            class="agent-chip ${mode === 'key' || editing ? 'sel' : ''}"
            ?disabled=${this.authBusy}
            @click=${() => this.chooseKeyAuth(opt.id)}
            ${tooltip(`Run the agent bare with your own ${opt.keyEnvVar}`)}
          >API key${opt.hasKey ? html` <span class="chip-tag chip-tag-ok">stored</span>` : nothing}</button>
        </div>
        ${mode === 'key' && opt.hasKey && !editing ? html`
          <div class="auth-key-status">
            <code>${opt.keyEnvVar}</code> stored — key hidden.
            <button class="chip-edit chip-edit-inline" @click=${() => this.openKeyEditor(opt.id)} ${tooltip('Replace the stored key')}>Edit</button>
            <button class="chip-edit chip-edit-inline" @click=${() => this.chooseGatewayAuth(opt.id)} ${tooltip('Delete the stored key and use the gateway')}>Clear</button>
          </div>
        ` : nothing}
        ${editing ? html`
          <div class="auth-key-editor">
            <input
              class="path-input"
              type="password"
              autocomplete="off"
              placeholder="${opt.keyEnvVar}"
              .value=${this.keyDraft!.value}
              @input=${(e: Event) => { this.keyDraft = { ...this.keyDraft!, value: (e.target as HTMLInputElement).value }; }}
              @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.saveApiKey(); if (e.key === 'Escape') this.cancelKeyEditor(); }}
            />
            <button class="af-save" ?disabled=${this.authBusy} @click=${this.saveApiKey}>
              ${this.authBusy ? 'Saving…' : 'Save key'}
            </button>
            <button class="af-cancel" ?disabled=${this.authBusy} @click=${this.cancelKeyEditor}>Cancel</button>
          </div>
        ` : nothing}
        ${this.authError ? html`<div class="banner-error">${this.authError}</div>` : nothing}
      </div>
    `;
  }

  // Agent-agnostic role/persona chips. Independent of the selected agent — the
  // same role applies to any engine. Seeded roles are available out of the box,
  // and users can add/edit/delete roles in Customize -> Roles. "None" deselects.
  // A one-line instructions preview rides in the chip tooltip.
  private renderRolePicker() {
    if (this.roles.length === 0) return nothing;
    return html`
      <div class="field">
        <label>Role <span class="af-hint">(persona applied to any agent)</span></label>
        <div class="agent-picker">
          <button
            class="agent-chip ${this.selectedRole === '' ? 'sel' : ''}"
            @click=${() => { this.selectedRole = ''; }}
            ${tooltip('No persona — the agent behaves normally')}
          >None</button>
          ${this.roles.map((r) => html`
            <button
              class="agent-chip ${r.id === this.selectedRole ? 'sel' : ''}"
              @click=${() => { this.selectedRole = r.id; }}
              ${tooltip(r.instructions)}
            >${r.label}</button>
          `)}
        </div>
      </div>
    `;
  }

  private renderAgentForm() {
    const f = this.customForm!;
    const d = f.draft;
    return html`
      <div class="agent-form">
        <div class="agent-form-title">${f.mode === 'create' ? 'Add a custom agent' : `Edit ${d.label || f.original}`}</div>
        ${f.mode === 'create' ? html`
          <div class="af-row">
            <label>ID</label>
            <input class="path-input" placeholder="my-agent" .value=${d.id}
              @input=${(e: Event) => this.patchDraft({ id: (e.target as HTMLInputElement).value })} />
          </div>` : nothing}
        <div class="af-row">
          <label>Display name</label>
          <input class="path-input" placeholder="My Agent" .value=${d.label}
            @input=${(e: Event) => this.patchDraft({ label: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="af-row">
          <label>Command <span class="af-hint">(optional, defaults to kairos)</span></label>
          <input class="path-input" placeholder="kairos" .value=${d.command}
            @input=${(e: Event) => this.patchDraft({ command: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="af-row">
          <label>Arguments <span class="af-hint">(space-separated)</span></label>
          <input class="path-input" placeholder="launch -- npx -y @scope/my-agent-acp" .value=${d.args}
            @input=${(e: Event) => this.patchDraft({ args: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="af-row">
          <label>Environment <span class="af-hint">(KEY=VALUE per line, optional)</span></label>
          <textarea class="path-input af-env" rows="2" placeholder="MY_API_KEY=sk-..." .value=${d.env}
            @input=${(e: Event) => this.patchDraft({ env: (e.target as HTMLTextAreaElement).value })}></textarea>
        </div>
        <label class="af-check">
          <input type="checkbox" .checked=${d.managedApp}
            @change=${(e: Event) => this.patchDraft({ managedApp: (e.target as HTMLInputElement).checked })} />
          Requires <code>kairos apps install</code> first
        </label>
        ${this.customFormError ? html`<div class="banner-error">${this.customFormError}</div>` : nothing}
        <div class="af-actions">
          <button class="af-cancel" @click=${this.closeAgentForm} ?disabled=${this.customFormBusy}>Cancel</button>
          <button class="af-save" @click=${this.submitAgentForm} ?disabled=${this.customFormBusy}>
            ${this.customFormBusy ? 'Saving…' : f.mode === 'create' ? 'Add agent' : 'Save changes'}
          </button>
        </div>
      </div>
    `;
  }

  private renderSession(s: AgentSession) {
    // While a resumed session replays its history, show the frames as they fold
    // in rather than a frozen spinner — a long replay is otherwise indistinguishable
    // from a wedged one. Fall back to the centered pane only until the first frame
    // arrives; the composer stays gated (connState/loading) until load completes.
    if (s.loading && s.items.length === 0) {
      return html`
        <div class="wrap">
          ${this.renderSessionBar(s)}
          <div class="timeline">
            <div class="loading-pane">
              <span class="pip"></span>
              <div>Loading conversation history…</div>
            </div>
          </div>
        </div>
      `;
    }
    return html`
      <div class="wrap" @markdown-local-link=${(e: CustomEvent<MarkdownLocalLinkDetail>) => this.handleMarkdownLocalLink(s, e)}>
        ${this.renderSessionBar(s)}
        ${s.error ? html`<div class="banner-error">${s.error}</div>` : nothing}
        ${s.stalled ? html`
          <div class="banner-stalled">
            <span>No response for a while — the agent may be stuck.</span>
            <span class="banner-actions">
              <button class="primary" @click=${() => this.interruptAndContinue(s)}>Interrupt &amp; continue</button>
              <button class="ghost" @click=${() => this.forceRestartAgent(s)} ${tooltip('Kill the agent process and reload the session')}>Force restart</button>
            </span>
          </div>
        ` : nothing}
        <div class="split">
          <div class="chat-col">
            <div class="session-body">
              ${this.findOpen ? this.renderFindBar() : nothing}
              ${this.renderTimelineStack()}
              ${this.scrolledUp && s.items.length > 0 ? html`
                <button class="jump-latest" @click=${this.jumpToLatest} ${tooltip('Scroll to the newest message')}>
                  ${icon.chevronDown(14)} <span>Jump to latest</span>
                </button>
              ` : nothing}
            </div>
            ${this.renderSearchMatches(s)}
            ${this.renderComposer(s)}
          </div>
          <aside class="side-panel ${this.panelOpen ? 'open' : ''}" style="width:${this.panelOpen ? this.panelWidth : 0}px">
            <div
              class="panel-resize-handle"
              @pointerdown=${this.startPanelResize}
              @dblclick=${this.resetPanelWidth}
            ></div>
            ${this.reviewOpen ? html`
              <agents-review
                .session=${s}
                @close=${this.closePanel}
              ></agents-review>
            ` : nothing}
            ${this.summaryOpen ? html`
              <agents-summary
                .session=${s}
                .summaryPending=${this.pendingSummary === s.id}
                @request-summary=${() => this.handleSummary(s)}
                @close=${this.closePanel}
              ></agents-summary>
            ` : nothing}
            ${this.planOpen ? html`
              <agents-plan
                .session=${s}
                @close=${this.closePanel}
              ></agents-plan>
            ` : nothing}
            ${this.promptsOpen ? html`
              <agents-prompts
                .session=${s}
                @jump-to-item=${(e: CustomEvent<{ id: string }>) => this.jumpToItem(s, e.detail.id)}
                @close=${this.closePanel}
              ></agents-prompts>
            ` : nothing}
            ${this.treeOpen ? html`
              <agents-file-tree
                .session=${s}
                .selectedPathRequest=${this.linkedFileRequest}
                @close=${this.closePanel}
              ></agents-file-tree>
            ` : nothing}
            ${this.sourceOpen ? html`
              <agents-source-control
                .session=${s}
                .refreshToken=${this.sourceRefreshToken}
                @source-status=${(e: CustomEvent) => this.handleSourceStatus(e.detail)}
                @open-file=${(e: CustomEvent<{ path: string }>) => this.openSourceFile(s, e.detail.path)}
                @close=${this.closePanel}
              ></agents-source-control>
            ` : nothing}
            ${this.terminalSessionId === s.id ? keyed(s.id, html`
              <agents-terminal
                ?hidden=${!this.terminalOpen}
                .sessionId=${s.id}
                .cwd=${this.sessionWorkdir(s)}
                @close=${this.closePanel}
              ></agents-terminal>
            `) : nothing}
            ${this.framesOpen ? html`
              <agents-frames
                .session=${s}
                .frames=${this.frameLog}
                @close=${this.closePanel}
              ></agents-frames>
            ` : nothing}
          </aside>
          ${this.renderPanelRail(s)}
        </div>
      </div>
    `;
  }

  // Layout-toolbar toggle for the whole right region: if any panel is open,
  // close it; otherwise reopen the one the user last had open (defaulting to
  // Files). Keeps the rail's per-panel buttons as the way to switch between them.
  private toggleRightPanel = () => {
    if (this.panelOpen) {
      this.applyPanelState(this.activeId, { panel: this.lastPanel, open: false });
    } else {
      this.togglePanel(this.lastPanel);
    }
  };

  // Open one side-panel and close the others; clicking the active one collapses.
  // The panels are mutually exclusive since they share the one column.
  private togglePanel(which: PanelId) {
    const open = which === 'files' ? !this.treeOpen
      : which === 'source' ? !this.sourceOpen
      : which === 'review' ? !this.reviewOpen
      : which === 'summary' ? !this.summaryOpen
      : which === 'plan' ? !this.planOpen
      : which === 'prompts' ? !this.promptsOpen
      : which === 'terminal' ? !this.terminalOpen
      : !this.framesOpen;
    this.applyPanelState(this.activeId, { panel: which, open });
    if (which === 'source' && open) this.refreshSourceStatus(this.current, true);
    // Generate the summary lazily the first time the panel is opened, so a turn
    // is spent only when the user actually looks — not on every session. It
    // stays manual (Regenerate) after that. Skipped if the agent is busy/down,
    // a request is already in flight, or there's nothing to summarize.
    if (which === 'summary' && open) this.maybeAutoGenerateSummary();
  }

  private closePanel = () => {
    this.applyPanelState(this.activeId, { panel: this.lastPanel, open: false });
  };

  private openPanel(which: PanelId) {
    this.applyPanelState(this.activeId, { panel: which, open: true });
    if (which === 'source') this.refreshSourceStatus(this.current, true);
    if (which === 'summary') this.maybeAutoGenerateSummary();
  }

  private saveActivePanelState() {
    if (!this.activeId) return;
    this.sessionPanelStates.set(this.activeId, { panel: this.lastPanel, open: this.panelOpen });
  }

  private restorePanelState(sessionId: string | null) {
    const state = sessionId
      ? this.sessionPanelStates.get(sessionId) ?? DEFAULT_SESSION_PANEL_STATE
      : DEFAULT_SESSION_PANEL_STATE;
    this.applyPanelState(sessionId, state);
  }

  private applyPanelState(sessionId: string | null, state: SessionPanelState) {
    this.lastPanel = state.panel;
    this.treeOpen = state.open && state.panel === 'files';
    this.sourceOpen = state.open && state.panel === 'source';
    this.reviewOpen = state.open && state.panel === 'review';
    this.summaryOpen = state.open && state.panel === 'summary';
    this.planOpen = state.open && state.panel === 'plan';
    this.promptsOpen = state.open && state.panel === 'prompts';
    this.terminalOpen = state.open && state.panel === 'terminal';
    this.framesOpen = state.open && state.panel === 'frames';

    if (sessionId) {
      this.sessionPanelStates.set(sessionId, { ...state });
    }
    if (sessionId && state.panel === 'terminal' && state.open) {
      this.terminalSessionId = sessionId;
      this.initializedTerminalIds.add(sessionId);
    } else if (sessionId && this.terminalSessionId === sessionId && this.initializedTerminalIds.has(sessionId)) {
      // Keep the current session's terminal mounted when hidden by another
      // panel/collapse, but do not remount hidden terminals after session
      // switches; hidden attaches cannot fit and may resize the PTY to 80 cols.
    } else if (!sessionId || this.terminalSessionId !== sessionId) {
      this.terminalSessionId = null;
    }
  }

  private refreshActiveSourceStatus() {
    this.refreshSourceStatus(this.current);
  }

  private async refreshSourceStatus(s: AgentSession | null | undefined, force = false) {
    if (!s) return;
    const cwd = this.sessionWorkdir(s);
    if (force && this.sourceOpen && s.id === this.activeId) {
      // The mounted Git panel owns the detailed fetch and emits source-status
      // back up for the rail badge, avoiding duplicate git status processes.
      this.sourceRefreshToken++;
      return;
    }
    const existing = this.sourceStatusSummaries.get(s.id);
    if (!force && existing?.cwd === cwd) return;
    if (!force && this.sourceStatusInflight.get(s.id) === cwd) return;

    this.sourceStatusInflight.set(s.id, cwd);
    const next = new Map(this.sourceStatusSummaries);
    next.set(s.id, { cwd, isRepo: existing?.isRepo ?? false, changes: existing?.changes ?? 0, branch: existing?.branch ?? '', loading: true });
    this.sourceStatusSummaries = next;
    try {
      if (force) {
        const status = await getGitStatus(cwd);
        if (!this.session(s.id) || this.sessionWorkdir(s) !== cwd) return;
        const updated = new Map(this.sourceStatusSummaries);
        updated.set(s.id, {
          cwd,
          isRepo: status.isRepo,
          changes: status.changes.length,
          branch: status.branch ?? status.currentBranch ?? '',
          loading: false,
        });
        this.sourceStatusSummaries = updated;
        return;
      }
      const status = await detectRepo(cwd);
      if (!this.session(s.id) || this.sessionWorkdir(s) !== cwd) return;
      const updated = new Map(this.sourceStatusSummaries);
      updated.set(s.id, {
        cwd,
        isRepo: status.isRepo,
        changes: existing?.changes ?? 0,
        branch: status.currentBranch ?? '',
        loading: false,
      });
      this.sourceStatusSummaries = updated;
    } catch (err: any) {
      if (!this.session(s.id) || this.sessionWorkdir(s) !== cwd) return;
      const updated = new Map(this.sourceStatusSummaries);
      updated.set(s.id, {
        cwd,
        isRepo: false,
        changes: 0,
        branch: '',
        loading: false,
        error: err?.message ?? 'Failed to load git status',
      });
      this.sourceStatusSummaries = updated;
    } finally {
      if (this.sourceStatusInflight.get(s.id) === cwd) this.sourceStatusInflight.delete(s.id);
    }
  }

  private handleSourceStatus(detail: { sessionId: string; cwd: string; isRepo: boolean; changes: number; branch?: string }) {
    const next = new Map(this.sourceStatusSummaries);
    next.set(detail.sessionId, {
      cwd: detail.cwd,
      isRepo: detail.isRepo,
      changes: detail.changes,
      branch: detail.branch ?? '',
      loading: false,
    });
    this.sourceStatusSummaries = next;
  }

  private openSourceFile(s: AgentSession, relPath: string) {
    if (this.activeId !== s.id) this.switchTo(s.id);
    this.linkedFileRequest = { path: relPath, nonce: ++this.linkedFileRequestNonce };
    this.openPanel('files');
  }

  private maybeAutoGenerateSummary() {
    const s = this.current;
    if (!s || s.summary || this.pendingSummary) return;
    if (s.phase !== 'ready' || this.connState(s.agentId) !== 'up') return;
    if (countSessionChangedFiles(s.items, s.itemsVersion) === 0) return;
    this.handleSummary(s);
  }

  // Vertical rail on the far right holding the Files/Source/Prompts/Plan/Review/
  // Summary toggles, plus a separated Frames toggle for the raw-protocol
  // inspector. Each button expands the side-panel to its left (or collapses it
  // if active).
  private renderPanelRail(s: AgentSession) {
    const changedFiles = countSessionChangedFiles(s.items, s.itemsVersion);
    const planDone = s.plan.filter((e) => e.status === 'completed').length;
    const promptCount = this.promptMessages(s).length;
    const sourceSummary = this.sourceStatusSummaries.get(s.id);
    const sourceAvailable = this.sourceOpen || sourceSummary?.loading || sourceSummary?.isRepo;
    return html`
      <nav class="panel-rail" aria-label="Session panels">
        <button
          class="rail-btn ${this.treeOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('files')}
          aria-pressed=${this.treeOpen}
          ${tooltip({ content: 'Browse and preview files in this session’s working directory', prefer: 'left' })}
          aria-label="Browse files"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 4.5A1 1 0 0 1 3 3.5h3.1a1 1 0 0 1 .7.3l.9.9a1 1 0 0 0 .7.3H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/>
          </svg>
          <span class="rail-label">Files</span>
        </button>
        ${sourceAvailable ? html`
          <button
            class="rail-btn ${this.sourceOpen ? 'on' : ''}"
            @click=${() => this.togglePanel('source')}
            aria-pressed=${this.sourceOpen}
            ${tooltip({ content: 'Inspect git changes in this session’s working directory', prefer: 'left' })}
            aria-label="Git changes"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="4" cy="4" r="1.5"/>
              <circle cx="12" cy="4" r="1.5"/>
              <circle cx="8" cy="12" r="1.5"/>
              <path d="M4 5.5v1A5.5 5.5 0 0 0 8 12M12 5.5v1A5.5 5.5 0 0 1 8 12"/>
            </svg>
            <span class="rail-label">Git</span>
            ${sourceSummary?.changes ? html`<span class="review-count">${sourceSummary.changes}</span>` : sourceSummary?.loading ? html`<span class="rail-dot"></span>` : nothing}
          </button>
        ` : nothing}
        <button
          class="rail-btn ${this.promptsOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('prompts')}
          aria-pressed=${this.promptsOpen}
          ${tooltip({ content: 'Jump back to any prompt you sent this session', prefer: 'left' })}
          aria-label="Prompts"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 3.5A1 1 0 0 1 3.5 2.5h9a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H6l-3 2.5V11H3.5a1 1 0 0 1-1-1Z"/>
            <path d="M5 5.5h6M5 8h4"/>
          </svg>
          <span class="rail-label">Prompts</span>
          ${promptCount ? html`<span class="review-count">${promptCount}</span>` : nothing}
        </button>
        <button
          class="rail-btn ${this.planOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('plan')}
          aria-pressed=${this.planOpen}
          ${tooltip({ content: 'See the agent’s task plan and progress', prefer: 'left' })}
          aria-label="Plan"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 4h1.2l.9 1L7 3M3 8h1.2l.9 1L7 7M3 12h1.2l.9 1L7 11"/>
            <path d="M9.5 4.5h4M9.5 8.5h4M9.5 12.5h4"/>
          </svg>
          <span class="rail-label">Plan</span>
          ${s.plan.length > 0
            ? html`<span class="review-count">${planDone}/${s.plan.length}</span>`
            : s.planDoc ? html`<span class="rail-dot"></span>` : nothing}
        </button>
        <button
          class="rail-btn ${this.reviewOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('review')}
          aria-pressed=${this.reviewOpen}
          ${tooltip({ content: 'Review everything this agent changed this session', prefer: 'left' })}
          aria-label="Review changes"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H10"/>
            <rect x="6" y="1.5" width="4" height="2.5" rx="0.6"/>
            <path d="M5.8 8 7 9.2 10 6.2"/>
          </svg>
          <span class="rail-label">Review</span>
          ${changedFiles ? html`<span class="review-count">${changedFiles}</span>` : nothing}
        </button>
        <button
          class="rail-btn ${this.summaryOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('summary')}
          aria-pressed=${this.summaryOpen}
          ${tooltip({ content: 'Read an agent-authored summary of what changed and why', prefer: 'left' })}
          aria-label="Summary"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 3.2A1 1 0 0 1 3.5 2.5H7a1.5 1.5 0 0 1 1 2.6V13a1.2 1.2 0 0 0-.8-.3H3.5a1 1 0 0 1-1-1Z"/>
            <path d="M13.5 3.2a1 1 0 0 0-1-.7H9a1.5 1.5 0 0 0-1 2.6V13a1.2 1.2 0 0 1 .8-.3h3.7a1 1 0 0 0 1-1Z"/>
          </svg>
          <span class="rail-label">Summary</span>
          ${s.summary ? html`<span class="rail-dot"></span>` : nothing}
        </button>
        <button
          class="rail-btn ${this.terminalOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('terminal')}
          aria-pressed=${this.terminalOpen}
          ${tooltip({ content: 'Open an interactive shell in this session’s working directory', prefer: 'left' })}
          aria-label="Terminal"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 3.5h11v9h-11z"/>
            <path d="m4.5 6 2 2-2 2M8.5 10.5h3"/>
          </svg>
          <span class="rail-label">Terminal</span>
        </button>
        <div class="rail-sep" role="separator"></div>
        <button
          class="rail-btn frames ${this.framesOpen ? 'on' : ''}"
          @click=${() => this.togglePanel('frames')}
          aria-pressed=${this.framesOpen}
          ${tooltip({ content: 'Inspect the raw ACP protocol frames streaming from this agent', prefer: 'left' })}
          aria-label="Live protocol frames"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 4 3 8l3 4M10 4l3 4-3 4"/>
          </svg>
          <span class="rail-label">Frames</span>
        </button>
      </nav>
    `;
  }

  private get panelOpen(): boolean {
    return this.reviewOpen || this.treeOpen || this.sourceOpen || this.summaryOpen || this.planOpen || this.promptsOpen || this.terminalOpen || this.framesOpen;
  }

  private terminateRemovedSessionTerminals(previous?: AgentSession[]) {
    if (!previous?.length) return;
    const activeIds = new Set(this.sessions.map((s) => s.id));
    for (const session of previous) {
      if (activeIds.has(session.id)) continue;
      this.sessionPanelStates.delete(session.id);
      this.sourceStatusInflight.delete(session.id);
      if (this.sourceStatusSummaries.has(session.id)) {
        const next = new Map(this.sourceStatusSummaries);
        next.delete(session.id);
        this.sourceStatusSummaries = next;
      }
      if (!this.initializedTerminalIds.has(session.id)) continue;
      this.initializedTerminalIds.delete(session.id);
      if (this.terminalSessionId === session.id) this.terminalSessionId = null;
      void fetchWithAuth(`/terminal/session/${encodeURIComponent(session.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  private handleMarkdownLocalLink(s: AgentSession, e: CustomEvent<MarkdownLocalLinkDetail>) {
    const relPath = workspacePathFromHref(e.detail.href || e.detail.text, this.sessionWorkdir(s), s.cwd);
    if (!relPath) return;
    e.stopPropagation();
    void this.openLinkedFile(s, relPath);
  }

  private async openLinkedFile(s: AgentSession, relPath: string) {
    const target = await this.resolveLinkedFilePath(s, relPath);
    if (!target || this.activeId !== s.id) return;
    this.linkedFileRequest = { path: target, nonce: ++this.linkedFileRequestNonce };
    this.openPanel('files');
  }

  private async resolveLinkedFilePath(s: AgentSession, relPath: string): Promise<string | null> {
    if (relPath.includes('/')) return relPath;
    const workdir = this.sessionWorkdir(s);
    let files = this.mentionFiles.get(workdir);
    if (!files) {
      try {
        const res = await listAllWorkspaceFiles(workdir);
        files = res.files;
        this.mentionFiles.set(workdir, files);
        if (res.truncated) this.mentionTruncated.add(workdir);
      } catch {
        return relPath;
      }
    }
    const matches = files.filter((f) => f === relPath || f.endsWith(`/${relPath}`));
    if (!matches.length) return relPath;
    return matches.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  // Jump the timeline to a specific item (from the Prompts panel). The timeline
  // mounts only the last TIMELINE_WINDOW items, so grow the window first if the
  // target is older, then scroll to it after the render that mounts it.
  private jumpToItem(s: AgentSession, id: string) {
    const idx = s.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const needed = s.items.length - idx;
    const cur = this.timelineWindow.get(s.id) ?? TIMELINE_WINDOW;
    if (needed > cur) {
      const next = new Map(this.timelineWindow);
      next.set(s.id, Math.min(needed, s.items.length));
      this.timelineWindow = next;
    }
    this.updateComplete.then(() => requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector(`.timeline.active [data-item-id="${id}"]`) as HTMLElement | null;
      if (!el) return;
      this.stickToBottom = false;
      this.scrolledUp = true;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }));
  }

  // Find in conversation ──────────────────────────────────────────────────────
  // Cmd/Ctrl+F. Search runs over the full in-memory timeline (not the mounted
  // window), so counts and navigation cover history that isn't rendered yet.
  // Assistant messages render as parsed markdown, so we count against the DOM
  // text of the cached markdown node — the same node that gets highlighted —
  // keeping the model's counts aligned with what the CSS highlight paints.
  private assistantPlainText = (id: string, markdown: string): string => {
    const key = `${this.activeId ?? ''}:${id}`;
    return renderMarkdownCached(key, markdown).textContent ?? '';
  };

  private openFind() {
    this.findOpen = true;
    this.recomputeFind();
    // Focus + select the input so a second Cmd+F (or reopening) replaces the query.
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.find-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  private closeFind() {
    this.findOpen = false;
    this.findQuery = '';
    this.findMatches = [];
    this.findIndex = 0;
    clearHighlights();
    // Return focus to the composer so typing resumes where the user expects.
    this.updateComplete.then(() => {
      const ta = this.shadowRoot?.querySelector('.composer-input') as HTMLTextAreaElement | null;
      ta?.focus();
    });
  }

  private onFindInput(e: Event) {
    this.findQuery = (e.target as HTMLInputElement).value;
    this.recomputeFind();
  }

  private recomputeFind() {
    const s = this.current;
    if (!s) { this.findMatches = []; this.findIndex = 0; this.findItemsVersionRef = -1; this.scheduleFindHighlight(); return; }
    this.findItemsVersionRef = s.itemsVersion;
    this.findMatches = collectMatches(s.items, this.findQuery, this.assistantPlainText);
    const total = totalMatches(this.findMatches);
    this.findIndex = total === 0 ? 0 : Math.min(this.findIndex, total - 1);
    this.revealCurrentMatch();
  }

  // Advance the current occurrence by ±1, wrapping around the ends.
  private stepFind(delta: number) {
    const total = totalMatches(this.findMatches);
    if (total === 0) return;
    this.findIndex = (this.findIndex + delta + total) % total;
    this.revealCurrentMatch();
  }

  // Grow the window so the item holding the current occurrence is mounted, then
  // scroll to it and repaint the highlight (mirrors jumpToItem's window logic).
  private revealCurrentMatch() {
    const s = this.current;
    const loc = locateMatch(this.findMatches, this.findIndex);
    if (!s || !loc) { this.scheduleFindHighlight(); return; }
    const idx = s.items.findIndex((i) => i.id === loc.id);
    if (idx >= 0) {
      const needed = s.items.length - idx;
      const cur = this.timelineWindow.get(s.id) ?? TIMELINE_WINDOW;
      if (needed > cur) {
        const next = new Map(this.timelineWindow);
        next.set(s.id, Math.min(needed, s.items.length));
        this.timelineWindow = next;
      }
    }
    this.stickToBottom = false;
    this.scheduleFindHighlight(true);
  }

  // Repaint highlights after the pending render mounts any newly-windowed items.
  // Coalesced to one rAF so rapid typing/stepping doesn't queue redundant walks.
  // `scroll` latches into findPendingScroll so a navigation's jump intent isn't
  // lost when a plain repaint (from the findIndex re-render) reschedules the frame.
  private scheduleFindHighlight(scroll = false) {
    if (scroll) this.findPendingScroll = true;
    if (this.findApplyFrame) cancelAnimationFrame(this.findApplyFrame);
    this.findApplyFrame = requestAnimationFrame(() => {
      this.findApplyFrame = 0;
      void this.updateComplete.then(() => {
        const wantScroll = this.findPendingScroll;
        this.findPendingScroll = false;
        const root = this.shadowRoot?.querySelector('.timeline.active');
        if (!this.findOpen || !root || !this.findQuery) { clearHighlights(); return; }
        const loc = locateMatch(this.findMatches, this.findIndex);
        const range = applyHighlights(root, this.findQuery, this.findMatches.map((m) => m.id), loc);
        if (wantScroll && range) {
          const anchor = range.startContainer.parentElement as HTMLElement | null;
          anchor?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
    });
  }

  // Drag the side-panel's left edge to resize; width persists on release, and a
  // double-click resets it. Pointer capture keeps events flowing past the thin
  // handle. Dragging left (negative dx) widens the panel, so the delta negates.
  private panelResizeStartX = 0;
  private panelResizeStartW = 0;

  private startPanelResize = (e: PointerEvent) => {
    e.preventDefault();
    this.panelResizing = true;
    this.panelResizeStartX = e.clientX;
    this.panelResizeStartW = this.panelWidth;
    this.setAttribute('data-panel-resizing', '');
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', this.onPanelResizeMove);
    window.addEventListener('pointerup', this.onPanelResizeEnd);
  };

  private onPanelResizeMove = (e: PointerEvent) => {
    if (!this.panelResizing) return;
    const raw = this.panelResizeStartW - (e.clientX - this.panelResizeStartX);
    // Cap at the split width minus a chat minimum so the chat never vanishes.
    const split = (this.renderRoot as ShadowRoot)?.querySelector('.split') as HTMLElement | null;
    const max = split ? Math.max(PANEL_WIDTH_MIN, split.clientWidth - PANEL_CHAT_MIN) : PANEL_WIDTH_MAX;
    this.panelWidth = Math.min(max, clampPanelWidth(raw));
    this.scheduleComposerResize(true);
  };

  private onPanelResizeEnd = () => {
    if (!this.panelResizing) return;
    this.endPanelResize();
    savePanelWidth(this.panelWidth);
  };

  private endPanelResize() {
    this.panelResizing = false;
    this.removeAttribute('data-panel-resizing');
    window.removeEventListener('pointermove', this.onPanelResizeMove);
    window.removeEventListener('pointerup', this.onPanelResizeEnd);
  }

  private resetPanelWidth = () => {
    this.panelWidth = PANEL_WIDTH_DEFAULT;
    savePanelWidth(this.panelWidth);
  };

  private renderSessionBar(s: AgentSession) {
    const canCompact = s.phase === 'ready' && this.connState(s.agentId) === 'up';
    const canPrompt = this.connState(s.agentId) === 'up' && s.phase !== 'error';
    return html`
      <div class="session-bar">
        ${hasAgentLogo(s.agentId) ? html`<agent-logo class="session-logo" .agent=${s.agentId} .size=${16}></agent-logo>` : nothing}
        <span class="session-name">${s.agentName || this.agentLabel(s.agentId)}</span>
        <span class="session-cwd" ${tooltip(s.cwd)}>${s.cwd}</span>
        ${s.worktree ? html`<span class="session-branch" ${tooltip(`Isolated worktree: ${s.worktree.worktreePath}`)}>⎇ ${s.worktree.branch}</span>` : nothing}
        <span class="session-spacer"></span>
        <div class="usage-group">
          ${renderUsage(s.usage, s.items, s.convo.cacheSignals())}
          <button
            class="icon-btn compact-btn"
            ?disabled=${!canCompact}
            @click=${this.handleCompact}
            ${tooltip(canCompact
              ? 'Summarize the conversation to free up context'
              : 'Compact is available when the agent is idle')}
            aria-label="Compact conversation"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 5.5 5 8.5 2 11.5M14 5.5 11 8.5 14 11.5M8 2v12"/>
            </svg>
            <span class="btn-label">Compact</span>
          </button>
        </div>
        <div class="session-actions">
          <div class="auto-accept-wrap">
          <button
            class="icon-btn auto-accept-btn ${s.autoAccept ? 'on' : ''}"
            @click=${this.toggleAutoAccept}
            ${tooltip(s.autoAccept
              ? 'Auto-accept is on — permission prompts resolve automatically. Click to turn off. Best left on only for work you can safely let the agent run unattended.'
              : 'Turn on to auto-accept tool permission prompts for this session. Enable case by case — for tasks where you’re fine letting the agent act without review.')}
            aria-label=${s.autoAccept ? 'Auto-accept on' : 'Auto-accept off'}
            aria-pressed=${s.autoAccept}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 1.5 2.5 3.8v3.4c0 3.2 2.3 5.6 5.5 6.8 3.2-1.2 5.5-3.6 5.5-6.8V3.8L8 1.5Z"/>
              <path d="M5.8 7.8 7.3 9.3 10.4 6"/>
            </svg>
            <span class="btn-label">Auto-accept</span>
          </button>
          ${this.showAutoAcceptHint ? html`
            <div class="auto-accept-hint" role="status">
              <div class="aah-body">
                <strong>Tired of clicking Allow?</strong>
                <span>Turn on Auto-accept and let the agent cook — permission prompts resolve automatically.</span>
              </div>
              <div class="aah-actions">
                <button class="aah-enable" @click=${this.enableAutoAcceptFromHint}>Turn on</button>
                <button class="aah-dismiss" @click=${this.dismissAutoAcceptHint} ${tooltip('Dismiss')} aria-label="Dismiss">${icon.close(14)}</button>
              </div>
            </div>` : nothing}
          </div>
          <copy-button
            class="copy-all-btn"
            label="Copy all"
            title="Copy the whole conversation as Markdown"
            .getText=${() => serializeTimeline(s.items, {
              agentName: s.agentName || this.agentLabel(s.agentId),
              sessionName: s.title,
              cwd: s.cwd,
              terminalOutputFor: (tid) => s.terminalOutputs.get(tid),
            })}
          ></copy-button>
          <button
            class="icon-btn danger"
            @click=${() => this.closeSession(s.id)}
            ${tooltip('End session')}
            aria-label="End session"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 2.5V8M5 4.2a5 5 0 1 0 6 0"/>
            </svg>
            <span class="btn-label">End</span>
          </button>
        </div>
      </div>
    `;
  }

  // Every session's timeline wrapper stays mounted and keyed by id; only the
  // active one is visible. The expensive timeline contents are separately guarded
  // so a sidebar switch mostly toggles the wrapper class instead of rebuilding
  // rich message/tool DOM for both the old and new sessions.
  private renderTimelineStack() {
    return html`${repeat(
      this.sessions,
      (s) => s.id,
      (s) => {
        const active = s.id === this.activeId;
        return this.renderTimeline(s, active);
      },
    )}`;
  }

  private renderTimeline(s: AgentSession, visible: boolean) {
    const cls = visible ? 'timeline active' : 'timeline hidden';
    return html`
      <div
        class=${cls}
        @scroll=${this.onTimelineScroll}
        @wheel=${this.onTimelineScrollIntent}
        @touchstart=${this.onTimelineScrollIntent}
        @pointerdown=${this.onTimelineScrollIntent}
      >
        ${guard(this.timelineDeps(s, visible), () => this.renderTimelineContents(s))}
      </div>
    `;
  }

  private timelineDeps(s: AgentSession, active: boolean): unknown[] {
    const deps = [s.itemsVersion, s.plan, s.phase, s.backgroundActive, s.permission, s.elicitation, s.terminalOutputs, this.timelineWindow.get(s.id), this.tipIndex];
    if (active) {
      this.timelineDepsCache.set(s, deps);
      return deps;
    }
    const cached = this.timelineDepsCache.get(s);
    if (cached) return cached;
    this.timelineDepsCache.set(s, deps);
    return deps;
  }

  private renderTimelineContents(s: AgentSession) {
    if (s.items.length === 0) {
      return html`
        <div class="empty-session">
          <div class="lead">${this.greeting()}</div>
          <div class="sub">What are we building today?</div>
          <div class="suggest">
            ${['Explain this codebase', 'Find and fix a bug', 'Write tests for a file', 'Refactor a function'].map(
              (sg) => html`<button @click=${() => this.useSuggestion(s, sg)}>${sg}</button>`,
            )}
          </div>
          <div class="tip">
            <button class="tip-nav" @click=${() => this.stepTip(-1)} ${tooltip('Previous tip')} aria-label="Previous tip">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 4L6 8l4 4"/>
              </svg>
            </button>
            <span class="tip-text">
              <span class="tip-label">Did you know?</span>
              <span class="tip-body">${this.currentTip()}</span>
            </span>
            <button class="tip-nav" @click=${() => this.stepTip(1)} ${tooltip('Next tip')} aria-label="Next tip">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 4l4 4-4 4"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }
    const showThinking = s.phase === 'thinking' && !this.lastItemIsActiveTool(s);
    const orphanPerm = this.orphanPermission(s);
    const showWaiting = !!(s.permission || s.elicitation);
    // Bottom-anchored window: mount only the last `cap` items. Newest stay in
    // the DOM (stick-to-bottom stays correct); older ones page in on demand.
    const cap = this.timelineWindow.get(s.id) ?? TIMELINE_WINDOW;
    const hidden = Math.max(0, s.items.length - cap);
    const shown = hidden > 0 ? s.items.slice(hidden) : s.items;
    return html`
      ${hidden > 0 ? html`<button class="show-earlier" @click=${() => this.showEarlier(s.id)}>Show earlier messages (${hidden} hidden)</button>` : nothing}
      ${repeat(shown, (item) => item.id, (item) => this.renderItem(s, item))}
      ${orphanPerm ? html`<div class="tool-wrap"><agents-tool-call
        .tool=${orphanPerm.toolCall}
        .permission=${{ requestId: orphanPerm.requestId, options: orphanPerm.options }}
        .autofocusPermission=${true}
        @permission-choice=${this.handlePermissionChoice}
      ></agents-tool-call></div>` : nothing}
      ${s.elicitation ? html`<agents-elicitation
        .request=${s.elicitation}
        @elicitation-response=${this.handleElicitationResponse}
      ></agents-elicitation>` : nothing}
      ${showWaiting ? html`
        <div class="thinking-row">
          <status-indicator .state=${'waiting'} label="Waiting for your answer…"></status-indicator>
        </div>
      ` : nothing}
      ${showThinking && !s.elicitation && !showWaiting ? html`
        <div class="thinking-row">
          <status-indicator .state=${'working'} label="Working…"></status-indicator>
        </div>
      ` : nothing}
      ${s.phase === 'ready' && s.backgroundActive > 0 && !showWaiting ? html`
        <div class="thinking-row">
          <status-indicator .state=${'working'} label=${backgroundStatusLabel(s.backgroundActive)}></status-indicator>
        </div>
      ` : nothing}
    `;
  }

  // If the permission request's toolCallId hasn't shown up in the timeline yet,
  // render a standalone card so the prompt is still visible and actionable.
  private orphanPermission(s: AgentSession) {
    const p = s.permission;
    if (!p) return null;
    const has = s.items.some((i) => i.kind === 'tool' && i.tool.toolCallId === p.toolCall.toolCallId);
    return has ? null : p;
  }

  private lastItemIsActiveTool(s: AgentSession): boolean {
    const last = s.items[s.items.length - 1];
    return last?.kind === 'tool' && last.tool.status === 'in_progress';
  }

  private useSuggestion(s: AgentSession, text: string) {
    s.draft = text;
    this.touch();
    this.focusAndResizeComposer(true);
  }

  // Page the bottom-anchored timeline window backward by a fixed step.
  private showEarlier(id: string) {
    const s = this.session(id);
    if (!s) return;
    const cur = this.timelineWindow.get(id) ?? TIMELINE_WINDOW;
    const next = new Map(this.timelineWindow);
    next.set(id, Math.min(cur + TIMELINE_WINDOW_STEP, s.items.length));
    this.timelineWindow = next;
  }

  // Delegates to the shared timeline renderer so the live view and the
  // Behind the Scenes showcase render through identical code.
  private renderItem(s: AgentSession, item: AgentSession['items'][number]) {
    return renderItem(item, {
      agentId: s.agentId,
      agentName: s.agentName || this.agentLabel(s.agentId),
      cacheScope: s.id,
      permissionFor: (id) =>
        s.permission && s.permission.toolCall.toolCallId === id
          ? { requestId: s.permission.requestId, options: s.permission.options }
          : undefined,
      terminalOutputFor: (tid) => s.terminalOutputs.get(tid),
      onPermissionChoice: this.handlePermissionChoice,
      autofocusPermission: true,
      collapseReplayDiffsFor: (id) => s.replayedToolIds.has(id),
      messageActions: (msg) => this.renderPromptHoverActions(s, msg),
      liveMarkdownFor: (msg) => s.phase === 'thinking' && s.items[s.items.length - 1]?.id === msg.id,
      onSpeak: this.speechOutputSupported ? (msg) => this.toggleSpeak(msg) : undefined,
      speakingItemId: this.speakingItemId,
    });
  }

  private renderPromptHoverActions(s: AgentSession, msg: Extract<AgentSession['items'][number], { kind: 'message' }>) {
    if (msg.role !== 'user') return nothing;
    const index = this.promptInfo(s).indexById.get(msg.id) ?? -1;
    if (index < 0) return nothing;
    const busy = !!this.resumePromptDialog || !!this.resumeAnywhereBusy || this.busy || s.loading || s.phase !== 'ready' || s.backgroundActive > 0;
    return html`
      <button
        class="msg-action"
        ?disabled=${busy}
        @click=${() => this.handleResumeFromPrompt(s, { index, mode: 'overwrite' })}
        ${tooltip('Edit prompt and start again from here')}
        aria-label="Edit prompt and start again from here"
      >${icon.pencil(15)}</button>
      <button
        class="msg-action"
        ?disabled=${busy}
        @click=${() => this.handleResumeFromPrompt(s, { index, mode: 'fork' })}
        ${tooltip('Fork from this prompt')}
        aria-label="Fork from this prompt"
      >${icon.gitFork(15)}</button>
    `;
  }

  // Render one mode/model/effort control. Boolean toggles and single-choice
  // options (e.g. a mode list with just "default") are hidden to keep the
  // composer uncluttered; every visible select renders as a compact dropdown.
  private renderConfigOption(o: SessionConfigOption) {
    if (o.type !== 'select' || !o.options) return nothing;
    const leaves = this.configLeaves(o);
    if (leaves.length <= 1) return nothing;
    return this.renderConfigPopover(o, leaves);
  }

  private renderConfigPopover(o: SessionConfigOption, leaves: SessionConfigSelectOption[]) {
    const open = this.configMenuId === o.id;
    const current = leaves.find((l) => l.value === o.currentValue);
    const isGroup = (v: SessionConfigSelectOption | SessionConfigSelectGroup): v is SessionConfigSelectGroup =>
      'group' in v;
    return html`
      <div class="config-ctl">
        <button
          class="config-trigger ${open ? 'open' : ''}"
          aria-haspopup="listbox"
          aria-expanded=${open}
          ${tooltip(o.name)}
          @click=${() => this.toggleConfigMenu(o)}
          @keydown=${(e: KeyboardEvent) => this.onConfigTriggerKeydown(o, e)}
        >
          <span class="config-trigger-label">${current?.name ?? o.name}</span>
          <svg class="caret" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${open ? this.renderConfigMenu(o, leaves, isGroup) : nothing}
      </div>
    `;
  }

  private renderConfigMenu(
    o: SessionConfigOption,
    leaves: SessionConfigSelectOption[],
    isGroup: (v: SessionConfigSelectOption | SessionConfigSelectGroup) => v is SessionConfigSelectGroup,
  ) {
    // Walk groups in display order while tracking each leaf's flat index, so the
    // keyboard highlight (configMenuIndex) lines up across group boundaries.
    let flat = -1;
    const item = (leaf: SessionConfigSelectOption) => {
      flat++;
      const i = flat;
      const sel = leaf.value === o.currentValue;
      return html`<button
        class="config-item ${i === this.configMenuIndex ? 'active' : ''}"
        role="option"
        aria-selected=${sel}
        @mousedown=${(e: Event) => { e.preventDefault(); this.handleConfigChange(o.id, leaf.value); }}
        @mouseenter=${() => { this.configMenuIndex = i; }}
      >
        <span class="config-check">${sel ? '✓' : ''}</span>
        <span class="config-item-body">
          <span class="config-item-name">${this.configLeafName(o, leaf)}</span>
          ${leaf.description ? html`<span class="config-item-desc">${leaf.description}</span>` : nothing}
        </span>
      </button>`;
    };
    return html`
      <div class="config-menu" role="listbox" aria-label=${o.name}>
        ${o.options!.map((v) =>
          isGroup(v)
            ? html`<div class="config-group-label">${v.name}</div>${v.options.map(item)}`
            : item(v),
        )}
      </div>
    `;
  }

  // The popover trigger owns focus while open, so its keydown drives the menu:
  // arrows move the highlight, Enter/Space commit, Escape closes.
  private onConfigTriggerKeydown(o: SessionConfigOption, e: KeyboardEvent) {
    if (this.configMenuId !== o.id) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleConfigMenu(o); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.moveConfigMenu(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.moveConfigMenu(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.configMenuId = null; }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const pick = this.configLeaves(o)[this.configMenuIndex];
      if (pick) this.handleConfigChange(o.id, pick.value);
    }
  }

  // Resume chips for the sessions the agent cited in a "Search with <agent>"
  // answer. Clicking a chip opens that session inline (same path as History's
  // Resume). Only ever populated on search sessions (see updateSearchMatches).
  private renderSearchMatches(s: AgentSession) {
    const matches = s.searchMatches;
    if (!matches || matches.length === 0) return nothing;
    return html`
      <div class="search-matches">
        <span class="search-matches-label">${icon.arrowRight(13)} Resume:</span>
        ${matches.map((m) => {
          const label = m.title || m.firstMessage || m.id.slice(0, 8);
          const dir = (m.dir || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || m.dir;
          return html`
            <button
              class="search-match"
              ${tooltip(`Resume in ${dir || m.dir} · ${m.id.slice(0, 8)}`)}
              @click=${() => this.resumeAgentSession(m)}
            >
              ${hasAgentLogo(m.tool) ? html`<agent-logo .agent=${m.tool} .size=${13}></agent-logo>` : nothing}
              <span class="search-match-title">${label}</span>
            </button>
          `;
        })}
      </div>
    `;
  }

  // Floating find bar, top-right of the chat column. Match count and prev/next
  // mirror the browser/VS Code find affordance.
  private renderFindBar() {
    const total = totalMatches(this.findMatches);
    const has = total > 0;
    const count = has ? `${this.findIndex + 1}/${total}` : this.findQuery ? 'No results' : '';
    return html`
      <div class="find-bar" @keydown=${(e: KeyboardEvent) => e.stopPropagation()}>
        <input
          class="find-input"
          type="text"
          placeholder="Find in conversation"
          .value=${this.findQuery}
          @input=${this.onFindInput}
          @keydown=${this.onFindInputKeydown}
        />
        <span class="find-count ${this.findQuery && !has ? 'empty' : ''}">${count}</span>
        <button class="find-btn" ?disabled=${!has} @click=${() => this.stepFind(-1)} ${tooltip('Previous match (⇧⏎)')} aria-label="Previous match">
          ${icon.chevronUp(15)}
        </button>
        <button class="find-btn" ?disabled=${!has} @click=${() => this.stepFind(1)} ${tooltip('Next match (⏎)')} aria-label="Next match">
          ${icon.chevronDown(15)}
        </button>
        <button class="find-btn" @click=${() => this.closeFind()} ${tooltip('Close (Esc)')} aria-label="Close find">
          ${icon.close(15)}
        </button>
      </div>
    `;
  }

  private onFindInputKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.closeFind();
    } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF' && !e.altKey && !e.shiftKey) {
      // The bar stops keydown propagation, so a repeat Cmd/Ctrl+F never reaches
      // the global handler — swallow the browser default here and re-select.
      e.preventDefault();
      (e.target as HTMLInputElement).select();
    }
  };

  private renderComposer(s: AgentSession) {
    const thinking = s.phase === 'thinking';
    // History is still replaying (inline resume) — the timeline is visible but the
    // session isn't ready to take a prompt yet, so keep the composer gated.
    const disabled = this.connState(s.agentId) !== 'up' || s.phase === 'error' || s.loading || s.authRetrying;
    const canSend = !disabled && (!!s.draft.trim() || s.attachments.length > 0);
    const accept = this.attachAccept(s);
    return html`
      <div class="composer">
        ${this.slashOpen || this.slashButtonOpen ? this.renderSlashMenu(s) : nothing}
        ${this.mentionOpen ? this.renderMentionMenu(s) : nothing}
        ${s.queued.length > 0 ? this.renderQueued(s) : nothing}
        <div
          class="composer-box ${thinking ? 'busy' : ''}"
          @paste=${(e: ClipboardEvent) => this.handlePaste(s, e)}
          @dragover=${(e: DragEvent) => { if (accept) { e.preventDefault(); } }}
          @drop=${(e: DragEvent) => this.handleDrop(s, e)}
        >
          ${s.attachError ? html`<div class="banner-error attach-error">
            <span>${s.attachError}</span>
            <button class="attach-error-x" @click=${() => this.dismissAttachError(s)} ${tooltip('Dismiss')}>${icon.close(13)}</button>
          </div>` : nothing}
          ${s.attachments.length > 0 ? this.renderAttachments(s) : nothing}
          <textarea
            class="composer-input"
            placeholder=${s.authRetrying ? 'Signing in and retrying…' : thinking ? 'Steer or queue a follow-up…' : `Message ${s.agentName || this.agentLabel(s.agentId)}…`}
            ?disabled=${disabled}
            .value=${s.draft}
            @input=${this.handleInput}
            @keydown=${this.handleKeydown}
          ></textarea>
          <textarea
            class="composer-sizer"
            aria-hidden="true"
            tabindex="-1"
            readonly
            .value=${s.draft}
          ></textarea>
          <div class="composer-footer">
            <div class="composer-tools">
              ${s.configOptions.map((o) => this.renderConfigOption(o))}
            </div>
            <div class="composer-actions">
            ${s.commands.length > 0 || this.hasPrompts ? html`
              <button
                class="icon-btn slash ${this.slashOpen || this.slashButtonOpen ? 'active' : ''}"
                ?disabled=${disabled}
                @click=${(e: Event) => { e.stopPropagation(); this.toggleSlashMenu(s); }}
                ${tooltip('Slash commands & prompts')}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 2.5 6 13.5"/>
                </svg>
              </button>
            ` : nothing}
            ${this.speechSupported ? html`
              <button
                class="icon-btn mic ${this.listening ? 'listening' : ''}"
                ?disabled=${disabled}
                @click=${() => this.toggleDictation()}
                ${tooltip(this.listening ? 'Stop dictation' : this.dictationTooltip())}
                aria-label=${this.listening ? 'Stop dictation' : 'Dictate a message'}
                aria-pressed=${this.listening ? 'true' : 'false'}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="6" y="1.5" width="4" height="8" rx="2"/>
                  <path d="M3.5 7a4.5 4.5 0 0 0 9 0"/>
                  <path d="M8 11.5V14M6 14h4"/>
                </svg>
              </button>
            ` : nothing}
            ${accept ? html`
              <button class="icon-btn attach" ?disabled=${disabled} @click=${() => this.openFilePicker(accept)} ${tooltip('Attach file')}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9.5 4.5 5 9a2 2 0 0 0 2.8 2.8l4.7-4.7a3.5 3.5 0 0 0-5-5L3 6.6a5 5 0 0 0 7 7l3.5-3.5"/>
                </svg>
              </button>
              <input class="file-input" type="file" multiple accept=${accept} @change=${(e: Event) => this.handleFileInput(s, e)} />
            ` : nothing}
            ${thinking
              ? html`<button class="icon-btn stop" @click=${this.handleStop} ${tooltip('Stop')}><span class="stop-sq"></span></button>`
              : nothing}
            <button class="icon-btn send" ?disabled=${!canSend} @click=${this.handleSend} ${tooltip(thinking ? 'Queue message' : 'Send')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderQueued(s: AgentSession) {
    return html`
      <div class="queued">
        ${s.queued.map((q, i) => {
          const label = q.text || this.attachmentSummary(q.attachments);
          return html`
            <div class="queued-chip" ${tooltip(label)}>
              <span class="queued-icon">${icon.arrowUp(13)}</span>
              <span class="queued-text">${label}</span>
              <button class="queued-x" @click=${() => this.removeQueued(s, i)} ${tooltip('Remove from queue')}>${icon.close(13)}</button>
            </div>
          `;
        })}
      </div>
    `;
  }

  private attachmentSummary(blocks: ContentBlock[]): string {
    if (blocks.length === 0) return '(empty)';
    return blocks.map((b) => this.attachmentLabel(b)).join(', ');
  }

  private renderAttachments(s: AgentSession) {
    return html`
      <div class="attachments">
        ${s.attachments.map((b, i) => html`
          <div class="attach-chip" ${tooltip(this.attachmentLabel(b))}>
            ${b.type === 'image'
              ? html`<img class="attach-thumb" src=${`data:${(b as ImageContent).mimeType};base64,${(b as ImageContent).data}`} alt="" />`
              : html`<span class="attach-icon">${b.type === 'resource' ? '📄' : '@'}</span>`}
            <span class="attach-name">${this.attachmentLabel(b)}</span>
            <button class="attach-x" @click=${() => this.removeAttachment(s, i)} ${tooltip('Remove attachment')}>${icon.close(13)}</button>
          </div>
        `)}
      </div>
    `;
  }

  private attachmentLabel(b: ContentBlock): string {
    if (b.type === 'image') return 'image';
    if (b.type === 'audio') return 'audio';
    if (b.type === 'resource_link') return (b as ResourceLinkContent).name ?? (b as ResourceLinkContent).uri;
    if (b.type === 'resource') {
      const uri = (b as EmbeddedResourceContent).resource?.uri;
      if (!uri) return 'resource';
      return uri.replace(/^file:\/*/, '').split('/').pop() || uri;
    }
    return b.type;
  }

  private renderMentionMenu(s: AgentSession) {
    const q = this.mentionQuery(s);
    if (q === null) return nothing;
    const matches = this.mentionItems(s);
    const workdir = this.sessionWorkdir(s);
    if (matches.length === 0) {
      // No file matched — offer to attach whatever was typed as a verbatim path.
      const loading = this.mentionFetching.has(workdir) && !this.mentionFiles.has(workdir);
      return html`
        <div class="slash-menu" role="listbox">
          <button
            class="slash-item active"
            role="option"
            aria-selected="true"
            @mousedown=${(e: Event) => { e.preventDefault(); this.chooseMention(s); }}
          >
            <span class="slash-name">@${q}</span>
            <span class="slash-desc">${loading ? 'Searching files…' : 'Attach as file reference'}</span>
          </button>
        </div>
      `;
    }
    return html`
      <div class="slash-menu" role="listbox">
        ${matches.map((rel, i) => {
          const name = rel.split('/').pop() || rel;
          const dir = rel.slice(0, rel.length - name.length).replace(/\/$/, '');
          return html`
            <button
              class="slash-item ${i === this.mentionIndex ? 'active' : ''}"
              role="option"
              aria-selected=${i === this.mentionIndex}
              @mousedown=${(e: Event) => { e.preventDefault(); this.chooseMention(s, rel); }}
              @mouseenter=${() => { this.mentionIndex = i; }}
            >
              <span class="slash-name">${name}</span>
              ${dir ? html`<span class="slash-desc">${dir}</span>` : nothing}
            </button>
          `;
        })}
        ${this.mentionTruncated.has(workdir)
          ? html`<div class="slash-item" style="opacity:.6;cursor:default"><span class="slash-desc">More files not shown — refine your search</span></div>`
          : nothing}
      </div>
    `;
  }

  private renderSlashMenu(s: AgentSession) {
    const matches = this.slashItems(s);
    if (matches.length === 0) return nothing;
    return html`
      <div class="slash-menu" role="listbox">
        ${matches.map((item, i) => {
          const name = item.kind === 'rewind' ? 'rewind' : item.kind === 'command' ? item.command.name : item.prompt.name;
          const desc = item.kind === 'rewind' ? 'Rewind files & conversation to an earlier prompt' : item.kind === 'command' ? item.command.description : item.prompt.description;
          const badge = item.kind === 'rewind' ? 'kairos' : item.kind === 'prompt' ? 'prompt' : '';
          return html`
            <button
              class="slash-item ${i === this.slashIndex ? 'active' : ''}"
              role="option"
              aria-selected=${i === this.slashIndex}
              @mousedown=${(e: Event) => { e.preventDefault(); this.chooseSlashItem(s, item); }}
              @mousemove=${() => { this.slashIndex = i; }}
            >
              <span class="slash-name">/${name}${badge ? html`<span class="slash-badge">${badge}</span>` : nothing}</span>
              ${desc ? html`<span class="slash-desc">${desc}</span>` : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }

  private handleInput(e: Event) {
    const s = this.current;
    if (!s) return;
    const ta = e.target as HTMLTextAreaElement;
    const previousDraft = s.draft;
    s.draft = ta.value;
    this.promptHistoryNavigation.delete(s.id);
    this.scheduleComposerResize(ta.value.length < previousDraft.length, ta);
    this.syncSlashMenu(s);
    this.syncMentionMenu(s);
    this.touch();
  }

  // ── File mentions (@path) ──────────────────────────────────────────────────
  // When the agent accepts embedded context and the draft ends in an `@token`,
  // offer a fuzzy-filtered list of workspace files to attach as resource_links.
  // The token is matched at a word boundary so it works mid-message, not just at
  // the start.
  private mentionQuery(s: AgentSession): string | null {
    if (!this.conn(s.agentId)?.capabilities.promptCapabilities?.embeddedContext) return null;
    const m = /(?:^|\s)@(\S+)$/.exec(s.draft);
    return m ? m[1] : null;
  }

  private syncMentionMenu(s: AgentSession) {
    const active = this.mentionQuery(s) !== null;
    if (active) this.loadMentionFiles(s);
    this.mentionOpen = active;
    if (this.mentionIndex >= this.mentionItems(s).length) this.mentionIndex = 0;
  }

  // Fetch the flat file list for this session's workdir once, on first open.
  private async loadMentionFiles(s: AgentSession) {
    const workdir = this.sessionWorkdir(s);
    if (this.mentionFetching.has(workdir)) return;
    this.mentionFetching.add(workdir);
    try {
      const { files, truncated } = await listAllWorkspaceFiles(workdir);
      this.mentionFiles.set(workdir, files);
      if (truncated) this.mentionTruncated.add(workdir);
      this.touch();
    } catch {
      // Non-fatal: the menu falls back to attaching whatever the user typed.
      this.mentionFetching.delete(workdir);
    }
  }

  // Substring-filter the cached file list by the @token, matching against the
  // full relative path (so `@src/age` narrows by directory too). Capped to keep
  // the menu short; sorted so shallower/shorter paths surface first.
  // Cache the last mention filter+sort. renderMentionMenu, syncMentionMenu and
  // moveMention each call this on the same keystroke, and it filters+sorts the
  // whole workspace file list — recompute only when the query or file list
  // actually changes.
  private mentionItemsCache: { query: string; files: string[]; value: string[] } | null = null;

  private mentionItems(s: AgentSession): string[] {
    const q = this.mentionQuery(s);
    if (q === null) return [];
    const files = this.mentionFiles.get(this.sessionWorkdir(s));
    if (!files) return [];
    const cache = this.mentionItemsCache;
    if (cache && cache.query === q && cache.files === files) return cache.value;
    const lower = q.toLowerCase();
    const value = files
      .filter((f) => f.toLowerCase().includes(lower))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .slice(0, 10);
    this.mentionItemsCache = { query: q, files, value };
    return value;
  }

  private moveMention(delta: number) {
    const s = this.current;
    if (!s) return;
    const count = this.mentionItems(s).length;
    if (count === 0) return;
    this.mentionIndex = (this.mentionIndex + delta + count) % count;
  }

  // Strip the trailing `@token` from the draft and attach a resource_link. Prefers
  // the picked relative path; falls back to the verbatim token when nothing
  // matched (so a hand-typed absolute path or file:// URI still works).
  private chooseMention(s: AgentSession, picked?: string) {
    const q = this.mentionQuery(s);
    if (q === null) return;
    s.draft = s.draft.replace(/(?:^|\s)@(\S+)$/, (full) => (full[0] === '@' ? '' : full[0]));
    const rel = picked ?? q;
    const workdir = this.sessionWorkdir(s).replace(/\/$/, '');
    const uri = rel.startsWith('file://') || rel.startsWith('/') ? rel : `${workdir}/${rel}`;
    s.attachments = [...s.attachments, { type: 'resource_link', uri, name: rel }];
    this.mentionOpen = false;
    this.mentionIndex = 0;
    this.touch();
    this.focusAndResizeComposer(true);
  }

  // ── Slash-command menu ───────────────────────────────────────────────────────
  // The menu opens only when the whole draft is a bare `/query` (no spaces yet),
  // so it never fights with normal prose that happens to contain a slash.
  private slashQuery(draft: string): string | null {
    const m = /^\/(\S*)$/.exec(draft);
    return m ? m[1] : null;
  }

  // Whether any saved prompts exist — drives showing the `/` button even for an
  // agent that offers no slash commands of its own.
  private get hasPrompts(): boolean {
    return this.prompts.length > 0;
  }

  // The `/` menu blends saved prompt snippets, Kairos-native controls, and
  // agent commands into one keyboard-navigable list. User-defined prompts stay
  // at the top so the user's own shortcuts win the first-select position.
  private slashItems(s: AgentSession): SlashMenuItem[] {
    const q = this.slashQuery(s.draft);
    const listing = q === null;
    if (listing && !this.slashButtonOpen) return [];
    return buildSlashMenuItems({
      commands: s.commands,
      prompts: this.prompts,
      query: q ?? '',
      listing,
      hasRewindPrompts: this.promptMessages(s).length > 0,
    });
  }

  // Recompute open/highlight after the draft changes. Open only when a query is
  // active and at least one item matches; clamp the highlight into range. On the
  // leading edge of a `/query` (menu just became active) refresh prompts so edits
  // from the Customize tab appear without remounting.
  private syncSlashMenu(s: AgentSession) {
    const q = this.slashQuery(s.draft);
    const active = q !== null;
    if (!active) {
      this.slashOpen = false;
      this.slashIndex = 0;
      this.lastSlashQuery = null;
      return;
    }
    const opening = !this.slashOpen;
    if (opening || q !== this.lastSlashQuery) this.slashIndex = 0;
    if (opening) this.loadPrompts(true);
    this.lastSlashQuery = q;
    const matches = this.slashItems(s);
    this.slashOpen = matches.length > 0;
    if (this.slashIndex >= matches.length) this.slashIndex = 0;
  }

  private chooseSlashItem(s: AgentSession, item: SlashMenuItem) {
    if (item.kind === 'rewind') { this.afterSlashChoose(); this.clearComposer(s); this.openRewindPicker(s); }
    else if (item.kind === 'command') this.chooseCommand(s, item.command);
    else this.choosePrompt(s, item.prompt);
  }

  // Fill the command into the composer, leaving `/name ` so the user can type
  // args (commands are run by sending the message, as before).
  private chooseCommand(s: AgentSession, cmd: AvailableCommand) {
    s.draft = `/${cmd.name} `;
    this.afterSlashChoose();
  }

  // Replace the `/query` trigger with the prompt's body so the user can edit it
  // before sending. The body fully replaces the draft — prompts are whole-message
  // templates, not prefixes.
  private choosePrompt(s: AgentSession, prompt: PromptInput) {
    s.draft = prompt.body;
    this.afterSlashChoose();
  }

  private afterSlashChoose() {
    this.slashOpen = false;
    this.slashButtonOpen = false;
    this.slashIndex = 0;
    this.lastSlashQuery = null;
    document.removeEventListener('click', this.closeSlashMenu);
    this.touch();
    this.focusAndResizeComposer(true);
  }

  // Toggle the slash menu from the footer button. Decoupled from the draft so
  // clicking doesn't insert a stray `/`; an rAF-deferred document listener
  // closes it on the next outside click (mirrors `toggleConfigMenu`).
  private toggleSlashMenu(_s: AgentSession) {
    document.removeEventListener('click', this.closeSlashMenu);
    if (this.slashButtonOpen) { this.slashButtonOpen = false; return; }
    this.slashButtonOpen = true;
    this.slashOpen = false;
    this.configMenuId = null;
    this.slashIndex = 0;
    this.lastSlashQuery = null;
    // Pick up any prompt edits made in the Customize tab since the last open.
    this.loadPrompts(true);
    requestAnimationFrame(() => {
      document.addEventListener('click', this.closeSlashMenu, { once: true });
    });
  }

  private closeSlashMenu = () => {
    this.slashButtonOpen = false;
    this.slashIndex = 0;
    this.lastSlashQuery = null;
    this.touch();
  };

  private moveSlash(delta: number) {
    const s = this.current;
    if (!s) return;
    const count = this.slashItems(s).length;
    if (count === 0) return;
    this.slashIndex = (this.slashIndex + delta + count) % count;
  }

  private activeComposerTextarea(): HTMLTextAreaElement | null {
    return this.shadowRoot?.querySelector<HTMLTextAreaElement>('.composer-input') ?? null;
  }

  private focusAndResizeComposer(allowShrink = false) {
    requestAnimationFrame(() => {
      const ta = this.activeComposerTextarea();
      if (!ta) return;
      const s = this.current;
      if (s && ta.value !== s.draft) ta.value = s.draft;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      this.scheduleComposerResize(allowShrink, ta);
    });
  }

  private scheduleComposerResize(allowShrink = false, target?: HTMLTextAreaElement) {
    this.composerResizeAllowShrink = this.composerResizeAllowShrink || allowShrink;
    if (target) this.composerResizeTarget = target;
    if (this.composerResizeFrame) return;
    this.composerResizeFrame = requestAnimationFrame(() => {
      this.composerResizeFrame = 0;
      const active = this.activeComposerTextarea();
      const ta = this.composerResizeTarget?.isConnected && this.composerResizeTarget === active
        ? this.composerResizeTarget
        : active;
      const allowShrink = this.composerResizeAllowShrink;
      this.composerResizeTarget = null;
      this.composerResizeAllowShrink = false;
      if (ta) this.autoGrow(ta, allowShrink);
    });
  }

  private measureComposerScrollHeight(ta: HTMLTextAreaElement): number {
    const sizer = this.shadowRoot?.querySelector<HTMLTextAreaElement>('.composer-sizer');
    if (!sizer) return ta.scrollHeight;
    const width = ta.getBoundingClientRect().width;
    if (width > 0) sizer.style.width = `${width}px`;
    if (sizer.value !== ta.value) sizer.value = ta.value;
    return sizer.scrollHeight;
  }

  private autoGrow(ta: HTMLTextAreaElement, allowShrink = false) {
    const scrollHeight = this.measureComposerScrollHeight(ta);
    const nextHeight = Math.min(scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT);
    const currentHeight = ta.getBoundingClientRect().height;
    const shouldResize = !ta.style.height
      || nextHeight > currentHeight + COMPOSER_TEXTAREA_RESIZE_EPSILON
      || (allowShrink && nextHeight < currentHeight - COMPOSER_TEXTAREA_RESIZE_EPSILON);
    if (shouldResize) {
      const next = `${nextHeight}px`;
      if (ta.style.height !== next) ta.style.height = next;
    }
    ta.style.overflowY = scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }
}
