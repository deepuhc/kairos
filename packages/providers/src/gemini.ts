import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk, CostEstimate, ModelCapability, ContentPart } from './types.js';

const MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', isLocal: false, contextWindow: 1000000, maxOutputTokens: 65536, costPerMillionInput: 1.25, costPerMillionOutput: 10, capabilities: ['chat', 'code', 'reasoning', 'vision', 'tool_calling', 'long_context', 'streaming', 'json_mode'] },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', isLocal: false, contextWindow: 1000000, maxOutputTokens: 65536, costPerMillionInput: 0.15, costPerMillionOutput: 0.6, capabilities: ['chat', 'code', 'reasoning', 'vision', 'tool_calling', 'long_context', 'streaming', 'json_mode'] },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', isLocal: false, contextWindow: 1000000, maxOutputTokens: 8192, costPerMillionInput: 0.1, costPerMillionOutput: 0.4, capabilities: ['chat', 'code', 'vision', 'tool_calling', 'long_context', 'streaming'] },
];

export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  readonly isLocal = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.baseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
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
    const modelInfo = MODELS.find((m) => m.id === (model || 'gemini-2.5-flash'));
    if (!modelInfo) return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };

    // Rough estimate: 4 chars ≈ 1 token
    const inputChars = messages.reduce((sum, m) => {
      const text = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
      return sum + text.length;
    }, 0);
    const estimatedInputTokens = Math.ceil(inputChars / 4);
    const estimatedOutputTokens = Math.min(modelInfo.maxOutputTokens || 4096, 2048); // assume moderate response

    const inputCostUsd = (estimatedInputTokens * (modelInfo.costPerMillionInput || 0)) / 1_000_000;
    const outputCostUsd = (estimatedOutputTokens * (modelInfo.costPerMillionOutput || 0)) / 1_000_000;

    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || 'gemini-2.5-flash';
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    const { systemInstruction, contents } = this.formatMessages(messages, options?.systemPrompt);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (options?.temperature !== undefined || options?.maxTokens || options?.jsonMode) {
      body.generationConfig = {
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens && { maxOutputTokens: options.maxTokens }),
        ...(options.jsonMode && { responseMimeType: 'application/json' }),
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
    const data = await res.json() as GeminiResponse;

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const usage = data.usageMetadata;
    const modelInfo = MODELS.find((m) => m.id === model);
    const costUsd = usage && modelInfo
      ? ((usage.promptTokenCount || 0) * (modelInfo.costPerMillionInput || 0) + (usage.candidatesTokenCount || 0) * (modelInfo.costPerMillionOutput || 0)) / 1_000_000
      : undefined;

    return {
      content: text,
      model,
      usage: usage ? {
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        totalCostUsd: costUsd,
      } : undefined,
      finishReason: this.mapFinishReason(data.candidates?.[0]?.finishReason),
    };
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const model = options?.model || 'gemini-2.5-flash';
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const { systemInstruction, contents } = this.formatMessages(messages, options?.systemPrompt);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (options?.temperature !== undefined || options?.maxTokens || options?.jsonMode) {
      body.generationConfig = {
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens && { maxOutputTokens: options.maxTokens }),
        ...(options.jsonMode && { responseMimeType: 'application/json' }),
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      yield { type: 'error', message: `Gemini stream error: ${res.status}` };
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
        const payload = line.slice(6).trim();
        if (!payload) continue;

        try {
          const event = JSON.parse(payload) as GeminiResponse;
          const parts = event.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', text: part.text };
            }
          }

          // Emit usage at end
          if (event.usageMetadata) {
            const modelInfo = MODELS.find((m) => m.id === model);
            const costUsd = modelInfo
              ? ((event.usageMetadata.promptTokenCount || 0) * (modelInfo.costPerMillionInput || 0) + (event.usageMetadata.candidatesTokenCount || 0) * (modelInfo.costPerMillionOutput || 0)) / 1_000_000
              : undefined;
            yield {
              type: 'usage',
              inputTokens: event.usageMetadata.promptTokenCount || 0,
              outputTokens: event.usageMetadata.candidatesTokenCount || 0,
              totalCostUsd: costUsd,
            };
          }
        } catch {
          // skip malformed SSE
        }
      }
    }
  }

  private formatMessages(messages: Message[], systemPrompt?: string): { systemInstruction?: object; contents: object[] } {
    let systemInstruction: object | undefined;
    const contents: object[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : msg.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
        systemInstruction = { parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${text}` : text }] };
        continue;
      }

      const parts = this.contentToParts(msg.content);
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    }

    if (!systemInstruction && systemPrompt) {
      systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    return { systemInstruction, contents };
  }

  private contentToParts(content: string | ContentPart[]): object[] {
    if (typeof content === 'string') return [{ text: content }];

    return content.map((part) => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'image') return { inlineData: { mimeType: part.mimeType, data: part.data } };
      if (part.type === 'file') return { inlineData: { mimeType: part.mimeType, data: part.data } };
      return { text: '' };
    });
  }

  private mapFinishReason(reason?: string): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER': return 'error';
      default: return 'stop';
    }
  }
}

// --- Gemini API response types ---

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}
