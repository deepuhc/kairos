// Subset of Agent Client Protocol v1 types used by the Agents UI.
// See https://agentclientprotocol.com for the full specification.

export interface TextContent {
  type: 'text';
  text: string;
}
export interface ImageContent {
  type: 'image';
  mimeType: string;
  data: string;
}
export interface AudioContent {
  type: 'audio';
  mimeType: string;
  data: string;
}
export interface ResourceLinkContent {
  type: 'resource_link';
  uri: string;
  name?: string;
}
export interface EmbeddedResourceContent {
  type: 'resource';
  resource: { uri?: string; text?: string; mimeType?: string };
}
export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLinkContent
  | EmbeddedResourceContent
  | { type: string; [k: string]: unknown };

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface DiffContent {
  type: 'diff';
  path: string;
  oldText?: string | null;
  newText: string;
}
export interface TerminalToolContent {
  type: 'terminal';
  terminalId: string;
}
export interface PlainToolContent {
  type: 'content';
  content: ContentBlock;
}
export type ToolCallContent = DiffContent | TerminalToolContent | PlainToolContent;

export interface ToolCallLocation {
  path: string;
  line?: number;
}
export interface ToolCall {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  // Tool calls a delegated sub-agent made, folded under the Task that spawned
  // them (Claude tags each with `_meta.claudeCode.parentToolUseId`). Present
  // only on a sub-agent Task tool; renders nested inside that card.
  children?: ToolCall[];
}

export interface PlanEntry {
  content: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'pending' | 'in_progress' | 'completed';
}

// ── Session config options ───────────────────────────────────────────────────
// As of ACP adapter 0.40+, mode/model/effort are a single unified list of
// "config options" returned by session/new and session/load, each changed via
// session/set_config_option. The effort option (category 'thought_level') is
// only present when the selected model supports reasoning effort.
export interface SessionConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}
export interface SessionConfigSelectGroup {
  group: string;
  name: string;
  options: SessionConfigSelectOption[];
}
export interface SessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: 'mode' | 'model' | 'thought_level' | string;
  type: 'select' | 'boolean' | string;
  currentValue: string | boolean;
  options?: Array<SessionConfigSelectOption | SessionConfigSelectGroup>;
}

export interface AvailableCommand {
  name: string;
  description?: string;
}

// session/update notification variants we render.
export type SessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: ContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content: ContentBlock }
  | { sessionUpdate: 'user_message_chunk'; content: ContentBlock }
  | ({ sessionUpdate: 'tool_call' } & ToolCall)
  | ({ sessionUpdate: 'tool_call_update' } & Partial<ToolCall> & { toolCallId: string })
  | { sessionUpdate: 'plan'; entries: PlanEntry[] }
  | { sessionUpdate: 'available_commands_update'; availableCommands: AvailableCommand[] }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: 'config_option_update'; configOptions: SessionConfigOption[] }
  | { sessionUpdate: 'usage_update'; used?: number; size?: number; cost?: { amount?: number; currency?: string } }
  | { sessionUpdate: string; [k: string]: unknown };

// Running context-window usage for a session, folded from usage_update events.
// `size` is the model's context window; `used` is the tokens currently in it
// (drops sharply after a compaction). `cost` is the cumulative spend in USD.
//
// `cache` holds cumulative prompt-caching token counters, accumulated across
// turns from the `session/prompt` response's per-turn `usage` object. `hitRate`
// is the derived fraction of billable input served from cache.
export interface CacheUsage {
  cachedRead: number;
  cachedWrite: number;
  input: number;
  output: number;
  hitRate?: number;
}

export interface UsageInfo {
  used: number;
  size: number;
  cost?: number;
  cache?: CacheUsage;
}

// Per-turn usage returned by `session/prompt`. Adapters that do not report
// prompt caching can omit these fields; the client accumulates what is present.
export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

// ── Elicitation (UNSTABLE in the ACP spec) ───────────────────────────────────
// Form-mode only: the agent describes a small JSON-Schema-shaped form and we
// render it. URL mode is intentionally not supported here. Property schemas
// are kept loose because the SDK accepts any primitive type with optional
// enum/oneOf for single-select and array+items for multi-select.
export interface ElicitationStringProperty {
  type: 'string';
  title?: string;
  description?: string;
  enum?: string[];
  oneOf?: Array<{ const: string; title?: string }>;
  format?: string;
}
export interface ElicitationArrayProperty {
  type: 'array';
  title?: string;
  description?: string;
  items?: { type?: 'string'; enum?: string[]; anyOf?: Array<{ const: string; title?: string }> };
}
export interface ElicitationBooleanProperty {
  type: 'boolean';
  title?: string;
  description?: string;
}
export interface ElicitationNumberProperty {
  type: 'number' | 'integer';
  title?: string;
  description?: string;
}
export type ElicitationProperty =
  | ElicitationStringProperty
  | ElicitationArrayProperty
  | ElicitationBooleanProperty
  | ElicitationNumberProperty
  | { type: string; title?: string; description?: string; [k: string]: unknown };

export interface ElicitationSchema {
  type?: 'object';
  title?: string;
  description?: string;
  properties?: Record<string, ElicitationProperty>;
  required?: string[];
}

export type ElicitationContentValue = string | number | boolean | string[];
export type ElicitationResponse =
  | { action: 'accept'; content: Record<string, ElicitationContentValue> }
  | { action: 'decline' }
  | { action: 'cancel' };

// ── Render timeline ────────────────────────────────────────────────────────
export type TimelineItem =
  | { kind: 'message'; id: string; role: 'user' | 'assistant'; text: string; ts: number }
  | { kind: 'thought'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: ToolCall }
  | { kind: 'block'; id: string; role: 'user' | 'assistant'; block: ContentBlock }
  | { kind: 'note'; id: string; text: string };
