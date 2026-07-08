/**
 * Provider factory — create providers from string identifiers.
 */

import type { Provider } from "./types.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

/**
 * Create a provider from a model string like "anthropic/claude-sonnet" or "ollama/llama3.2"
 */
export function createProvider(modelString: string): Provider {
  const [providerName] = modelString.split("/");

  switch (providerName) {
    case "ollama":
    case "local":
      return new OllamaProvider();

    case "openai":
    case "gpt":
      return new OpenAIProvider();

    case "anthropic":
    case "claude":
      return new AnthropicProvider();

    default:
      // Assume OpenAI-compatible for unknown providers
      return new OpenAIProvider({
        baseUrl: `https://api.${providerName}.com/v1`,
        apiKey: process.env[`${providerName.toUpperCase()}_API_KEY`],
      });
  }
}

/**
 * Auto-detect available providers on the system.
 */
export async function detectProviders(): Promise<Provider[]> {
  const candidates: Provider[] = [
    new OllamaProvider(),
    new AnthropicProvider(),
    new OpenAIProvider(),
  ];

  const available: Provider[] = [];
  for (const provider of candidates) {
    if (await provider.isAvailable()) {
      available.push(provider);
    }
  }

  return available;
}
