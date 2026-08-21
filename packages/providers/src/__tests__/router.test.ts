import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmartRouter } from '../router.js';
import { ProviderRegistry } from '../registry.js';
import type { ModelInfo } from '../types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('SmartRouter', () => {
  let registry: ProviderRegistry;
  let router: SmartRouter;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock: Ollama available with local models, Anthropic available with cloud models
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'qwen2.5:7b', size: 4000000000 },
              { name: 'deepseek-r1:14b', size: 8000000000 },
            ],
          }),
        });
      }
      return Promise.reject(new Error('unavailable'));
    });

    registry = new ProviderRegistry({
      anthropic: { apiKey: 'test-key' },
    });
    router = new SmartRouter(registry);
  });

  describe('selectModel', () => {
    it('selects a model when available', async () => {
      const selection = await router.selectModel();
      expect(selection).not.toBeNull();
      expect(selection!.model).toBeDefined();
      expect(selection!.provider).toBeDefined();
    });

    it('prefers local models when preferLocal is set', async () => {
      const localRouter = new SmartRouter(registry, { preferLocal: true });
      const selection = await localRouter.selectModel();
      expect(selection!.model.isLocal).toBe(true);
    });

    it('returns null when requireLocal and no local models', async () => {
      // Override: Ollama unavailable
      mockFetch.mockRejectedValue(new Error('down'));
      const freshRegistry = new ProviderRegistry();
      const freshRouter = new SmartRouter(freshRegistry);
      const selection = await freshRouter.selectModel({ requireLocal: true });
      expect(selection).toBeNull();
    });

    it('routes high complexity to reasoning models', async () => {
      const selection = await router.selectModel({ complexity: 'high' });
      // Should find deepseek-r1 which has reasoning capability
      if (selection) {
        expect(
          selection.model.capabilities?.includes('reasoning') ||
          (selection.model.costPerMillionOutput && selection.model.costPerMillionOutput > 10)
        ).toBe(true);
      }
    });

    it('routes low complexity to cheap/local models', async () => {
      const selection = await router.selectModel({ complexity: 'low' });
      if (selection) {
        expect(selection.model.isLocal || (selection.model.costPerMillionInput && selection.model.costPerMillionInput < 2)).toBe(true);
      }
    });

    it('respects budget constraints', async () => {
      const budgetRouter = new SmartRouter(registry, { maxBudgetUsd: 1.0, spentUsd: 1.0 });
      const selection = await budgetRouter.selectModel();
      // Over budget — should only pick free (local) models
      if (selection) {
        expect(selection.model.isLocal).toBe(true);
      }
    });

    it('uses defaultModel when specified', async () => {
      const defaultRouter = new SmartRouter(registry, { defaultModel: 'qwen2.5:7b' });
      const selection = await defaultRouter.selectModel();
      expect(selection!.model.id).toBe('qwen2.5:7b');
    });

    it('only returns a vision-capable model when requireCapability is vision', async () => {
      // The registry has local Ollama models (no vision) + Anthropic Claude
      // models (vision). Requiring vision must exclude the text-only locals.
      const selection = await router.selectModel({ requireCapability: 'vision' });
      expect(selection).not.toBeNull();
      const model = selection!.model;
      expect(model.capabilities?.includes('vision') || model.supportsVision).toBe(true);
    });

    it('returns null for requireCapability when no model advertises it', async () => {
      // Build a registry whose only available model is text-only, so the result
      // is deterministic regardless of any provider API keys in the environment.
      const textOnly: ModelInfo = {
        id: 'text-model', name: 'Text Only', provider: 'fake', isLocal: true,
        capabilities: ['chat', 'code'],
      };
      const fakeProvider = {
        name: 'fake', isLocal: true,
        isAvailable: async () => true,
        listModels: async () => [textOnly],
        complete: async () => ({ content: '', model: 'text-model' }),
        async *stream() {},
      };
      const emptyRegistry = new ProviderRegistry({});
      for (const p of [...emptyRegistry.all]) emptyRegistry.removeProvider(p.name);
      emptyRegistry.addProvider(fakeProvider);
      const fakeRouter = new SmartRouter(emptyRegistry);

      expect(await fakeRouter.selectModel()).not.toBeNull(); // text model IS selectable
      expect(await fakeRouter.selectModel({ requireCapability: 'vision' })).toBeNull();
    });
  });

  describe('complete', () => {
    it('delegates to selected provider', async () => {
      // Mock the actual completion call
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (typeof url === 'string' && url.includes('api/chat')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              message: { content: 'routed response' },
              eval_count: 10,
              prompt_eval_count: 5,
            }),
          });
        }
        if (typeof url === 'string' && url.includes('api/tags')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [{ name: 'qwen2.5:7b' }] }),
          });
        }
        return Promise.reject(new Error('unavailable'));
      });

      const result = await router.complete([{ role: 'user', content: 'hello' }]);
      expect(result.content).toBe('routed response');
    });

    it('throws when no models available', async () => {
      // Ensure no env-based API keys are picked up
      const savedGemini = process.env.GEMINI_API_KEY;
      const savedGoogle = process.env.GOOGLE_API_KEY;
      const savedOpenAI = process.env.OPENAI_API_KEY;
      const savedAnthropic = process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      // Mock all fetches to reject so Ollama is unreachable
      mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
      const emptyRegistry = new ProviderRegistry({});
      const emptyRouter = new SmartRouter(emptyRegistry);
      await expect(emptyRouter.complete([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('No available models');

      // Restore
      if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
      if (savedGoogle) process.env.GOOGLE_API_KEY = savedGoogle;
      if (savedOpenAI) process.env.OPENAI_API_KEY = savedOpenAI;
      if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
    });
  });

  describe('stream', () => {
    it('delegates to selected provider stream', async () => {
      const lines = [
        JSON.stringify({ message: { content: 'streamed' }, done: false }),
        JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 1, eval_count: 1 }),
      ].join('\n') + '\n';

      const encoder = new TextEncoder();
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('api/chat')) {
          let readCount = 0;
          return Promise.resolve({
            ok: true,
            body: {
              getReader: () => ({
                read: vi.fn().mockImplementation(() => {
                  if (readCount === 0) {
                    readCount++;
                    return Promise.resolve({ done: false, value: encoder.encode(lines) });
                  }
                  return Promise.resolve({ done: true, value: undefined });
                }),
              }),
            },
          });
        }
        if (typeof url === 'string' && url.includes('api/tags')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [{ name: 'qwen2.5:7b' }] }),
          });
        }
        return Promise.reject(new Error('unavailable'));
      });

      const texts: string[] = [];
      for await (const text of router.stream([{ role: 'user', content: 'hi' }])) {
        texts.push(text);
      }
      expect(texts).toContain('streamed');
    });
  });
});
