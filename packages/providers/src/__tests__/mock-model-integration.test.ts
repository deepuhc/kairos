import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import { SmartRouter } from '../router.js';
import type {
  Provider, ModelInfo, Message, CompletionOptions, CompletionResult, StreamChunk,
} from '../types.js';

// A fully in-memory fake model provider. It implements the same Provider
// contract the real Anthropic/Ollama/OpenAI providers do, so wiring it through
// the real ProviderRegistry + SmartRouter exercises the actual connection path
// (discover → list models → route → complete/stream) with deterministic,
// network-free "AI" responses. `calls` records what the router forwarded so we
// can assert options (model, thinking, effort) reach the model unchanged.
class MockModelProvider implements Provider {
  readonly name = 'mock';
  readonly isLocal: boolean;
  available = true;
  calls: Array<{ messages: Message[]; options?: CompletionOptions }> = [];
  private model: ModelInfo;

  constructor(opts?: { isLocal?: boolean; model?: Partial<ModelInfo> }) {
    this.isLocal = opts?.isLocal ?? false;
    this.model = {
      id: 'mock-1',
      name: 'Mock 1',
      provider: 'mock',
      isLocal: this.isLocal,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      costPerMillionInput: 1,
      costPerMillionOutput: 5,
      capabilities: ['chat', 'code', 'reasoning', 'streaming'],
      ...opts?.model,
    };
  }

  async isAvailable() { return this.available; }
  async listModels() { return this.available ? [this.model] : []; }
  hasCapability(id: string, cap: ModelInfo['capabilities'][number]) {
    return id === this.model.id && this.model.capabilities.includes(cap);
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    this.calls.push({ messages, options });
    const last = messages[messages.length - 1];
    const prompt = typeof last.content === 'string' ? last.content : '';
    return {
      content: `echo: ${prompt}`,
      model: options?.model || this.model.id,
      usage: { inputTokens: 7, outputTokens: 3, totalCostUsd: 0.0001 },
      finishReason: 'stop',
      ...(options?.thinking ? { thinking: 'considered it' } : {}),
    };
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    for await (const chunk of this.streamChunks(messages, options)) {
      if (chunk.type === 'text') yield chunk.text;
    }
  }

  async *streamChunks(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    this.calls.push({ messages, options });
    if (options?.thinking) yield { type: 'thinking', text: 'considered it' };
    yield { type: 'text', text: 'Hello' };
    yield { type: 'text', text: ', world' };
    yield { type: 'usage', inputTokens: 7, outputTokens: 3, totalCostUsd: 0.0001 };
  }
}

describe('mocked model connection (registry + router integration)', () => {
  let registry: ProviderRegistry;
  let mock: MockModelProvider;
  let router: SmartRouter;

  beforeEach(() => {
    // Strip the built-in providers so the mock is the ONLY one in play — the
    // CI/dev environment may carry real API keys (GEMINI_API_KEY, etc.) that
    // would otherwise make a real provider "available" and fire a network call.
    registry = new ProviderRegistry({});
    for (const name of ['ollama', 'anthropic', 'openai', 'gemini']) {
      registry.removeProvider(name);
    }
    mock = new MockModelProvider();
    registry.addProvider(mock);
    router = new SmartRouter(registry);
  });

  it('discovers only the available mock model', async () => {
    const available = await registry.discoverAvailable();
    expect(available.map((p) => p.name)).toContain('mock');
    const models = await registry.listAllModels();
    expect(models.some((m) => m.id === 'mock-1')).toBe(true);
  });

  it('does not surface a model whose provider is unavailable', async () => {
    mock.available = false;
    const models = await registry.listAllModels();
    expect(models).toEqual([]);
    await expect(router.complete([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('No available models');
  });

  it('routes a completion to the mock model and returns its response', async () => {
    const result = await router.complete([{ role: 'user', content: 'ping' }]);
    expect(result.content).toBe('echo: ping');
    expect(result.model).toBe('mock-1');
    expect(result.usage?.totalCostUsd).toBeCloseTo(0.0001);
    // The router selected and forwarded to the mock exactly once.
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].options?.model).toBe('mock-1');
  });

  it('forwards reasoning options (thinking/effort) through the router to the model', async () => {
    const result = await router.complete(
      [{ role: 'user', content: 'ponder' }],
      { thinking: true, effort: 'high' } as CompletionOptions & { thinking: boolean; effort: string },
    );
    expect(result.thinking).toBe('considered it');
    expect(mock.calls[0].options?.thinking).toBe(true);
    expect(mock.calls[0].options?.effort).toBe('high');
  });

  it('streams incremental chunks from the mock model', async () => {
    const texts: string[] = [];
    for await (const t of router.stream([{ role: 'user', content: 'hi' }])) {
      texts.push(t);
    }
    expect(texts).toEqual(['Hello', ', world']);
  });

  it('honors an explicit model id when the caller pins one', async () => {
    registry.addProvider(new MockModelProvider({ model: { id: 'mock-2', name: 'Mock 2' } }));
    const result = await router.complete([{ role: 'user', content: 'x' }], { model: 'mock-2' });
    expect(result.model).toBe('mock-2');
  });

  it('prefers a local mock model when preferLocal is set', async () => {
    registry.addProvider(new MockModelProvider({ isLocal: true, model: { id: 'local-1', name: 'Local', provider: 'mock', isLocal: true } as Partial<ModelInfo> }));
    const localRouter = new SmartRouter(registry, { preferLocal: true });
    const selection = await localRouter.selectModel();
    expect(selection?.model.isLocal).toBe(true);
  });
});
