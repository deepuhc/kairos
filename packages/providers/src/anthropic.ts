import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk, CostEstimate, ModelCapability, ContentPart } from './types.js';

const MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', isLocal: false, contextWindow: 200000, maxOutputTokens: 16384, costPerMillionInput: 3, costPerMillionOutput: 15, capabilities: ['chat', 'code', 'reasoning', 'tool_calling', 'vision', 'streaming', 'json_mode'] },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', isLocal: false, contextWindow: 200000, maxOutputTokens: 32768, costPerMillionInput: 15, costPerMillionOutput: 75, capabilities: ['chat', 'code', 'reasoning', 'tool_calling', 'vision', 'streaming', 'json_mode'] },
  { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', provider: 'anthropic', isLocal: false, contextWindow: 200000, maxOutputTokens: 8192, costPerMillionInput: 0.8, costPerMillionOutput: 4, capabilities: ['chat', 'code', 'tool_calling', 'vision', 'streaming'] },
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

  estimateCost(messages: Message[], model?: string): CostEstimate {
    const modelInfo = MODELS.find((m) => m.id === (model || 'claude-sonnet-4-20250514'));
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
    const model = options?.model || 'claude-sonnet-4-20250514';
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
    const model = options?.model || 'claude-sonnet-4-20250514';
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
            usage?: { output_tokens: number };
          };

          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta?.text) {
              yield { type: 'text', text: event.delta.text };
            } else if (event.delta?.type === 'thinking_delta' && event.delta?.text) {
              yield { type: 'thinking', text: event.delta.text };
            }
          } else if (event.type === 'message_delta' && event.usage) {
            const modelInfo = MODELS.find((m) => m.id === model);
            yield {
              type: 'usage',
              inputTokens: 0,
              outputTokens: event.usage.output_tokens,
              totalCostUsd: modelInfo ? (event.usage.output_tokens * (modelInfo.costPerMillionOutput || 0)) / 1_000_000 : undefined,
            };
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
