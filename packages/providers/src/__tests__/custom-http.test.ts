import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomHttpProvider, type CustomHttpConfig } from '../custom-http.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('CustomHttpProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Ollama type', () => {
    let provider: CustomHttpProvider;
    const config: CustomHttpConfig = {
      name: 'home-server',
      baseUrl: 'http://192.168.1.200:11434',
      type: 'ollama',
      isLocal: true,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      provider = new CustomHttpProvider(config);
    });

    it('sets name and isLocal from config', () => {
      expect(provider.name).toBe('home-server');
      expect(provider.isLocal).toBe(true);
    });

    describe('isAvailable', () => {
      it('checks /api/tags for Ollama type', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });
        expect(await provider.isAvailable()).toBe(true);
        expect(mockFetch.mock.calls[0][0]).toBe('http://192.168.1.200:11434/api/tags');
      });

      it('returns false on network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('timeout'));
        expect(await provider.isAvailable()).toBe(false);
      });
    });

    describe('listModels', () => {
      it('parses Ollama model list', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3:8b', size: 4000000000 },
              { name: 'deepseek-coder-v2:16b', size: 9000000000 },
            ],
          }),
        });

        const models = await provider.listModels();
        expect(models).toHaveLength(2);
        expect(models[0].provider).toBe('home-server');
        expect(models[0].isLocal).toBe(true);
        expect(models[1].capabilities).toContain('code');
      });
    });

    describe('complete', () => {
      it('uses Ollama chat endpoint', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: { content: 'response' },
            eval_count: 20,
            prompt_eval_count: 10,
          }),
        });

        const result = await provider.complete(
          [{ role: 'user', content: 'Hello' }],
          { model: 'llama3:8b' }
        );

        expect(result.content).toBe('response');
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe('http://192.168.1.200:11434/api/chat');
        const body = JSON.parse(opts.body);
        expect(body.model).toBe('llama3:8b');
        expect(body.stream).toBe(false);
      });

      it('handles multi-modal with images', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: { content: 'cat' }, eval_count: 5, prompt_eval_count: 100 }),
        });

        await provider.complete([
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe' },
              { type: 'image', data: 'img64', mimeType: 'image/png' },
            ],
          },
        ]);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.messages[0].images).toEqual(['img64']);
      });

      it('uses default model from config', async () => {
        const p = new CustomHttpProvider({ ...config, defaultModel: 'phi3:mini' });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: { content: 'ok' }, eval_count: 1, prompt_eval_count: 1 }),
        });

        await p.complete([{ role: 'user', content: 'hi' }]);
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.model).toBe('phi3:mini');
      });
    });

    describe('streamChunks', () => {
      it('yields text and usage from Ollama stream', async () => {
        const lines = [
          JSON.stringify({ message: { content: 'Hey' }, done: false }),
          JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 3 }),
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

        const chunks: import('../types.js').StreamChunk[] = [];
        for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {
          chunks.push(chunk);
        }

        expect(chunks[0]).toEqual({ type: 'text', text: 'Hey' });
        expect(chunks[1]).toEqual({ type: 'usage', inputTokens: 5, outputTokens: 3 });
      });
    });

    describe('estimateCost', () => {
      it('returns zero for local provider', () => {
        const cost = provider.estimateCost!([{ role: 'user', content: 'hi' }]);
        expect(cost.totalCostUsd).toBe(0);
      });
    });

    describe('hasCapability', () => {
      it('infers from model name', () => {
        expect(provider.hasCapability!('deepseek-r1:14b', 'reasoning')).toBe(true);
        expect(provider.hasCapability!('codellama:7b', 'code')).toBe(true);
        expect(provider.hasCapability!('llava:13b', 'vision')).toBe(true);
        expect(provider.hasCapability!('qwen2.5:7b', 'tool_calling')).toBe(true);
        expect(provider.hasCapability!('llama3:8b', 'reasoning')).toBe(false);
      });
    });
  });

  describe('OpenAI-compatible type', () => {
    let provider: CustomHttpProvider;
    const config: CustomHttpConfig = {
      name: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      type: 'openai-compatible',
      isLocal: true,
      defaultModel: 'local-model',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      provider = new CustomHttpProvider(config);
    });

    describe('isAvailable', () => {
      it('checks /models for OpenAI type', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });
        await provider.isAvailable();
        expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:1234/v1/models');
      });
    });

    describe('listModels', () => {
      it('parses OpenAI model list format', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [{ id: 'llama-3-8b', owned_by: 'local' }] }),
        });

        const models = await provider.listModels();
        expect(models).toHaveLength(1);
        expect(models[0].provider).toBe('lmstudio');
      });
    });

    describe('complete', () => {
      it('uses OpenAI chat/completions endpoint', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'reply' }, finish_reason: 'stop' }],
            model: 'local-model',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        });

        const result = await provider.complete([{ role: 'user', content: 'hi' }]);
        expect(result.content).toBe('reply');
        expect(result.model).toBe('local-model');

        const url = mockFetch.mock.calls[0][0];
        expect(url).toBe('http://localhost:1234/v1/chat/completions');
      });

      it('supports JSON mode', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
            model: 'local-model',
          }),
        });

        await provider.complete([{ role: 'user', content: 'json' }], { jsonMode: true });
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.response_format).toEqual({ type: 'json_object' });
      });
    });

    describe('streamChunks', () => {
      it('parses SSE OpenAI format', async () => {
        const events = [
          'data: {"choices":[{"delta":{"content":"Hi"}}]}',
          'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
          'data: [DONE]',
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

        expect(chunks[0]).toEqual({ type: 'text', text: 'Hi' });
        expect(chunks[1]).toEqual({ type: 'text', text: '!' });
        expect(chunks[2]).toEqual({ type: 'usage', inputTokens: 5, outputTokens: 2 });
      });
    });
  });

  describe('Auth headers', () => {
    it('sends bearer token', async () => {
      const provider = new CustomHttpProvider({
        name: 'authed',
        baseUrl: 'http://example.com',
        type: 'openai-compatible',
        isLocal: false,
        auth: { type: 'bearer', token: 'mytoken123' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });
      await provider.listModels();
      const headers = mockFetch.mock.calls[0][1]?.headers || {};
      expect(headers['Authorization']).toBe('Bearer mytoken123');
    });

    it('sends basic auth', async () => {
      const provider = new CustomHttpProvider({
        name: 'basic-auth',
        baseUrl: 'http://example.com',
        type: 'openai-compatible',
        isLocal: false,
        auth: { type: 'basic', token: 'dXNlcjpwYXNz' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });
      await provider.listModels();
      const headers = mockFetch.mock.calls[0][1]?.headers || {};
      expect(headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
    });

    it('sends x-api-key header', async () => {
      const provider = new CustomHttpProvider({
        name: 'apikey',
        baseUrl: 'http://example.com',
        type: 'openai-compatible',
        isLocal: false,
        auth: { type: 'api-key', token: 'sk-123' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });
      await provider.listModels();
      const headers = mockFetch.mock.calls[0][1]?.headers || {};
      expect(headers['x-api-key']).toBe('sk-123');
    });

    it('sends no auth when not configured', async () => {
      const provider = new CustomHttpProvider({
        name: 'noauth',
        baseUrl: 'http://localhost:11434',
        type: 'ollama',
        isLocal: true,
      });

      mockFetch.mockResolvedValueOnce({ ok: true });
      await provider.isAvailable();
      const headers = mockFetch.mock.calls[0][1]?.headers || {};
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['x-api-key']).toBeUndefined();
    });
  });
});
