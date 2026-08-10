import { describe, expect, it } from 'vitest';
import { shouldReuseLiveMarkdown } from '../components/markdown.js';

describe('markdown render cache', () => {
  it('throttles live markdown reparse windows', () => {
    expect(shouldReuseLiveMarkdown(1_000, 1_050, 160)).toBe(true);
    expect(shouldReuseLiveMarkdown(1_000, 1_160, 160)).toBe(false);
    expect(shouldReuseLiveMarkdown(1_000, 900, 160)).toBe(false);
  });
});
