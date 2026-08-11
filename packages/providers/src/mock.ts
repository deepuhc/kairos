import type {
  Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk,
  CostEstimate, ModelCapability,
} from './types.js';

export interface MockProviderConfig {
  /** Whether the provider reports itself available (default: true). */
  available?: boolean;
  /** Override the advertised model list. */
  models?: ModelInfo[];
  /** Per-word delay when streaming, ms (default: 0 — instant). */
  streamDelayMs?: number;
}

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'mock-fast',
    name: 'Mock Fast',
    provider: 'mock',
    isLocal: true,
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
    capabilities: ['chat', 'code', 'streaming'],
    supportsStreaming: true,
  },
  {
    id: 'mock-smart',
    name: 'Mock Smart',
    provider: 'mock',
    isLocal: true,
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
    capabilities: ['chat', 'code', 'reasoning', 'tool_calling', 'streaming', 'long_context'],
    supportsStreaming: true,
  },
];

// A fully in-memory, network-free provider that implements the real `Provider`
// contract. It exists so the whole app (registry → router → server → UI) can run
// end-to-end with deterministic "AI" responses before any real model is wired
// up. Responses are derived from the prompt so they're reproducible and useful
// for demoing the orchestration flow.
export class MockProvider implements Provider {
  readonly name = 'mock';
  readonly isLocal = true;
  private available: boolean;
  private models: ModelInfo[];
  private streamDelayMs: number;

  constructor(config?: MockProviderConfig) {
    this.available = config?.available ?? true;
    this.models = config?.models ?? DEFAULT_MODELS;
    this.streamDelayMs = config?.streamDelayMs ?? 0;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.available ? this.models : [];
  }

  hasCapability(modelId: string, capability: ModelCapability): boolean {
    const model = this.models.find((m) => m.id === modelId);
    return model?.capabilities.includes(capability) ?? false;
  }

  estimateCost(): CostEstimate {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || this.models[0]?.id || 'mock-fast';
    const content = this.synthesize(messages);
    const result: CompletionResult = {
      content,
      model,
      usage: {
        inputTokens: this.countTokens(messages),
        outputTokens: this.roughTokens(content),
        totalCostUsd: 0,
      },
      finishReason: 'stop',
    };
    if (options?.thinking) result.thinking = 'Reasoning through the request step by step.';
    return result;
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    if (options?.thinking) {
      yield { type: 'thinking', text: 'Reasoning through the request step by step.' };
    }

    const content = this.synthesize(messages);
    const words = content.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (options?.signal?.aborted) {
        yield { type: 'error', message: 'aborted', code: 'aborted' };
        return;
      }
      if (this.streamDelayMs > 0) await delay(this.streamDelayMs);
      yield { type: 'text', text: i === 0 ? words[i] : ` ${words[i]}` };
    }

    yield {
      type: 'usage',
      inputTokens: this.countTokens(messages),
      outputTokens: this.roughTokens(content),
      totalCostUsd: 0,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /** Build a deterministic, prompt-aware reply so demos read sensibly. */
  private synthesize(messages: Message[]): string {
    const last = messages[messages.length - 1];
    const prompt = last ? textOf(last.content) : '';
    const trimmed = prompt.trim();
    if (!trimmed) return '[mock] (no prompt provided)';
    const oneLine = trimmed.replace(/\s+/g, ' ');
    const preview = oneLine.length > 200 ? `${oneLine.slice(0, 197)}…` : oneLine;
    return `[mock] Acknowledged: "${preview}". This is a simulated response from the Kairos mock provider — no real model was called.`;
  }

  private countTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + this.roughTokens(textOf(m.content)), 0);
  }

  private roughTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}

function textOf(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
