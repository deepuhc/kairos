import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../gemini.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiProvider('test-gemini-key');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('constructor', () => {
    it('sets name and isLocal', () => {
      expect(provider.name).toBe('gemini');
      expect(provider.isLocal).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('returns true when API key is set', async () => {
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false without key', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const noKey = new GeminiProvider('');
      expect(await noKey.isAvailable()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns model catalog', async () => {
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models.find((m) => m.id === 'gemini-2.5-pro')).toBeDefined();
      expect(models.find((m) => m.id === 'gemini-2.5-flash')).toBeDefined();
      expect(models.find((m) => m.id === 'gemini-2.0-flash')).toBeDefined();
    });

    it('all models support vision and long_context', async () => {
      const models = await provider.listModels();
      for (const model of models) {
        expect(model.capabilities).toContain('vision');
        expect(model.capabilities).toContain('long_context');
        expect(model.contextWindow).toBe(1000000);
      }
    });

    it('returns empty when no key', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const noKey = new GeminiProvider('');
      const models = await noKey.listModels();
      expect(models).toEqual([]);
    });
  });

  describe('hasCapability', () => {
    it('reports correct capabilities', () => {
      expect(provider.hasCapability!('gemini-2.5-pro', 'reasoning')).toBe(true);
      expect(provider.hasCapability!('gemini-2.5-pro', 'vision')).toBe(true);
      expect(provider.hasCapability!('gemini-2.5-pro', 'json_mode')).toBe(true);
    });

    it('returns false for unknown model', () => {
      expect(provider.hasCapability!('unknown', 'chat')).toBe(false);
    });
  });

  describe('estimateCost', () => {
    it('estimates cost for flash model', () => {
      const messages = [{ role: 'user' as const, content: 'Hello, tell me about quantum physics' }];
      const cost = provider.estimateCost!(messages, 'gemini-2.5-flash');
      expect(cost.inputCostUsd).toBeGreaterThan(0);
      expect(cost.outputCostUsd).toBeGreaterThan(0);
      expect(cost.totalCostUsd).toBe(cost.inputCostUsd + cost.outputCostUsd);
    });

    it('pro is more expensive than flash', () => {
      const messages = [{ role: 'user' as const, content: 'Hello world' }];
      const proCost = provider.estimateCost!(messages, 'gemini-2.5-pro');
      const flashCost = provider.estimateCost!(messages, 'gemini-2.5-flash');
      expect(proCost.totalCostUsd).toBeGreaterThan(flashCost.totalCostUsd);
    });
  });

  describe('complete', () => {
    it('formats request correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Hi there!' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
      });

      const result = await provider.complete(
        [
          { role: 'system', content: 'Be concise' },
          { role: 'user', content: 'Hello' },
        ],
        { model: 'gemini-2.5-flash', temperature: 0.5 }
      );

      expect(result.content).toBe('Hi there!');
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
      expect(result.finishReason).toBe('stop');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('gemini-2.5-flash:generateContent');
      expect(url).toContain('key=test-gemini-key');

      const body = JSON.parse(opts.body);
      expect(body.systemInstruction).toBeDefined();
      expect(body.systemInstruction.parts[0].text).toBe('Be concise');
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }]);
      expect(body.generationConfig.temperature).toBe(0.5);
    });

    it('handles vision with inline image data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'A cat' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 3 },
        }),
      });

      await provider.complete([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', data: 'base64data', mimeType: 'image/png' },
          ],
        },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents[0].parts).toEqual([
        { text: 'What is this?' },
        { inlineData: { mimeType: 'image/png', data: 'base64data' } },
      ]);
    });

    it('maps assistant role to model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
        }),
      });

      await provider.complete([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents[1].role).toBe('model');
    });

    it('supports JSON mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"name":"test"}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      });

      await provider.complete(
        [{ role: 'user', content: 'Return JSON' }],
        { jsonMode: true }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig.responseMimeType).toBe('application/json');
    });

    it('throws on error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' });
      await expect(provider.complete([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Gemini error: 403');
    });

    it('maps MAX_TOKENS finish reason', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'truncated' }] }, finishReason: 'MAX_TOKENS' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
        }),
      });

      const result = await provider.complete([{ role: 'user', content: 'hi' }]);
      expect(result.finishReason).toBe('length');
    });
  });

  describe('streamChunks', () => {
    it('yields text and usage chunks from SSE', async () => {
      const events = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":10}}',
      ].join('\n') + '\n';

      const encoder = new TextEncoder();
      let readCount = 0;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              if (readCount === 0) {
                readCount++;
                return Promise.resolve({ done: false, value: encoder.encode(events) });
              }
              return Promise.resolve({ done: true, value: undefined });
            }),
          }),
        },
      });

      const chunks: import('../types.js').StreamChunk[] = [];
      for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual({ type: 'text', text: 'Hello' });
      expect(chunks[1]).toEqual({ type: 'text', text: ' world' });
      expect(chunks[2]).toMatchObject({ type: 'usage', inputTokens: 5, outputTokens: 10 });
    });

    it('yields error on failed response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const chunks: import('../types.js').StreamChunk[] = [];
      for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }
      expect(chunks[0]).toMatchObject({ type: 'error' });
    });

    it('uses streaming endpoint', async () => {
      const encoder = new TextEncoder();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      });

      // Consume the generator
      for await (const _ of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {}

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('streamGenerateContent');
      expect(url).toContain('alt=sse');
    });
  });

  describe('stream (legacy)', () => {
    it('yields only text strings', async () => {
      const events = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
      ].join('\n') + '\n';

      const encoder = new TextEncoder();
      let readCount = 0;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              if (readCount === 0) {
                readCount++;
                return Promise.resolve({ done: false, value: encoder.encode(events) });
              }
              return Promise.resolve({ done: true, value: undefined });
            }),
          }),
        },
      });

      const texts: string[] = [];
      for await (const text of provider.stream([{ role: 'user', content: 'hi' }])) {
        texts.push(text);
      }
      expect(texts).toEqual(['Hi', '!']);
    });
  });
});
