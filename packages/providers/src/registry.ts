import type { Provider, ModelInfo } from './types.js';
import { OllamaProvider } from './ollama.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { CustomHttpProvider, type CustomHttpConfig } from './custom-http.js';

export interface RegistryConfig {
  ollama?: { baseUrl?: string };
  anthropic?: { apiKey?: string; baseUrl?: string };
  openai?: { apiKey?: string; baseUrl?: string };
  gemini?: { apiKey?: string; baseUrl?: string };
  custom?: CustomHttpConfig[];
}

export class ProviderRegistry {
  private providers: Provider[] = [];

  constructor(config?: RegistryConfig) {
    this.providers.push(new OllamaProvider(config?.ollama?.baseUrl));
    this.providers.push(new AnthropicProvider(config?.anthropic?.apiKey, config?.anthropic?.baseUrl));
    this.providers.push(new OpenAIProvider({
      apiKey: config?.openai?.apiKey,
      baseUrl: config?.openai?.baseUrl,
    }));
    this.providers.push(new GeminiProvider(config?.gemini?.apiKey, config?.gemini?.baseUrl));

    for (const custom of config?.custom || []) {
      this.providers.push(new CustomHttpProvider(custom));
    }
  }

  addProvider(provider: Provider): void {
    this.providers.push(provider);
  }

  removeProvider(name: string): void {
    this.providers = this.providers.filter((p) => p.name !== name);
  }

  async discoverAvailable(): Promise<Provider[]> {
    const checks = await Promise.all(
      this.providers.map(async (p) => ({ provider: p, available: await p.isAvailable() }))
    );
    return checks.filter((c) => c.available).map((c) => c.provider);
  }

  async listAllModels(): Promise<ModelInfo[]> {
    const available = await this.discoverAvailable();
    const modelLists = await Promise.all(available.map((p) => p.listModels()));
    return modelLists.flat();
  }

  getProvider(name: string): Provider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  getProviderForModel(modelId: string, models: ModelInfo[]): Provider | undefined {
    const info = models.find((m) => m.id === modelId);
    if (!info) return undefined;
    return this.getProvider(info.provider);
  }

  get all(): readonly Provider[] {
    return this.providers;
  }
}
