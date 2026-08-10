// JSON-RPC 2.0 base types
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

// ACP Session types
export interface SessionNewParams {
  command?: string;
  args?: string[];
  working_directory?: string;
  model?: string;
  provider?: string;
  stream_json?: boolean;
}

export interface SessionNewResult {
  session_id: string;
}

export interface InitializeParams {
  client_info: { name: string; version: string };
  capabilities: { streaming?: boolean; permissions?: boolean };
}

export interface InitializeResult {
  capabilities: { streaming?: boolean; permissions?: boolean };
}

// Agent update types (server → client streaming)
export type UpdateType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'status' | 'error' | 'cost';

export interface SessionUpdate {
  session_id: string;
  update: UpdatePayload;
}

export type UpdatePayload =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; is_error?: boolean }
  | { type: 'status'; status: AgentStatus }
  | { type: 'error'; message: string }
  | { type: 'cost'; input_tokens: number; output_tokens: number; total_cost_usd: number };

export type AgentStatus = 'spawning' | 'ready' | 'working' | 'waiting' | 'idle' | 'terminated' | 'error';

// Permission types
export interface PermissionRequest {
  id: string;
  session_id: string;
  tool: string;
  description: string;
  context?: Record<string, unknown>;
}

export interface PermissionResponse {
  id: string;
  session_id: string;
  decision: 'allow' | 'deny' | 'allow_always';
}

// ACP method constants
export const Methods = {
  INITIALIZE: 'initialize',
  SESSION_NEW: 'session/new',
  SESSION_PROMPT: 'session/prompt',
  SESSION_UPDATE: 'session/update',
  SESSION_CANCEL: 'session/cancel',
  PERMISSION_REQUEST: 'permission/request',
  PERMISSION_RESPONSE: 'permission/response',
} as const;
