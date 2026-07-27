export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface InitializeParams {
  client_info: {
    name: string;
    version: string;
  };
  capabilities?: Record<string, unknown>;
}

export interface InitializeResult {
  server_info: {
    name: string;
    version: string;
  };
  capabilities: AgentCapabilities;
}

export interface AgentCapabilities {
  streaming?: boolean;
  tools?: boolean;
  permissions?: boolean;
  multi_turn?: boolean;
}

export interface SessionNewParams {
  system_prompt?: string;
  working_directory?: string;
  tools?: ToolConfig[];
}

export interface SessionNewResult {
  session_id: string;
}

export interface ToolConfig {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface SessionPromptParams {
  session_id: string;
  messages: Message[];
}

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface SessionUpdate {
  type: "session/update";
  session_id: string;
  update: UpdatePayload;
}

export type UpdatePayload =
  | { type: "thinking"; thinking: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "status"; status: SessionStatus }
  | { type: "cost"; cost_usd: number; duration_ms: number };

export type SessionStatus = "streaming" | "idle" | "waiting_permission" | "complete" | "error";

export interface PermissionRequest {
  id: string;
  session_id: string;
  tool: string;
  description: string;
  input?: Record<string, unknown>;
}

export interface PermissionResponse {
  id: string;
  decision: "allow_once" | "allow_always" | "deny";
}

export interface SessionResult {
  session_id: string;
  messages: Message[];
  cost_usd?: number;
  duration_ms?: number;
}
