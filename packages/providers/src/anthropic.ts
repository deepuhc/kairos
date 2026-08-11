import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk, CostEstimate, ModelCapability, ContentPart } from './types.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

const MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', isLocal: false, contextWindow: 1000000, maxOutputTokens: 32768, costPerMillionInput: 5, costPerMillionOutput: 25, capabilities: ['chat', 'code', 'reasoning', 'tool_calling', 'vision', 'streaming', 'json_mode', 'long_context'] },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', provider: 'anthropic', isLocal: false, contextWindow: 1000000, maxOutputTokens: 32768, costPerMillionInput: 5, costPerMillionOutput: 25, capabilities: ['chat', 'code', 'reasoning', 'tool_calling', 'vision', 'streaming', 'json_mode', 'long_context'] },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', isLocal: false, contextWindow: 1000000, maxOutputTokens: 32768, costPerMillionInput: 3, costPerMillionOutput: 15, capabilities: ['chat', 'code', 'reasoning', 'tool_calling', 'vision', 'streaming', 'json_mode', 'long_context'] },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', isLocal: false, contextWindow: 200000, maxOutputTokens: 8192, costPerMillionInput: 1, costPerMillionOutput: 5, capabilities: ['chat', 'code', 'tool_calling', 'vision', 'streaming'] },
];

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly isLocal = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return [];
    return MODELS;
  }

  hasCapability(modelId: string, capability: ModelCapability): boolean {
    const model = MODELS.find((m) => m.id === modelId);
    return model?.capabilities.includes(capability) ?? false;
  }

  // Modern Claude models (4.6+) use adaptive thinking: the model decides how
  // much to reason, and depth is tuned via output_config.effort. The legacy
  // `thinking: {type: "enabled", budget_tokens}` shape is rejected with a 400
  // on Opus 4.8/4.7, Sonnet 5, and Fable 5 — never send it.
  private applyReasoning(body: Record<string, unknown>, options?: CompletionOptions): void {
    if (options?.thinking) {
      body.thinking = { type: 'adaptive' };
    }
    if (options?.effort) {
      body.output_config = { effort: options.effort };
    }
  }

  estimateCost(messages: Message[], model?: string): CostEstimate {
    const modelInfo = MODELS.find((m) => m.id === (model || DEFAULT_MODEL));
    if (!modelInfo) return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };

    const inputChars = messages.reduce((sum, m) => {
      const text = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
      return sum + text.length;
    }, 0);
    const estimatedInputTokens = Math.ceil(inputChars / 4);
    const estimatedOutputTokens = 2048;

    const inputCostUsd = (estimatedInputTokens * (modelInfo.costPerMillionInput || 0)) / 1_000_000;
    const outputCostUsd = (estimatedOutputTokens * (modelInfo.costPerMillionOutput || 0)) / 1_000_000;

    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || DEFAULT_MODEL;
    const formattedMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role,
      content: this.formatContent(m.content),
    }));
    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      messages: formattedMessages,
    };

    const systemMsg = messages.find((m) => m.role === 'system');
    if (systemMsg || options?.systemPrompt) {
      body.system = options?.systemPrompt || (typeof systemMsg?.content === 'string' ? systemMsg.content : '');
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    this.applyReasoning(body, options);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const thinking = data.content.filter((b) => b.type === 'thinking').map((b) => b.text).join('');
    const modelInfo = MODELS.find((m) => m.id === model);
    const costUsd = modelInfo
      ? (data.usage.input_tokens * (modelInfo.costPerMillionInput || 0) + data.usage.output_tokens * (modelInfo.costPerMillionOutput || 0)) / 1_000_000
      : undefined;

    return {
      content: text,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalCostUsd: costUsd,
      },
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason as 'stop',
      ...(thinking && { thinking }),
    };
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const model = options?.model || DEFAULT_MODEL;
    const formattedMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role,
      content: this.formatContent(m.content),
    }));
    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      stream: true,
      messages: formattedMessages,
    };

    const systemMsg = messages.find((m) => m.role === 'system');
    if (systemMsg || options?.systemPrompt) {
      body.system = options?.systemPrompt || (typeof systemMsg?.content === 'string' ? systemMsg.content : '');
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    this.applyReasoning(body, options);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      yield { type: 'error', message: `Anthropic stream error: ${res.status}` };
      return;
    }
    if (!res.body) {
      yield { type: 'error', message: 'No response body' };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // input_tokens arrives once in the message_start event; output_tokens
    // arrives in message_delta. Carry the input count forward so the final
    // usage chunk reports both (a streamed turn otherwise loses input tokens,
    // skewing every downstream total + cost calculation).
    let inputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') return;
        try {
          const event = JSON.parse(payload) as {
            type: string;
            delta?: { type: string; text?: string };
            content_block?: { type: string };
            message?: { usage?: { input_tokens: number; output_tokens: number } };
            usage?: { input_tokens?: number; output_tokens: number };
          };

          if (event.type === 'message_start') {
            inputTokens = event.message?.usage?.input_tokens ?? 0;
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta?.text) {
              yield { type: 'text', text: event.delta.text };
            } else if (event.delta?.type === 'thinking_delta' && event.delta?.text) {
              yield { type: 'thinking', text: event.delta.text };
            }
          } else if (event.type === 'message_delta' && event.usage) {
            const modelInfo = MODELS.find((m) => m.id === model);
            const outputTokens = event.usage.output_tokens;
            const costUsd = modelInfo
              ? (inputTokens * (modelInfo.costPerMillionInput || 0) +
                 outputTokens * (modelInfo.costPerMillionOutput || 0)) / 1_000_000
              : undefined;
            yield { type: 'usage', inputTokens, outputTokens, totalCostUsd: costUsd };
          }
        } catch {
          // skip malformed
        }
      }
    }
  }

  private formatContent(content: string | ContentPart[]): string | object[] {
    if (typeof content === 'string') return content;
    return content.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      if (part.type === 'image') return {
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.data },
      };
      if (part.type === 'file') return { type: 'text', text: `[File: ${part.filename || 'attachment'}]` };
      return { type: 'text', text: '' };
    });
  }
}
