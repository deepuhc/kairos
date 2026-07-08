/**
 * OpenAI-compatible provider.
 * Works with OpenAI, Groq, Together, Anyscale, and any OpenAI-compatible API.
 */

import type {
  Provider,
  ProviderMessage,
  ProviderOptions,
  ProviderResponse,
  ModelInfo,
} from "./types.js";

export interface OpenAIConfig {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
}

// Cost per million tokens (approximate, as of 2025)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 },
};

export class OpenAIProvider implements Provider {
  readonly name = "openai";
  readonly isLocal = false;
  private apiKey: string;
  private baseUrl: string;
  private organization?: string;

  constructor(config?: OpenAIConfig) {
    this.apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = config?.baseUrl ?? "https://api.openai.com/v1";
    this.organization = config?.organization;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async listModels(): Promise<ModelInfo[]> {
    return Object.entries(MODEL_COSTS).map(([id, cost]) => ({
      id: `openai/${id}`,
      provider: "openai",
      name: id,
      contextWindow: id.includes("o1") || id.includes("o3") ? 200000 : 128000,
      costPerInputToken: cost.input / 1_000_000,
      costPerOutputToken: cost.output / 1_000_000,
      capabilities: inferCapabilities(id),
      isLocal: false,
    }));
  }

  async complete(
    messages: ProviderMessage[],
    options: ProviderOptions
  ): Promise<ProviderResponse> {
    const model = options.model.replace("openai/", "");
    const start = Date.now();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: false,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`OpenAI error: ${res.status} - ${error}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    const costs = MODEL_COSTS[model] ?? { input: 5, output: 15 };
    const costUsd =
      (data.usage.prompt_tokens * costs.input +
        data.usage.completion_tokens * costs.output) /
      1_000_000;

    return {
      content: data.choices[0].message.content,
      model: `openai/${data.model}`,
      tokensUsed: {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens,
        total: data.usage.total_tokens,
      },
      costUsd,
      durationMs: Date.now() - start,
    };
  }
}

function inferCapabilities(model: string): ModelInfo["capabilities"] {
  if (model.includes("o1") || model.includes("o3")) {
    return ["reasoning", "coding"];
  }
  if (model.includes("mini")) {
    return ["fast", "cheap", "coding"];
  }
  return ["reasoning", "coding", "tools", "vision"];
}
