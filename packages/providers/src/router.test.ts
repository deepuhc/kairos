import { describe, it, expect, beforeEach } from "vitest";
import { SmartRouter } from "./router.js";
import { MockProvider } from "@kairos/test-utils";
import type { Provider, ModelInfo } from "./types.js";

// Mock local provider (simulates Ollama)
class MockLocalProvider extends MockProvider {
  override readonly name = "local";
  override readonly isLocal = true;

  override async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "local/llama3.2",
        provider: "local",
        name: "Llama 3.2",
        contextWindow: 8192,
        costPerInputToken: 0,
        costPerOutputToken: 0,
        capabilities: ["fast", "cheap"],
        isLocal: true,
      },
    ];
  }
}

// Mock cloud provider (simulates OpenAI/Anthropic)
class MockCloudProvider extends MockProvider {
  override readonly name = "cloud";
  override readonly isLocal = false;

  override async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "cloud/gpt-4",
        provider: "cloud",
        name: "GPT-4",
        contextWindow: 128000,
        costPerInputToken: 0.00003,
        costPerOutputToken: 0.00006,
        capabilities: ["reasoning", "coding"],
        isLocal: false,
      },
      {
        id: "cloud/gpt-3.5-turbo",
        provider: "cloud",
        name: "GPT-3.5 Turbo",
        contextWindow: 16000,
        costPerInputToken: 0.000001,
        costPerOutputToken: 0.000002,
        capabilities: ["fast", "cheap"],
        isLocal: false,
      },
    ];
  }
}

describe("SmartRouter", () => {
  let localProvider: MockLocalProvider;
  let cloudProvider: MockCloudProvider;

  beforeEach(() => {
    localProvider = new MockLocalProvider(["Local response"]);
    cloudProvider = new MockCloudProvider(["Cloud response"]);
  });

  describe("initialization", () => {
    it("detects available providers and loads models", async () => {
      const router = new SmartRouter({
        providers: [localProvider, cloudProvider],
        defaultModel: "cloud/gpt-4",
      });

      await router.initialize();

      // Should have loaded models from both providers
      const decision = router.decide({ complexity: "medium" });
      expect(decision.provider).toBeTruthy();
      expect(decision.model).toBeTruthy();
    });

    it("handles unavailable providers gracefully", async () => {
      const unavailableProvider = new MockProvider([]);
      unavailableProvider.isAvailable = async () => false;

      const router = new SmartRouter({
        providers: [unavailableProvider, localProvider],
        defaultModel: "local/llama3.2",
      });

      await router.initialize();

      // Should still work with just the local provider
      const decision = router.decide({ complexity: "low" });
      expect(decision.provider).toBe(localProvider);
    });
  });

  describe("restricted data routing", () => {
    it("routes restricted data to local-only providers", async () => {
      const router = new SmartRouter({
        providers: [localProvider, cloudProvider],
        defaultModel: "cloud/gpt-4",
        dataClassification: "restricted",
      });

      await router.initialize();

      const decision = router.decide({ complexity: "high" });

      expect(decision.provider.isLocal).toBe(true);
      expect(decision.provider).toBe(localProvider);
      expect(decision.reason).toContain("Restricted data");
    });

    it("throws error when restricted data but no local provider available", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider], // Only cloud provider
        defaultModel: "cloud/gpt-4",
        dataClassification: "restricted",
      });

      await router.initialize();

      expect(() => router.decide({ complexity: "medium" })).toThrow(
        /Restricted data requires a local model/
      );
    });
  });

  describe("budget-based routing", () => {
    it("falls back to local when budget nearly exhausted", async () => {
      const router = new SmartRouter({
        providers: [localProvider, cloudProvider],
        defaultModel: "cloud/gpt-4",
        budgetLimit: 1.00,
      });

      await router.initialize();

      // Simulate spending most of the budget
      (router as any).spentUsd = 0.95;

      const decision = router.decide({ complexity: "high" });

      expect(decision.provider.isLocal).toBe(true);
      expect(decision.reason).toContain("Budget nearly exhausted");
    });

    it("uses cloud providers when budget available", async () => {
      const router = new SmartRouter({
        providers: [localProvider, cloudProvider],
        defaultModel: "cloud/gpt-4",
        budgetLimit: 10.00,
      });

      await router.initialize();

      (router as any).spentUsd = 0.50; // Plenty of budget left

      const decision = router.decide({ complexity: "high" });

      // Should use cloud (more capable) when budget allows
      expect(decision.provider).toBe(cloudProvider);
    });
  });

  describe("complexity-based routing", () => {
    it("routes low complexity to cheapest model", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
      });

      await router.initialize();

      const decision = router.decide({ complexity: "low" });

      // Should pick gpt-3.5-turbo (cheaper)
      expect(decision.model).toBe("cloud/gpt-3.5-turbo");
      expect(decision.reason).toContain("low");
    });

    it("routes high complexity to most capable model", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-3.5-turbo",
      });

      await router.initialize();

      const decision = router.decide({ complexity: "high" });

      // Should pick gpt-4 (more expensive = more capable)
      expect(decision.model).toBe("cloud/gpt-4");
      expect(decision.reason).toContain("high");
    });

    it("uses default model for medium complexity", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
      });

      await router.initialize();

      const decision = router.decide({ complexity: "medium" });

      expect(decision.model).toBe("cloud/gpt-4");
    });
  });

  describe("local preference", () => {
    it("prefers local providers when configured", async () => {
      const router = new SmartRouter({
        providers: [localProvider, cloudProvider],
        defaultModel: "cloud/gpt-4",
        preferLocal: true,
      });

      await router.initialize();

      const decision = router.decide({ complexity: "high" });

      expect(decision.provider.isLocal).toBe(true);
      expect(decision.reason).toContain("Local preference");
    });

    it("falls back to cloud when no local provider available", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
        preferLocal: true,
      });

      await router.initialize();

      const decision = router.decide({ complexity: "medium" });

      // No local provider, so must use cloud
      expect(decision.provider).toBe(cloudProvider);
    });
  });

  describe("spending tracking", () => {
    it("tracks spending correctly across multiple calls", async () => {
      cloudProvider.complete = async (messages, options) => {
        return {
          content: "Response",
          model: "cloud/gpt-4",
          tokensUsed: { input: 1000, output: 500, total: 1500 },
          costUsd: 0.06, // 1000 * 0.00003 + 500 * 0.00006
          durationMs: 200,
        };
      };

      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
        budgetLimit: 1.00,
      });

      await router.initialize();

      expect(router.spent).toBe(0);
      expect(router.budgetRemaining).toBe(1.00);

      // Make first call
      await router.route(
        [{ role: "user", content: "Hello" }],
        { complexity: "medium" }
      );

      expect(router.spent).toBe(0.06);
      expect(router.budgetRemaining).toBe(0.94);

      // Make second call
      await router.route(
        [{ role: "user", content: "Hello again" }],
        { complexity: "medium" }
      );

      expect(router.spent).toBe(0.12);
      expect(router.budgetRemaining).toBe(0.88);
    });

    it("returns Infinity for budget remaining when no limit set", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
        // No budgetLimit
      });

      await router.initialize();

      expect(router.budgetRemaining).toBe(Infinity);
    });
  });

  describe("route() integration", () => {
    it("executes complete request through provider", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
      });

      await router.initialize();

      const response = await router.route(
        [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "Hello" },
        ],
        { complexity: "low", temperature: 0.7 }
      );

      expect(response.content).toBeTruthy();
      expect(response.model).toBeTruthy();
      expect(response.tokensUsed.total).toBeGreaterThan(0);

      // Verify provider was called
      expect(cloudProvider.calls).toHaveLength(1);
      expect(cloudProvider.calls[0].messages).toHaveLength(2);
    });

    it("passes through provider options correctly", async () => {
      const router = new SmartRouter({
        providers: [localProvider],
        defaultModel: "local/llama3.2",
      });

      await router.initialize();

      await router.route(
        [{ role: "user", content: "Test" }],
        {
          complexity: "medium",
          temperature: 0.5,
          maxTokens: 1000,
        }
      );

      const call = localProvider.calls[0];
      expect(call.options.temperature).toBe(0.5);
      expect(call.options.maxTokens).toBe(1000);
    });
  });

  describe("fallback behavior", () => {
    it("falls back to default model when routing fails", async () => {
      const router = new SmartRouter({
        providers: [cloudProvider],
        defaultModel: "cloud/gpt-4",
      });

      await router.initialize();

      // Request a model that doesn't exist
      const decision = router.decide({
        complexity: "medium",
      });

      // Should fall back to default
      expect(decision.model).toBe("cloud/gpt-4");
      expect(decision.reason).toContain("default");
    });

    it("uses first available provider as last resort", async () => {
      const router = new SmartRouter({
        providers: [localProvider],
        defaultModel: "nonexistent/model",
      });

      await router.initialize();

      const decision = router.decide({ complexity: "medium" });

      // Should use the only available provider
      expect(decision.provider).toBe(localProvider);
    });
  });

  describe("edge cases", () => {
    it("handles empty provider list", async () => {
      const router = new SmartRouter({
        providers: [],
        defaultModel: "any/model",
      });

      await router.initialize();

      // Should handle gracefully (will throw when trying to route)
      expect(() => router.decide({ complexity: "medium" })).not.toThrow();
    });

    it("auto-initializes on first route if not manually initialized", async () => {
      const router = new SmartRouter({
        providers: [localProvider],
        defaultModel: "local/llama3.2",
      });

      // Don't call initialize()

      const response = await router.route(
        [{ role: "user", content: "Test" }],
        { complexity: "low" }
      );

      expect(response.content).toBeTruthy();
    });

    it("handles providers with no models", async () => {
      const emptyProvider = new MockProvider([]);
      emptyProvider.listModels = async () => [];

      const router = new SmartRouter({
        providers: [emptyProvider, localProvider],
        defaultModel: "local/llama3.2",
      });

      await router.initialize();

      const decision = router.decide({ complexity: "low" });

      // Should use the provider that has models
      expect(decision.provider).toBe(localProvider);
    });
  });
});
