/**
 * Anthropic Claude provider.
 */

import type {
  Provider,
  ProviderMessage,
  ProviderOptions,
  ProviderResponse,
  ModelInfo,
} from "./types.js";

export interface AnthropicConfig {
  apiKey?: string;
}

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
};

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly isLocal = false;
  private apiKey: string;

  constructor(config?: AnthropicConfig) {
    this.apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async listModels(): Promise<ModelInfo[]> {
    return Object.entries(MODEL_COSTS).map(([id, cost]) => ({
      id: `anthropic/${id}`,
      provider: "anthropic",
      name: id,
      contextWindow: 200000,
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
    const model = options.model.replace("anthropic/", "");
    const start = Date.now();

    // Separate system message from conversation
    const systemMsg = messages.find((m) => m.role === "system");
    const conversationMsgs = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages: conversationMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Anthropic error: ${res.status} - ${error}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const content = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    const costs = MODEL_COSTS[model] ?? { input: 3, output: 15 };
    const costUsd =
      (data.usage.input_tokens * costs.input +
        data.usage.output_tokens * costs.output) /
      1_000_000;

    return {
      content,
      model: `anthropic/${data.model}`,
      tokensUsed: {
        input: data.usage.input_tokens,
        output: data.usage.output_tokens,
        total: data.usage.input_tokens + data.usage.output_tokens,
      },
      costUsd,
      durationMs: Date.now() - start,
    };
  }
}

function inferCapabilities(model: string): ModelInfo["capabilities"] {
  if (model.includes("opus")) {
    return ["reasoning", "coding", "tools", "vision"];
  }
  if (model.includes("haiku")) {
    return ["fast", "cheap", "tools"];
  }
  return ["reasoning", "coding", "tools", "vision"];
}
