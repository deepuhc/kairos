import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk, CostEstimate, ModelCapability, ContentPart } from './types.js';

export class OpenAIProvider implements Provider {
  readonly name: string;
  readonly isLocal: boolean;
  private apiKey: string;
  private baseUrl: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; name?: string; isLocal?: boolean }) {
    this.apiKey = options?.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = options?.baseUrl || 'https://api.openai.com/v1';
    this.name = options?.name || 'openai';
    this.isLocal = options?.isLocal || false;
  }

  async isAvailable(): Promise<boolean> {
    if (this.isLocal) {
      try {
        const res = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
      } catch {
        return false;
      }
    }
    return !!this.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> };
      return (data.data || []).map((m) => ({
        id: m.id,
        name: m.id,
        provider: this.name,
        isLocal: this.isLocal,
        capabilities: this.inferCapabilities(m.id),
      }));
    } catch {
      return [];
    }
  }

  hasCapability(modelId: string, capability: ModelCapability): boolean {
    return this.inferCapabilities(modelId).includes(capability);
  }

  estimateCost(messages: Message[], model?: string): CostEstimate {
    if (this.isLocal) return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
    // Rough estimate for OpenAI models
    const inputChars = messages.reduce((sum, m) => {
      const text = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
      return sum + text.length;
    }, 0);
    const estimatedInputTokens = Math.ceil(inputChars / 4);
    const modelId = model || 'gpt-4o';
    // GPT-4o pricing approx
    const costPerMInput = modelId.includes('4o') ? 2.5 : modelId.includes('o1') ? 15 : 0.15;
    const costPerMOutput = modelId.includes('4o') ? 10 : modelId.includes('o1') ? 60 : 0.6;
    const inputCostUsd = (estimatedInputTokens * costPerMInput) / 1_000_000;
    const outputCostUsd = (2048 * costPerMOutput) / 1_000_000;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || 'gpt-4o';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages),
      stream: false,
    };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens) body.max_tokens = options.maxTokens;
    if (options?.jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) throw new Error(`${this.name} error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message.content || '',
      model: data.model,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      } : undefined,
      finishReason: data.choices[0]?.finish_reason === 'stop' ? 'stop' : 'length',
    };
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const model = options?.model || 'gpt-4o';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens) body.max_tokens = options.maxTokens;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      yield { type: 'error', message: `${this.name} stream error: ${res.status}` };
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
          const chunk = JSON.parse(payload) as {
            choices: Array<{ delta?: { content?: string; role?: string }; finish_reason?: string }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
          };
          const text = chunk.choices[0]?.delta?.content;
          if (text) yield { type: 'text', text };

          if (chunk.usage) {
            yield {
              type: 'usage',
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
          }
        } catch {
          // skip
        }
      }
    }
  }

  private formatMessages(messages: Message[]): object[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      const parts = m.content.map((p: ContentPart) => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } };
        if (p.type === 'file') return { type: 'text', text: `[File: ${p.filename || 'attachment'}]` };
        return { type: 'text', text: '' };
      });
      return { role: m.role, content: parts };
    });
  }

  private inferCapabilities(modelId: string): ModelCapability[] {
    const caps: ModelCapability[] = ['chat', 'streaming'];
    const lower = modelId.toLowerCase();
    if (lower.includes('4o') || lower.includes('gpt-4')) caps.push('vision', 'tool_calling', 'json_mode', 'code');
    if (lower.includes('o1') || lower.includes('o3')) caps.push('reasoning', 'code');
    if (lower.includes('gpt-3.5')) caps.push('tool_calling', 'json_mode');
    return caps;
  }
}
