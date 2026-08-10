import { describe, it, expect } from 'vitest';
import type {
  Message,
  ContentPart,
  TextContent,
  ImageContent,
  FileContent,
  StreamChunk,
  TextChunk,
  ThinkingChunk,
  ToolCallChunk,
  UsageChunk,
  ErrorChunk,
  ModelInfo,
  ModelCapability,
  CompletionOptions,
  CompletionResult,
  CostEstimate,
  Provider,
} from '../types.js';

describe('types', () => {
  describe('Message', () => {
    it('supports string content', () => {
      const msg: Message = { role: 'user', content: 'hello' };
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('hello');
    });

    it('supports multi-modal content parts', () => {
      const textPart: TextContent = { type: 'text', text: 'What is in this image?' };
      const imagePart: ImageContent = { type: 'image', data: 'base64data', mimeType: 'image/png' };
      const filePart: FileContent = { type: 'file', data: 'filedata', mimeType: 'application/pdf', filename: 'doc.pdf' };

      const msg: Message = { role: 'user', content: [textPart, imagePart, filePart] };
      expect(Array.isArray(msg.content)).toBe(true);
      expect((msg.content as ContentPart[]).length).toBe(3);
    });

    it('supports all roles', () => {
      const roles: Message['role'][] = ['system', 'user', 'assistant'];
      for (const role of roles) {
        const msg: Message = { role, content: 'test' };
        expect(msg.role).toBe(role);
      }
    });
  });

  describe('StreamChunk', () => {
    it('supports text chunks', () => {
      const chunk: TextChunk = { type: 'text', text: 'hello' };
      expect(chunk.type).toBe('text');
    });

    it('supports thinking chunks', () => {
      const chunk: ThinkingChunk = { type: 'thinking', text: 'reasoning...' };
      expect(chunk.type).toBe('thinking');
    });

    it('supports tool call chunks', () => {
      const chunk: ToolCallChunk = { type: 'tool_call', id: 'tc1', name: 'read_file', arguments: '{"path":"x"}' };
      expect(chunk.type).toBe('tool_call');
      expect(chunk.name).toBe('read_file');
    });

    it('supports usage chunks', () => {
      const chunk: UsageChunk = { type: 'usage', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001 };
      expect(chunk.inputTokens).toBe(100);
    });

    it('supports error chunks', () => {
      const chunk: ErrorChunk = { type: 'error', message: 'rate limited', code: '429' };
      expect(chunk.code).toBe('429');
    });

    it('discriminated union narrows correctly', () => {
      const chunk: StreamChunk = { type: 'text', text: 'hi' };
      if (chunk.type === 'text') {
        expect(chunk.text).toBe('hi');
      }
    });
  });

  describe('ModelInfo', () => {
    it('has all required fields', () => {
      const model: ModelInfo = {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        isLocal: false,
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPerMillionInput: 2.5,
        costPerMillionOutput: 10,
        capabilities: ['chat', 'vision', 'tool_calling', 'streaming'],
        supportsVision: true,
        supportsStreaming: true,
      };
      expect(model.capabilities).toContain('vision');
    });
  });

  describe('ModelCapability', () => {
    it('includes all expected capabilities', () => {
      const caps: ModelCapability[] = ['chat', 'code', 'reasoning', 'tool_calling', 'vision', 'long_context', 'streaming', 'json_mode', 'function_calling'];
      expect(caps.length).toBe(9);
    });
  });

  describe('CompletionOptions', () => {
    it('supports all optional fields', () => {
      const opts: CompletionOptions = {
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
        stream: true,
        systemPrompt: 'You are helpful',
        jsonMode: true,
      };
      expect(opts.jsonMode).toBe(true);
    });
  });

  describe('CompletionResult', () => {
    it('includes thinking field', () => {
      const result: CompletionResult = {
        content: 'The answer is 42',
        model: 'claude-opus-4-20250514',
        usage: { inputTokens: 100, outputTokens: 50, totalCostUsd: 0.01 },
        finishReason: 'stop',
        thinking: 'Let me reason about this...',
      };
      expect(result.thinking).toBeDefined();
    });
  });

  describe('CostEstimate', () => {
    it('computes total correctly', () => {
      const cost: CostEstimate = {
        inputCostUsd: 0.003,
        outputCostUsd: 0.015,
        totalCostUsd: 0.018,
      };
      expect(cost.totalCostUsd).toBeCloseTo(cost.inputCostUsd + cost.outputCostUsd);
    });
  });
});
