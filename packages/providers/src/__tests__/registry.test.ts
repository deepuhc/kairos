import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('ProviderRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make Ollama available, others not
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('localhost:11434')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ name: 'qwen2.5:7b', size: 4000000000 }],
          }),
        });
      }
      // All other endpoints unavailable
      return Promise.reject(new Error('not available'));
    });
  });

  describe('constructor', () => {
    it('creates default providers', () => {
      const registry = new ProviderRegistry();
      expect(registry.all.length).toBeGreaterThanOrEqual(4); // ollama, anthropic, openai, gemini
    });

    it('creates custom providers from config', () => {
      const registry = new ProviderRegistry({
        custom: [
          { name: 'remote-ollama', baseUrl: 'http://10.0.0.5:11434', type: 'ollama', isLocal: true },
        ],
      });
      expect(registry.getProvider('remote-ollama')).toBeDefined();
    });
  });

  describe('discoverAvailable', () => {
    it('returns only available providers', async () => {
      const registry = new ProviderRegistry();
      const available = await registry.discoverAvailable();
      // Only Ollama responds to our mock
      expect(available.some((p) => p.name === 'ollama')).toBe(true);
    });
  });

  describe('listAllModels', () => {
    it('aggregates models from available providers', async () => {
      const registry = new ProviderRegistry();
      const models = await registry.listAllModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].provider).toBe('ollama');
    });
  });

  describe('getProvider', () => {
    it('finds provider by name', () => {
      const registry = new ProviderRegistry();
      expect(registry.getProvider('ollama')).toBeDefined();
      expect(registry.getProvider('anthropic')).toBeDefined();
      expect(registry.getProvider('gemini')).toBeDefined();
    });

    it('returns undefined for unknown name', () => {
      const registry = new ProviderRegistry();
      expect(registry.getProvider('nonexistent')).toBeUndefined();
    });
  });

  describe('getProviderForModel', () => {
    it('finds provider for known model', async () => {
      const registry = new ProviderRegistry();
      const models = await registry.listAllModels();
      const provider = registry.getProviderForModel(models[0].id, models);
      expect(provider).toBeDefined();
      expect(provider!.name).toBe(models[0].provider);
    });

    it('returns undefined for unknown model', () => {
      const registry = new ProviderRegistry();
      expect(registry.getProviderForModel('nonexistent', [])).toBeUndefined();
    });
  });

  describe('addProvider', () => {
    it('adds a new provider dynamically', () => {
      const registry = new ProviderRegistry();
      const initialCount = registry.all.length;
      registry.addProvider({
        name: 'test-provider',
        isLocal: true,
        isAvailable: async () => true,
        listModels: async () => [],
        complete: async () => ({ content: '', model: 'test' }),
        stream: async function* () {},
      });
      expect(registry.all.length).toBe(initialCount + 1);
      expect(registry.getProvider('test-provider')).toBeDefined();
    });
  });

  describe('removeProvider', () => {
    it('removes provider by name', () => {
      const registry = new ProviderRegistry();
      const initialCount = registry.all.length;
      registry.removeProvider('gemini');
      expect(registry.all.length).toBe(initialCount - 1);
      expect(registry.getProvider('gemini')).toBeUndefined();
    });

    it('no-op for unknown provider', () => {
      const registry = new ProviderRegistry();
      const initialCount = registry.all.length;
      registry.removeProvider('nonexistent');
      expect(registry.all.length).toBe(initialCount);
    });
  });

  describe('discovery caching', () => {
    // A registry with no default providers so we can count probes exactly.
    function probeSpyRegistry(ttlMs?: number) {
      const registry = new ProviderRegistry({ discoveryTtlMs: ttlMs });
      for (const p of [...registry.all]) registry.removeProvider(p.name);
      const isAvailable = vi.fn(async () => true);
      registry.addProvider({
        name: 'spy',
        isLocal: true,
        isAvailable,
        listModels: async () => [],
        complete: async () => ({ content: '', model: 'spy-1' }),
        stream: async function* () {},
      });
      return { registry, isAvailable };
    }

    it('reuses the cached probe within the TTL window', async () => {
      const { registry, isAvailable } = probeSpyRegistry(5000);
      await registry.discoverAvailable();
      await registry.discoverAvailable();
      await registry.listAllModels(); // also goes through discoverAvailable
      expect(isAvailable).toHaveBeenCalledTimes(1);
    });

    it('re-probes after the TTL expires', async () => {
      const nowSpy = vi.spyOn(Date, 'now');
      try {
        const { registry, isAvailable } = probeSpyRegistry(5000);
        nowSpy.mockReturnValue(1_000);
        await registry.discoverAvailable();
        nowSpy.mockReturnValue(1_000 + 5001); // past TTL
        await registry.discoverAvailable();
        expect(isAvailable).toHaveBeenCalledTimes(2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('re-probes on every call when TTL is 0', async () => {
      const { registry, isAvailable } = probeSpyRegistry(0);
      await registry.discoverAvailable();
      await registry.discoverAvailable();
      expect(isAvailable).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache when a provider is added', async () => {
      const { registry, isAvailable } = probeSpyRegistry(5000);
      await registry.discoverAvailable();
      registry.addProvider({
        name: 'spy2',
        isLocal: true,
        isAvailable: async () => true,
        listModels: async () => [],
        complete: async () => ({ content: '', model: 'x' }),
        stream: async function* () {},
      });
      await registry.discoverAvailable();
      expect(isAvailable).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache when a provider is removed', async () => {
      const { registry, isAvailable } = probeSpyRegistry(5000);
      await registry.discoverAvailable();
      registry.removeProvider('spy2'); // unknown, but still invalidates
      await registry.discoverAvailable();
      expect(isAvailable).toHaveBeenCalledTimes(2);
    });
  });
});
