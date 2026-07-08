/**
 * Smart model router.
 * Routes requests to the optimal provider based on:
 * - Task complexity (simple → cheap/fast model, complex → powerful model)
 * - Budget remaining (auto-downgrade when near limit)
 * - Data sensitivity (restricted → local only)
 * - Latency requirements (real-time → local, batch → cloud)
 * - Availability (fallback if primary is down)
 */

import type { Provider, ProviderMessage, ProviderOptions, ProviderResponse, ModelInfo } from "./types.js";
import type { DataClass } from "@kairos/security";

export interface RouterConfig {
  /** Available providers in preference order */
  providers: Provider[];
  /** Default model for general use */
  defaultModel: string;
  /** Budget limit in USD (optional) */
  budgetLimit?: number;
  /** Data classification for this session */
  dataClassification?: DataClass;
  /** Prefer local models (even if cloud is available) */
  preferLocal?: boolean;
}

export interface RouteDecision {
  provider: Provider;
  model: string;
  reason: string;
}

export class SmartRouter {
  private config: RouterConfig;
  private spentUsd = 0;
  private availableModels: ModelInfo[] = [];
  private initialized = false;

  constructor(config: RouterConfig) {
    this.config = config;
  }

  /** Initialize by checking provider availability */
  async initialize(): Promise<void> {
    const models: ModelInfo[] = [];
    for (const provider of this.config.providers) {
      if (await provider.isAvailable()) {
        const providerModels = await provider.listModels();
        models.push(...providerModels);
      }
    }
    this.availableModels = models;
    this.initialized = true;
  }

  /** Get current spend */
  get spent(): number {
    return this.spentUsd;
  }

  /** Get budget remaining (Infinity if no limit) */
  get budgetRemaining(): number {
    return this.config.budgetLimit
      ? this.config.budgetLimit - this.spentUsd
      : Infinity;
  }

  /**
   * Route a request to the best provider/model.
   */
  async route(
    messages: ProviderMessage[],
    options: Partial<ProviderOptions> & { complexity?: "low" | "medium" | "high" }
  ): Promise<ProviderResponse> {
    if (!this.initialized) await this.initialize();

    const decision = this.decide(options);
    const provider = decision.provider;

    const fullOptions: ProviderOptions = {
      model: decision.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools: options.tools,
      stream: options.stream,
    };

    const response = await provider.complete(messages, fullOptions);
    this.spentUsd += response.costUsd;

    return response;
  }

  /**
   * Decide which provider and model to use.
   */
  decide(
    options: Partial<ProviderOptions> & { complexity?: "low" | "medium" | "high" }
  ): RouteDecision {
    // Rule 1: Restricted data → local only
    if (this.config.dataClassification === "restricted") {
      const localProvider = this.config.providers.find((p) => p.isLocal);
      if (!localProvider) {
        throw new Error(
          "Restricted data requires a local model, but no local provider is available. " +
          "Install Ollama (https://ollama.ai) to process sensitive data."
        );
      }
      return {
        provider: localProvider,
        model: this.bestLocalModel(),
        reason: "Restricted data — using local model only",
      };
    }

    // Rule 2: Budget nearly exhausted → cheapest option
    if (this.config.budgetLimit && this.budgetRemaining < 0.10) {
      const localProvider = this.config.providers.find((p) => p.isLocal);
      if (localProvider) {
        return {
          provider: localProvider,
          model: this.bestLocalModel(),
          reason: "Budget nearly exhausted — switching to free local model",
        };
      }
    }

    // Rule 3: Prefer local if configured
    if (this.config.preferLocal) {
      const localProvider = this.config.providers.find((p) => p.isLocal);
      if (localProvider) {
        return {
          provider: localProvider,
          model: this.bestLocalModel(),
          reason: "Local preference enabled",
        };
      }
    }

    // Rule 4: Route by complexity
    const complexity = options.complexity ?? "medium";
    const targetModel = this.modelForComplexity(complexity);

    const provider = this.config.providers.find((p) =>
      this.availableModels.some(
        (m) => m.id === targetModel && m.provider === p.name
      )
    );

    if (provider) {
      return { provider, model: targetModel, reason: `Complexity: ${complexity}` };
    }

    // Fallback to default
    const defaultProvider = this.config.providers.find((p) =>
      this.availableModels.some(
        (m) => m.id === this.config.defaultModel && m.provider === p.name
      )
    ) ?? this.config.providers[0];

    return {
      provider: defaultProvider,
      model: this.config.defaultModel,
      reason: "Fallback to default",
    };
  }

  private bestLocalModel(): string {
    const localModels = this.availableModels.filter((m) => m.isLocal);
    return localModels[0]?.id ?? "ollama/llama3.2";
  }

  private modelForComplexity(complexity: "low" | "medium" | "high"): string {
    const sorted = [...this.availableModels].sort(
      (a, b) =>
        a.costPerInputToken + a.costPerOutputToken -
        (b.costPerInputToken + b.costPerOutputToken)
    );

    switch (complexity) {
      case "low":
        // Cheapest available
        return sorted[0]?.id ?? this.config.defaultModel;
      case "high":
        // Most expensive (presumably most capable)
        return sorted[sorted.length - 1]?.id ?? this.config.defaultModel;
      case "medium":
      default:
        return this.config.defaultModel;
    }
  }
}
