/**
 * Ollama provider — local model execution.
 * Connects to Ollama's REST API (default: http://localhost:11434).
 * Free, private, no data leaves the machine.
 */

import type {
  Provider,
  ProviderMessage,
  ProviderOptions,
  ProviderResponse,
  ModelInfo,
} from "./types.js";

export interface OllamaConfig {
  baseUrl?: string;
}

export class OllamaProvider implements Provider {
  readonly name = "ollama";
  readonly isLocal = true;
  private baseUrl: string;

  constructor(config?: OllamaConfig) {
    this.baseUrl = config?.baseUrl ?? "http://localhost:11434";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string; size: number }> };
      return (data.models ?? []).map((m) => ({
        id: `ollama/${m.name}`,
        provider: "ollama",
        name: m.name,
        contextWindow: 8192, // Conservative default
        costPerInputToken: 0,
        costPerOutputToken: 0,
        capabilities: ["fast", "cheap"] as ModelInfo["capabilities"],
        isLocal: true,
      }));
    } catch {
      return [];
    }
  }

  async complete(
    messages: ProviderMessage[],
    options: ProviderOptions
  ): Promise<ProviderResponse> {
    const model = options.model.replace("ollama/", "");
    const start = Date.now();

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens ?? 2048,
        },
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Ollama error: ${res.status} - ${error}`);
    }

    const data = (await res.json()) as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;

    return {
      content: data.message.content,
      model: `ollama/${model}`,
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      costUsd: 0, // Local models are free
      durationMs: Date.now() - start,
    };
  }

  async *stream(
    messages: ProviderMessage[],
    options: ProviderOptions
  ): AsyncIterable<string> {
    const model = options.model.replace("ollama/", "");

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens ?? 2048,
        },
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Ollama stream error: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as { message?: { content: string }; done?: boolean };
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
}
