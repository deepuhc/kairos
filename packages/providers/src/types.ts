// --- Multi-modal message content ---

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  /** Base64-encoded image data */
  data: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

export interface FileContent {
  type: 'file';
  /** Base64-encoded file data */
  data: string;
  mimeType: string;
  filename?: string;
}

export type ContentPart = TextContent | ImageContent | FileContent;

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

// --- Stream chunk protocol ---

export interface TextChunk {
  type: 'text';
  text: string;
}

export interface ThinkingChunk {
  type: 'thinking';
  text: string;
}

export interface ToolCallChunk {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResultChunk {
  type: 'tool_result';
  id: string;
  content: string;
  isError?: boolean;
}

export interface CitationChunk {
  type: 'citation';
  source: string;
  text: string;
}

export interface UsageChunk {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  totalCostUsd?: number;
}

export interface ErrorChunk {
  type: 'error';
  message: string;
  code?: string;
}

export type StreamChunk =
  | TextChunk
  | ThinkingChunk
  | ToolCallChunk
  | ToolResultChunk
  | CitationChunk
  | UsageChunk
  | ErrorChunk;

// --- Model capabilities ---

export type ModelCapability =
  | 'chat'
  | 'code'
  | 'reasoning'
  | 'tool_calling'
  | 'vision'
  | 'long_context'
  | 'streaming'
  | 'json_mode'
  | 'function_calling';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  isLocal: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  costPerMillionInput?: number;
  costPerMillionOutput?: number;
  capabilities: ModelCapability[];
  supportsVision?: boolean;
  supportsStreaming?: boolean;
}

// --- Completion options ---

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
  /** Force JSON output if model supports it */
  jsonMode?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; totalCostUsd?: number };
  finishReason?: 'stop' | 'length' | 'tool_use' | 'error';
  thinking?: string;
}

// --- Cost estimation ---

export interface CostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

// --- Provider interface ---

export interface Provider {
  readonly name: string;
  readonly isLocal: boolean;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
  /** Legacy string-only stream (backward compat) */
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string>;
  /** Typed stream chunks with thinking, tool calls, citations */
  streamChunks?(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;
  /** Estimate cost for a given message set before sending */
  estimateCost?(messages: Message[], model?: string): CostEstimate;
  /** Check if a model supports a specific capability */
  hasCapability?(modelId: string, capability: ModelCapability): boolean;
}
