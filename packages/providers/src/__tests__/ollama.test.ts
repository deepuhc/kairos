import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../ollama.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OllamaProvider('http://localhost:11434');
  });

  describe('constructor', () => {
    it('uses default base URL', () => {
      const p = new OllamaProvider();
      expect(p.name).toBe('ollama');
      expect(p.isLocal).toBe(true);
    });

    it('accepts custom base URL', () => {
      const p = new OllamaProvider('http://192.168.1.100:11434');
      expect(p.isLocal).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('returns true when Ollama responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await provider.isAvailable()).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('returns false when Ollama is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns parsed model list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'qwen2.5:7b', size: 4000000000 },
            { name: 'deepseek-r1:14b', size: 8000000000 },
            { name: 'codellama:13b', size: 7000000000 },
          ],
        }),
      });

      const models = await provider.listModels();
      expect(models).toHaveLength(3);
      expect(models[0]).toMatchObject({
        id: 'qwen2.5:7b',
        name: 'qwen2.5',
        provider: 'ollama',
        isLocal: true,
      });
      expect(models[0].capabilities).toContain('tool_calling'); // qwen
      expect(models[1].capabilities).toContain('reasoning'); // r1
      expect(models[2].capabilities).toContain('code'); // codellama
    });

    it('returns empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await provider.listModels()).toEqual([]);
    });

    it('handles missing models field', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      expect(await provider.listModels()).toEqual([]);
    });
  });

  describe('hasCapability', () => {
    it('detects code models', () => {
      expect(provider.hasCapability('codellama:13b', 'code')).toBe(true);
      expect(provider.hasCapability('codellama:13b', 'vision')).toBe(false);
    });

    it('detects reasoning models', () => {
      expect(provider.hasCapability('deepseek-r1:14b', 'reasoning')).toBe(true);
    });

    it('detects vision models', () => {
      expect(provider.hasCapability('llava:7b', 'vision')).toBe(true);
    });

    it('all models have chat and streaming', () => {
      expect(provider.hasCapability('anything', 'chat')).toBe(true);
      expect(provider.hasCapability('anything', 'streaming')).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('always returns zero (local)', () => {
      const cost = provider.estimateCost!();
      expect(cost.totalCostUsd).toBe(0);
    });
  });

  describe('complete', () => {
    it('sends correct request and parses response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Hello from Ollama!' },
          eval_count: 15,
          prompt_eval_count: 10,
        }),
      });

      const result = await provider.complete(
        [{ role: 'user', content: 'Hi' }],
        { model: 'qwen2.5:7b', temperature: 0.5 }
      );

      expect(result.content).toBe('Hello from Ollama!');
      expect(result.model).toBe('qwen2.5:7b');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 15 });
      expect(result.finishReason).toBe('stop');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('qwen2.5:7b');
      expect(body.stream).toBe(false);
      expect(body.options.temperature).toBe(0.5);
    });

    it('handles multi-modal messages with images', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'A cat' }, eval_count: 5, prompt_eval_count: 100 }),
      });

      await provider.complete([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', data: 'base64img', mimeType: 'image/png' },
          ],
        },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toBe('What is this?');
      expect(body.messages[0].images).toEqual(['base64img']);
    });

    it('throws on error response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Internal error' });
      await expect(provider.complete([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Ollama error: 500');
    });

    it('defaults to mistral model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'ok' }, eval_count: 1, prompt_eval_count: 1 }),
      });
      await provider.complete([{ role: 'user', content: 'hi' }]);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('mistral');
    });
  });

  describe('streamChunks', () => {
    it('yields text and usage chunks', async () => {
      const lines = [
        JSON.stringify({ message: { content: 'Hello' }, done: false }),
        JSON.stringify({ message: { content: ' world' }, done: false }),
        JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 10 }),
      ].join('\n') + '\n';

      const encoder = new TextEncoder();
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (readCount === 0) {
            readCount++;
            return Promise.resolve({ done: false, value: encoder.encode(lines) });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: import('../types.js').StreamChunk[] = [];
      for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
        { type: 'usage', inputTokens: 5, outputTokens: 10 },
      ]);
    });

    it('yields error chunk on failed response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const chunks: import('../types.js').StreamChunk[] = [];
      for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([{ type: 'error', message: 'Ollama stream error: 503' }]);
    });
  });

  describe('stream (legacy)', () => {
    it('yields only text content', async () => {
      const lines = [
        JSON.stringify({ message: { content: 'Hi' }, done: false }),
        JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 1, eval_count: 1 }),
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
                return Promise.resolve({ done: false, value: encoder.encode(lines) });
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
      expect(texts).toEqual(['Hi']);
    });
  });
});
