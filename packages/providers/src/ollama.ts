import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk, CostEstimate, ModelCapability } from './types.js';
import { looksLikeVisionModel } from './vision-models.js';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Normalize an Ollama host into a base URL.
 *
 * Ollama's own `OLLAMA_HOST` convention allows a bare `host:port` (e.g.
 * `0.0.0.0:11434`), so accept that as well as a full URL. A bare host gets
 * `http://`, and any trailing slash is dropped so `${baseUrl}/api/tags` never
 * doubles up.
 */
export function normalizeOllamaHost(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export class OllamaProvider implements Provider {
  readonly name = 'ollama';
  readonly isLocal = true;
  private baseUrl: string;

  /**
   * `baseUrl` wins; otherwise fall back to `OLLAMA_HOST` (the same env var
   * Ollama itself and `OllamaHttpAgent` use) so a remote/homelab Ollama works
   * with zero config, then to localhost.
   */
  constructor(baseUrl?: string) {
    this.baseUrl =
      normalizeOllamaHost(baseUrl) ??
      normalizeOllamaHost(process.env.OLLAMA_HOST) ??
      DEFAULT_OLLAMA_BASE_URL;
  }

  /** The resolved endpoint this provider talks to — useful for diagnostics. */
  get endpoint(): string {
    return this.baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name: string; size: number; details?: { parameter_size?: string; family?: string } }> };
    return (data.models || []).map((m) => ({
      id: m.name,
      name: m.name.split(':')[0],
      provider: 'ollama',
      isLocal: true,
      capabilities: this.inferCapabilities(m.name),
    }));
  }

  hasCapability(modelId: string, capability: ModelCapability): boolean {
    return this.inferCapabilities(modelId).includes(capability);
  }

  estimateCost(): CostEstimate {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model || 'mistral';
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        stream: false,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
      }),
      signal: options?.signal,
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
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

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const model = options?.model || 'mistral';
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        stream: true,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      yield { type: 'error', message: `Ollama stream error: ${res.status}` };
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
            yield {
              type: 'usage',
              inputTokens: chunk.prompt_eval_count || 0,
              outputTokens: chunk.eval_count || 0,
            };
          }
        } catch {
          // skip malformed
        }
      }
    }
  }

  private formatMessages(messages: Message[]): object[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      const textParts = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text);
      const images = m.content.filter((p) => p.type === 'image').map((p) => (p as { data: string }).data);
      return {
        role: m.role,
        content: textParts.join('\n'),
        ...(images.length > 0 && { images }),
      };
    });
  }

  private inferCapabilities(modelName: string): ModelCapability[] {
    const caps: ModelCapability[] = ['chat', 'streaming'];
    const lower = modelName.toLowerCase();
    if (lower.includes('coder') || lower.includes('code')) caps.push('code');
    if (lower.includes('r1') || lower.includes('think')) caps.push('reasoning');
    if (lower.includes('qwen') || lower.includes('hermes')) caps.push('tool_calling');
    // Ollama serves open-weight models only — no hosted markers.
    if (looksLikeVisionModel(lower)) caps.push('vision');
    return caps;
  }
}
