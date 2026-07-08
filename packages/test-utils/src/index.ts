/**
 * Shared test utilities for Kairos packages.
 */

import type { Provider, ProviderMessage, ProviderOptions, ProviderResponse, ModelInfo } from "@kairos/providers";

/**
 * Mock provider that returns canned responses.
 * Use in tests to avoid hitting real LLM APIs.
 */
export class MockProvider implements Provider {
  readonly name = "mock";
  readonly isLocal = true;
  private responses: string[];
  private callIndex = 0;
  public calls: Array<{ messages: ProviderMessage[]; options: ProviderOptions }> = [];

  constructor(responses: string[] = ["Mock response"]) {
    this.responses = responses;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "mock/test-model",
        provider: "mock",
        name: "test-model",
        contextWindow: 8192,
        costPerInputToken: 0,
        costPerOutputToken: 0,
        capabilities: ["fast", "cheap"],
        isLocal: true,
      },
    ];
  }

  async complete(
    messages: ProviderMessage[],
    options: ProviderOptions
  ): Promise<ProviderResponse> {
    this.calls.push({ messages, options });
    const content = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;

    return {
      content,
      model: "mock/test-model",
      tokensUsed: { input: 100, output: 50, total: 150 },
      costUsd: 0,
      durationMs: 10,
    };
  }

  /** Reset call history */
  reset(): void {
    this.calls = [];
    this.callIndex = 0;
  }
}

/**
 * Create a minimal valid recipe for testing.
 */
export function createTestRecipe(overrides?: Record<string, unknown>) {
  return {
    name: "Test Recipe",
    description: "A recipe for testing",
    version: 1,
    providers: { default: "mock/test-model" },
    agents: [
      { id: "test-agent", role: "Test agent" },
    ],
    pipeline: [
      { phase: "test-phase", pattern: "sequential", agents: ["test-agent"] },
    ],
    ...overrides,
  };
}
