import type { Provider, ModelInfo, Message, CompletionOptions, CompletionResult } from './types.js';
import type { ProviderRegistry } from './registry.js';

export interface RouterConfig {
  preferLocal?: boolean;
  maxBudgetUsd?: number;
  spentUsd?: number;
  defaultModel?: string;
}

export class SmartRouter {
  private registry: ProviderRegistry;
  private config: RouterConfig;

  constructor(registry: ProviderRegistry, config?: RouterConfig) {
    this.registry = registry;
    this.config = config || {};
  }

  async selectModel(options?: { complexity?: 'low' | 'medium' | 'high'; requireLocal?: boolean }): Promise<{ provider: Provider; model: ModelInfo } | null> {
    const models = await this.registry.listAllModels();
    if (models.length === 0) return null;

    let candidates = models;

    // Rule 1: Privacy — if local required, filter to local only
    if (options?.requireLocal || this.config.preferLocal) {
      const localModels = candidates.filter((m) => m.isLocal);
      if (localModels.length > 0) candidates = localModels;
      else if (options?.requireLocal) return null;
    }

    // Rule 2: Budget — if near limit, prefer free (local) models
    if (this.config.maxBudgetUsd && this.config.spentUsd) {
      const remaining = this.config.maxBudgetUsd - this.config.spentUsd;
      if (remaining < 0.01) {
        candidates = candidates.filter((m) => m.isLocal);
        if (candidates.length === 0) return null;
      }
    }

    // Rule 3: Complexity routing
    if (options?.complexity === 'high') {
      const powerful = candidates.filter((m) =>
        m.capabilities?.includes('reasoning') || (m.costPerMillionOutput && m.costPerMillionOutput > 10)
      );
      if (powerful.length > 0) candidates = powerful;
    } else if (options?.complexity === 'low') {
      const cheap = candidates.filter((m) => m.isLocal || (m.costPerMillionInput && m.costPerMillionInput < 2));
      if (cheap.length > 0) candidates = cheap;
    }

    // Rule 4: If user specified a default, try that first
    if (this.config.defaultModel) {
      const preferred = candidates.find((m) => m.id === this.config.defaultModel);
      if (preferred) {
        const provider = this.registry.getProviderForModel(preferred.id, models);
        if (provider) return { provider, model: preferred };
      }
    }

    // Fallback: pick first available candidate (local models first)
    candidates.sort((a, b) => (a.isLocal === b.isLocal ? 0 : a.isLocal ? -1 : 1));
    const selected = candidates[0];
    const provider = this.registry.getProviderForModel(selected.id, models);
    if (!provider) return null;

    return { provider, model: selected };
  }

  async complete(messages: Message[], options?: CompletionOptions & { complexity?: 'low' | 'medium' | 'high'; requireLocal?: boolean }): Promise<CompletionResult> {
    const selection = await this.selectModel({ complexity: options?.complexity, requireLocal: options?.requireLocal });
    if (!selection) throw new Error('No available models');

    return selection.provider.complete(messages, { ...options, model: options?.model || selection.model.id });
  }

  async *stream(messages: Message[], options?: CompletionOptions & { complexity?: 'low' | 'medium' | 'high'; requireLocal?: boolean }): AsyncIterable<string> {
    const selection = await this.selectModel({ complexity: options?.complexity, requireLocal: options?.requireLocal });
    if (!selection) throw new Error('No available models');

    yield* selection.provider.stream(messages, { ...options, model: options?.model || selection.model.id });
  }
}
