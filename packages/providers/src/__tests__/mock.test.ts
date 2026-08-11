import { describe, it, expect } from 'vitest';
import { MockProvider } from '../mock.js';
import { ProviderRegistry } from '../registry.js';
import { SmartRouter } from '../router.js';
import type { Message } from '../types.js';

const ask = (text: string): Message[] => [{ role: 'user', content: text }];

describe('MockProvider — contract', () => {
  it('is available and local by default', async () => {
    const p = new MockProvider();
    expect(p.name).toBe('mock');
    expect(p.isLocal).toBe(true);
    expect(await p.isAvailable()).toBe(true);
  });

  it('lists at least one model and reports zero cost', async () => {
    const p = new MockProvider();
    const models = await p.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === 'mock')).toBe(true);
    expect(p.estimateCost().totalCostUsd).toBe(0);
  });

  it('reports no models when configured unavailable', async () => {
    const p = new MockProvider({ available: false });
    expect(await p.isAvailable()).toBe(false);
    expect(await p.listModels()).toEqual([]);
  });

  it('answers hasCapability from the model list', () => {
    const p = new MockProvider();
    expect(p.hasCapability('mock-smart', 'reasoning')).toBe(true);
    expect(p.hasCapability('mock-fast', 'reasoning')).toBe(false);
    expect(p.hasCapability('nonexistent', 'chat')).toBe(false);
  });

  it('produces a deterministic, prompt-aware completion', async () => {
    const p = new MockProvider();
    const a = await p.complete(ask('hello there'));
    const b = await p.complete(ask('hello there'));
    expect(a.content).toBe(b.content);
    expect(a.content).toContain('hello there');
    expect(a.finishReason).toBe('stop');
    expect(a.usage?.totalCostUsd).toBe(0);
  });

  it('honors an explicit model id', async () => {
    const p = new MockProvider();
    const r = await p.complete(ask('x'), { model: 'mock-smart' });
    expect(r.model).toBe('mock-smart');
  });

  it('emits thinking when requested', async () => {
    const p = new MockProvider();
    const r = await p.complete(ask('x'), { thinking: true });
    expect(r.thinking).toBeTruthy();
  });

  it('streams the completion word by word then a usage chunk', async () => {
    const p = new MockProvider();
    const chunks: string[] = [];
    let sawUsage = false;
    for await (const c of p.streamChunks(ask('one two three'))) {
      if (c.type === 'text') chunks.push(c.text);
      if (c.type === 'usage') sawUsage = true;
    }
    expect(chunks.join('')).toBe((await p.complete(ask('one two three'))).content);
    expect(sawUsage).toBe(true);
  });

  it('stops streaming and emits an error when the signal is aborted', async () => {
    const p = new MockProvider({ streamDelayMs: 5 });
    const ac = new AbortController();
    ac.abort();
    const types: string[] = [];
    for await (const c of p.streamChunks(ask('a b c d'), { signal: ac.signal })) {
      types.push(c.type);
    }
    expect(types).toContain('error');
    expect(types).not.toContain('usage');
  });

  it('extracts text from multi-part content', async () => {
    const p = new MockProvider();
    const r = await p.complete([
      { role: 'user', content: [{ type: 'text', text: 'part one' }] },
    ]);
    expect(r.content).toContain('part one');
  });
});

describe('MockProvider — registry + router integration', () => {
  it('is registered only when RegistryConfig.mock is set', async () => {
    const withMock = new ProviderRegistry({ mock: true });
    expect(withMock.getProvider('mock')).toBeInstanceOf(MockProvider);

    const withoutMock = new ProviderRegistry({});
    expect(withoutMock.getProvider('mock')).toBeUndefined();
  });

  it('lets the router complete end-to-end with no network', async () => {
    const registry = new ProviderRegistry({ mock: true });
    for (const name of ['ollama', 'anthropic', 'openai', 'gemini']) {
      registry.removeProvider(name);
    }
    const router = new SmartRouter(registry);
    const result = await router.complete(ask('run the pipeline'));
    expect(result.model).toMatch(/^mock-/);
    expect(result.content).toContain('run the pipeline');
  });
});
