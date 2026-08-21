import { describe, it, expect } from 'vitest';
import { looksLikeVisionModel } from '../vision-models.js';

describe('looksLikeVisionModel', () => {
  it('detects models with an explicit vision/llava marker', () => {
    for (const id of ['llava:7b', 'bakllava:7b', 'llama3.2-vision:11b', 'granite3.2-vision:2b']) {
      expect(looksLikeVisionModel(id), id).toBe(true);
    }
  });

  it('detects multimodal families whose tag has no vision marker', () => {
    for (const id of ['gemma3:12b', 'minicpm-v:8b', 'moondream:latest', 'pixtral:12b', 'internvl:8b', 'glm-4v:9b']) {
      expect(looksLikeVisionModel(id), id).toBe(true);
    }
  });

  it('detects the Qwen-VL family across tag spellings', () => {
    for (const id of ['qwen2-vl:7b', 'qwen2.5vl:7b', 'qwen-vl:latest', 'Qwen2.5-VL-7B']) {
      expect(looksLikeVisionModel(id), id).toBe(true);
    }
  });

  it('does not tag the text-only homelab models as vision', () => {
    for (const id of [
      'qwen2.5-coder:14b',
      'deepseek-r1:14b',
      'qwen2.5:14b',
      'deepseek-r1:7b',
      'qwen2.5:7b',
      'phi3:medium',
      'mistral:latest',
      'llama3.1:8b',
    ]) {
      expect(looksLikeVisionModel(id), id).toBe(false);
    }
  });

  it('does not match "vl" inside an unrelated word', () => {
    // The VL pattern is boundary-anchored, so these must not match.
    for (const id of ['vlm-unrelated-text', 'novlab:7b']) {
      expect(looksLikeVisionModel(id), id).toBe(false);
    }
  });

  it('excludes hosted models unless explicitly requested', () => {
    expect(looksLikeVisionModel('gpt-4o')).toBe(false);
    expect(looksLikeVisionModel('gpt-4o', true)).toBe(true);
    expect(looksLikeVisionModel('claude-opus-4', true)).toBe(true);
    expect(looksLikeVisionModel('gemini-2.5-pro', true)).toBe(true);
  });
});
