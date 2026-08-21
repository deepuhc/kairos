import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk, CostEstimate, ModelCapability, ContentPart } from './types.js';
import { looksLikeVisionModel } from './vision-models.js';

/**
 * Configuration for a custom HTTP provider.
 * Supports: remote Ollama, Open WebUI, LM Studio, vLLM, or any OpenAI-compatible endpoint.
 */
export interface CustomHttpConfig {
  /** Display name for this provider */
  name: string;
  /** Base URL (e.g., "http://192.168.1.200:11434" for remote Ollama, "http://localhost:3000" for Open WebUI) */
  baseUrl: string;
  /** Provider type determines API format */
  type: 'ollama' | 'openai-compatible' | 'open-webui';
  /** Auth configuration */
  auth?: { type: 'bearer' | 'basic' | 'api-key'; token: string };
  /** SSH tunnel config — if set, provider manages tunnel lifecycle */
  sshTunnel?: { host: string; port: number; user: string; keyPath?: string; localPort?: number };
  /** Whether this provider runs on local network (privacy routing hint) */
  isLocal: boolean;
  /** Default model to use if none specified */
  defaultModel?: string;
}

export class CustomHttpProvider implements Provider {
  readonly name: string;
  readonly isLocal: boolean;
  private config: CustomHttpConfig;

  constructor(config: CustomHttpConfig) {
    this.config = config;
    this.name = config.name;
    this.isLocal = config.isLocal;
  }

  /** The endpoint this provider talks to — useful for diagnostics. */
  get endpoint(): string {
    return this.config.baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const url = this.config.type === 'ollama'
        ? `${this.config.baseUrl}/api/tags`
        : `${this.config.baseUrl}/models`;
      const res = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      if (this.config.type === 'ollama') {
        return this.listOllamaModels();
      }
      return this.listOpenAIModels();
    } catch {
      return [];
    }
  }

  hasCapability(modelId: string, capability: ModelCapability): boolean {
    // For custom providers, infer from model name
    const lower = modelId.toLowerCase();
    switch (capability) {
      // A custom endpoint may front either open-weight or hosted models, so
      // consider both marker sets. Shared with OllamaProvider so the same model
      // is classified identically however it is reached.
      case 'vision': return looksLikeVisionModel(lower, true);
      case 'code': return lower.includes('code') || lower.includes('coder') || lower.includes('starcoder');
      case 'reasoning': return lower.includes('r1') || lower.includes('think') || lower.includes('o1') || lower.includes('o3');
      case 'tool_calling': return lower.includes('qwen') || lower.includes('hermes') || lower.includes('gpt');
      case 'streaming': return true;
      default: return capability === 'chat';
    }
  }

  estimateCost(_messages: Message[], _model?: string): CostEstimate {
    // Local/custom providers are typically free
    if (this.isLocal) return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
    // Unknown pricing for remote custom endpoints
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    if (this.config.type === 'ollama') {
      return this.completeOllama(messages, options);
    }
    return this.completeOpenAI(messages, options);
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    if (this.config.type === 'ollama') {
      yield* this.streamOllama(messages, options);
    } else {
      yield* this.streamOpenAI(messages, options);
    }
  }

  // --- Ollama-specific methods ---

  private async listOllamaModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.config.baseUrl}/api/tags`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name: string; size: number; details?: { parameter_size?: string; family?: string } }> };
    return (data.models || []).map((m) => ({
      id: m.name,
      name: m.name.split(':')[0],
      provider: this.name,
      isLocal: this.isLocal,
      capabilities: this.inferCapabilities(m.name),
    }));
  }

  private async completeOllama(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || this.config.defaultModel || 'mistral';
    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({
        model,
        messages: this.formatOllamaMessages(messages),
        stream: false,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
      }),
      signal: options?.signal,
    });

    if (!res.ok) throw new Error(`${this.name} error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: data.message.content,
      model,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
      finishReason: 'stop',
    };
  }

  private async *streamOllama(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const model = options?.model || this.config.defaultModel || 'mistral';
    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({
        model,
        messages: this.formatOllamaMessages(messages),
        stream: true,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
      }),
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
    let totalInput = 0;
    let totalOutput = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as {
            message?: { content: string };
            done?: boolean;
            eval_count?: number;
            prompt_eval_count?: number;
          };
          if (chunk.message?.content) {
            yield { type: 'text', text: chunk.message.content };
          }
          if (chunk.done) {
            totalInput = chunk.prompt_eval_count || 0;
            totalOutput = chunk.eval_count || 0;
          }
        } catch {
          // skip malformed
        }
      }
    }

    if (totalInput || totalOutput) {
      yield { type: 'usage', inputTokens: totalInput, outputTokens: totalOutput };
    }
  }

  private formatOllamaMessages(messages: Message[]): object[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      // Ollama supports images via "images" field
      const textParts = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text);
      const images = m.content.filter((p) => p.type === 'image').map((p) => (p as { data: string }).data);
      return {
        role: m.role,
        content: textParts.join('\n'),
        ...(images.length > 0 && { images }),
      };
    });
  }

  // --- OpenAI-compatible methods ---

  private async listOpenAIModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.config.baseUrl}/models`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> };
    return (data.data || []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: this.name,
      isLocal: this.isLocal,
      capabilities: this.inferCapabilities(m.id),
    }));
  }

  private async completeOpenAI(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || this.config.defaultModel || 'gpt-4o';
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({
        model,
        messages: this.formatOpenAIMessages(messages),
        stream: false,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens && { max_tokens: options.maxTokens }),
        ...(options?.jsonMode && { response_format: { type: 'json_object' } }),
      }),
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

  private async *streamOpenAI(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const model = options?.model || this.config.defaultModel || 'gpt-4o';
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({
        model,
        messages: this.formatOpenAIMessages(messages),
        stream: true,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens && { max_tokens: options.maxTokens }),
        ...(options?.jsonMode && { response_format: { type: 'json_object' } }),
      }),
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

  private formatOpenAIMessages(messages: Message[]): object[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      // OpenAI multi-modal format
      const parts = m.content.map((p: ContentPart) => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } };
        if (p.type === 'file') return { type: 'text', text: `[File: ${p.filename || 'attachment'}]` };
        return { type: 'text', text: '' };
      });
      return { role: m.role, content: parts };
    });
  }

  // --- Shared helpers ---

  private authHeaders(): Record<string, string> {
    if (!this.config.auth) return {};
    switch (this.config.auth.type) {
      case 'bearer': return { 'Authorization': `Bearer ${this.config.auth.token}` };
      case 'basic': return { 'Authorization': `Basic ${this.config.auth.token}` };
      case 'api-key': return { 'x-api-key': this.config.auth.token };
      default: return {};
    }
  }

  private inferCapabilities(modelName: string): ModelCapability[] {
    const caps: ModelCapability[] = ['chat', 'streaming'];
    const lower = modelName.toLowerCase();
    if (lower.includes('code') || lower.includes('coder')) caps.push('code');
    if (lower.includes('r1') || lower.includes('think') || lower.includes('o1') || lower.includes('o3')) caps.push('reasoning');
    if (looksLikeVisionModel(lower, true)) caps.push('vision');
    if (lower.includes('qwen') || lower.includes('hermes') || lower.includes('gpt')) caps.push('tool_calling');
    return caps;
  }
}
