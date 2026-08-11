// ─── JSON-RPC 2.0 base types ─────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ─── ACP (Agent Client Protocol) — the real UI ↔ server contract ─────────────
//
// These types mirror `packages/ui/src/services/acp.ts` +
// `packages/ui/src/services/acp-types.ts`, which are the authoritative wire
// contract the shipped UI speaks. All field names are camelCase to match the
// wire. See docs/transport-integration-spec.md §1 for the full method map.

// ── Content blocks (multi-modal message parts) ───────────────────────────────
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

// ── Tool calls ───────────────────────────────────────────────────────────────
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolCallLocation {
  path: string;
  line?: number;
}
export interface ToolCall {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  content?: unknown[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  children?: ToolCall[];
}

// ── Session config options (unified mode/model/effort list) ──────────────────
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

export interface SessionModes {
  currentModeId: string;
  availableModes: Array<{ id: string; name: string; description?: string }>;
}

// ── initialize ───────────────────────────────────────────────────────────────
export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}
export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: PromptCapabilities;
  [k: string]: unknown;
}
export interface ClientCapabilities {
  fs?: { readTextFile?: boolean; writeTextFile?: boolean };
  terminal?: boolean;
  elicitation?: { form?: Record<string, unknown> };
  [k: string]: unknown;
}
export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
  _meta?: { 'terminal-auth'?: { command: string; args: string[]; label?: string } };
}
export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: { name: string; title?: string; version?: string };
}
export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: AgentCapabilities;
  agentInfo?: { name?: string; title?: string; version?: string };
  authMethods?: AuthMethod[];
}

// ── authenticate ─────────────────────────────────────────────────────────────
export interface AuthenticateParams {
  methodId: string;
}

// ── session/new ──────────────────────────────────────────────────────────────
export interface McpServer {
  name?: string;
  command?: string;
  args?: string[];
  [k: string]: unknown;
}
export interface SessionNewParams {
  cwd: string;
  mcpServers: McpServer[];
}
export interface SessionNewResult {
  sessionId: string;
  modes?: SessionModes;
  configOptions?: SessionConfigOption[];
}

// ── session/load ─────────────────────────────────────────────────────────────
export interface SessionLoadParams {
  sessionId: string;
  cwd: string;
  mcpServers: McpServer[];
}
export type SessionLoadResult = {
  modes?: SessionModes;
  configOptions?: SessionConfigOption[];
} | null;

// ── session/prompt ───────────────────────────────────────────────────────────
export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}
export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
}
export interface SessionPromptResult {
  stopReason: string;
  usage?: TurnUsage;
}

// ── session/set_config_option ────────────────────────────────────────────────
export interface SessionSetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string;
}
export interface SessionSetConfigOptionResult {
  configOptions?: SessionConfigOption[];
}

// ── session/cancel (notification) ────────────────────────────────────────────
export interface SessionCancelParams {
  sessionId: string;
}

// ── session/update (server → client notification) ────────────────────────────
export interface PlanEntry {
  content: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'pending' | 'in_progress' | 'completed';
}
export type SessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: ContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content: ContentBlock }
  | { sessionUpdate: 'user_message_chunk'; content: ContentBlock }
  | ({ sessionUpdate: 'tool_call' } & ToolCall)
  | ({ sessionUpdate: 'tool_call_update' } & Partial<ToolCall> & { toolCallId: string })
  | { sessionUpdate: 'plan'; entries: PlanEntry[] }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: 'config_option_update'; configOptions: SessionConfigOption[] }
  | { sessionUpdate: string; [k: string]: unknown };
export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

// ── session/request_permission (server → client request) ─────────────────────
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}
export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCall;
  options: PermissionOption[];
}
export interface RequestPermissionResult {
  outcome: unknown;
}

// ── elicitation/create (server → client request) ─────────────────────────────
export interface ElicitationSchema {
  type?: 'object';
  title?: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}
export interface ElicitationCreateParams {
  sessionId: string;
  message: string;
  requestedSchema: ElicitationSchema;
  toolCallId?: string;
}
export type ElicitationResponse =
  | { action: 'accept'; content: Record<string, string | number | boolean | string[]> }
  | { action: 'decline' }
  | { action: 'cancel' };

// ── Kairos extension notifications (server → client) ─────────────────────────
// Namespaced under `_ext/` so vanilla ACP clients ignore them.
export interface ExtLogParams {
  stream: string;
  text: string;
}
export interface ExtStalledParams {
  sessionId: string;
  secondsIdle: number;
}
export interface ExtTerminalOutputParams {
  sessionId: string;
  terminalId: string;
  output: string;
}

// ── ACP method constants ─────────────────────────────────────────────────────
export const Methods = {
  // client → server requests
  INITIALIZE: 'initialize',
  AUTHENTICATE: 'authenticate',
  SESSION_NEW: 'session/new',
  SESSION_LOAD: 'session/load',
  SESSION_PROMPT: 'session/prompt',
  SESSION_SET_CONFIG_OPTION: 'session/set_config_option',
  // client → server notification
  SESSION_CANCEL: 'session/cancel',
  // server → client requests
  SESSION_REQUEST_PERMISSION: 'session/request_permission',
  ELICITATION_CREATE: 'elicitation/create',
  // server → client notifications
  SESSION_UPDATE: 'session/update',
  EXT_LOG: '_ext/log',
  EXT_STALLED: '_ext/stalled',
  EXT_TERMINAL_OUTPUT: '_ext/terminal_output',
} as const;

export type MethodName = (typeof Methods)[keyof typeof Methods];
