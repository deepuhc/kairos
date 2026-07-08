/**
 * Provider interface — the contract all LLM adapters implement.
 */

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderResponse {
  content: string;
  model: string;
  tokensUsed: { input: number; output: number; total: number };
  costUsd: number;
  durationMs: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  capabilities: ModelCapability[];
  isLocal: boolean;
}

export type ModelCapability =
  | "reasoning"
  | "coding"
  | "vision"
  | "tools"
  | "fast"
  | "cheap";

/**
 * All providers implement this interface.
 */
export interface Provider {
  readonly name: string;
  readonly isLocal: boolean;

  /** Check if the provider is available and configured */
  isAvailable(): Promise<boolean>;

  /** List available models */
  listModels(): Promise<ModelInfo[]>;

  /** Send a completion request */
  complete(
    messages: ProviderMessage[],
    options: ProviderOptions
  ): Promise<ProviderResponse>;

  /** Send a streaming completion request */
  stream?(
    messages: ProviderMessage[],
    options: ProviderOptions
  ): AsyncIterable<string>;
}
