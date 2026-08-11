import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../anthropic.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider('test-api-key');
  });

  describe('constructor', () => {
    it('sets name and isLocal', () => {
      expect(provider.name).toBe('anthropic');
      expect(provider.isLocal).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('returns true when API key is set', async () => {
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when API key is empty', async () => {
      const noKey = new AnthropicProvider('');
      expect(await noKey.isAvailable()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns model catalog when key present', async () => {
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models.find((m) => m.id.includes('opus'))).toBeDefined();
      expect(models.find((m) => m.id.includes('sonnet'))).toBeDefined();
      expect(models.find((m) => m.id.includes('haiku'))).toBeDefined();
    });

    it('all models have vision capability', async () => {
      const models = await provider.listModels();
      for (const model of models) {
        expect(model.capabilities).toContain('vision');
      }
    });

    it('returns empty when no key', async () => {
      const noKey = new AnthropicProvider('');
      expect(await noKey.listModels()).toEqual([]);
    });
  });

  describe('hasCapability', () => {
    it('correctly reports capabilities', () => {
      expect(provider.hasCapability!('claude-opus-4-8', 'reasoning')).toBe(true);
      expect(provider.hasCapability!('claude-opus-4-8', 'vision')).toBe(true);
      expect(provider.hasCapability!('claude-haiku-4-5', 'reasoning')).toBe(false);
    });

    it('returns false for unknown model', () => {
      expect(provider.hasCapability!('unknown-model', 'chat')).toBe(false);
    });
  });

  describe('estimateCost', () => {
    it('estimates cost for messages', () => {
      const messages = [{ role: 'user' as const, content: 'Hello world, how are you?' }];
      const cost = provider.estimateCost!(messages, 'claude-sonnet-5');
      expect(cost.inputCostUsd).toBeGreaterThan(0);
      expect(cost.outputCostUsd).toBeGreaterThan(0);
      expect(cost.totalCostUsd).toBe(cost.inputCostUsd + cost.outputCostUsd);
    });

    it('handles multi-modal messages', () => {
      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Describe this image' },
            { type: 'image' as const, data: 'base64', mimeType: 'image/png' as const },
          ],
        },
      ];
      const cost = provider.estimateCost!(messages, 'claude-sonnet-5');
      expect(cost.totalCostUsd).toBeGreaterThan(0);
    });

    it('returns zero for unknown model', () => {
      const cost = provider.estimateCost!([{ role: 'user', content: 'hi' }], 'unknown');
      expect(cost.totalCostUsd).toBe(0);
    });
  });

  describe('complete', () => {
    it('sends correct headers and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello!' }],
          model: 'claude-sonnet-5',
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      });

      const result = await provider.complete(
        [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hi' },
        ],
        { temperature: 0.3 }
      );

      expect(result.content).toBe('Hello!');
      expect(result.usage?.totalCostUsd).toBeGreaterThan(0);
      expect(result.finishReason).toBe('stop');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/v1/messages');
      expect(opts.headers['x-api-key']).toBe('test-api-key');
      expect(opts.headers['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse(opts.body);
      expect(body.system).toBe('Be helpful');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
      expect(body.temperature).toBe(0.3);
    });

    it('handles multi-modal content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'A cat' }],
          model: 'claude-sonnet-5',
          usage: { input_tokens: 100, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      });

      await provider.complete([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', data: 'imgdata', mimeType: 'image/jpeg' },
          ],
        },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'What is this?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'imgdata' } },
      ]);
    });

    it('extracts thinking content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', text: 'Let me think...' },
            { type: 'text', text: 'The answer is 42' },
          ],
          model: 'claude-opus-4-8',
          usage: { input_tokens: 10, output_tokens: 20 },
          stop_reason: 'end_turn',
        }),
      });

      const result = await provider.complete([{ role: 'user', content: 'Think about it' }]);
      expect(result.content).toBe('The answer is 42');
      expect(result.thinking).toBe('Let me think...');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limited' });
      await expect(provider.complete([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Anthropic error: 429');
    });

    it('defaults to claude-opus-4-8 when no model is given', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
      });
      await provider.complete([{ role: 'user', content: 'hi' }]);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-opus-4-8');
    });

    it('omits thinking and output_config by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
      });
      await provider.complete([{ role: 'user', content: 'hi' }]);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('thinking');
      expect(body).not.toHaveProperty('output_config');
    });

    it('sends adaptive thinking (never the deprecated enabled/budget_tokens shape)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
      });
      await provider.complete([{ role: 'user', content: 'hi' }], { thinking: true });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'adaptive' });
      // Guard against regressing to the legacy format rejected by Opus 4.8.
      expect(body.thinking.type).not.toBe('enabled');
      expect(body.thinking).not.toHaveProperty('budget_tokens');
    });

    it('maps effort to output_config.effort', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
      });
      await provider.complete([{ role: 'user', content: 'hi' }], { thinking: true, effort: 'high' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.output_config).toEqual({ effort: 'high' });
    });
  });

  describe('streamChunks', () => {
    it('yields text and thinking chunks', async () => {
      const events = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":42,"output_tokens":0}}}',
        'data: {"type":"content_block_start","content_block":{"type":"thinking"}}',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","text":"hmm"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":10}}',
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

      expect(chunks[0]).toEqual({ type: 'thinking', text: 'hmm' });
      expect(chunks[1]).toEqual({ type: 'text', text: 'Hi' });
      expect(chunks[2]).toEqual({ type: 'text', text: '!' });
      // input_tokens from message_start must survive into the final usage chunk,
      // and cost must reflect BOTH input and output (not output-only).
      expect(chunks[3]).toMatchObject({ type: 'usage', inputTokens: 42, outputTokens: 10 });
      const usage = chunks[3] as Extract<import('../types.js').StreamChunk, { type: 'usage' }>;
      // opus-4-8 default: 42*5/1e6 + 10*25/1e6 = 0.00021 + 0.00025 = 0.00046
      expect(usage.totalCostUsd).toBeCloseTo(0.00046, 8);
    });

    it('yields error on failed request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const chunks: import('../types.js').StreamChunk[] = [];
      for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }
      expect(chunks[0]).toMatchObject({ type: 'error' });
    });

    it('applies adaptive thinking, effort, and temperature to the streamed request', async () => {
      const encoder = new TextEncoder();
      let readCount = 0;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              if (readCount === 0) { readCount++; return Promise.resolve({ done: false, value: encoder.encode('data: [DONE]\n') }); }
              return Promise.resolve({ done: true, value: undefined });
            }),
          }),
        },
      });

      const chunks: import('../types.js').StreamChunk[] = [];
      for await (const chunk of provider.streamChunks!([{ role: 'user', content: 'hi' }], { thinking: true, effort: 'medium', temperature: 0.5 })) {
        chunks.push(chunk);
      }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.thinking).toEqual({ type: 'adaptive' });
      expect(body.output_config).toEqual({ effort: 'medium' });
      expect(body.temperature).toBe(0.5);
      expect(body.thinking).not.toHaveProperty('budget_tokens');
    });
  });

  describe('stream (legacy)', () => {
    it('yields only text strings', async () => {
      const events = [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","text":"skip"}}',
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

      const texts: string[] = [];
      for await (const text of provider.stream([{ role: 'user', content: 'hi' }])) {
        texts.push(text);
      }
      expect(texts).toEqual(['Hello']);
    });
  });
});
