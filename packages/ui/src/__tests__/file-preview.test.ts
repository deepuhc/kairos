import { describe, expect, it } from 'vitest';
import { isMarkdownFilePath } from '../services/file-preview.js';

describe('isMarkdownFilePath', () => {
  it('matches common markdown extensions case-insensitively', () => {
    expect(isMarkdownFilePath('README.md')).toBe(true);
    expect(isMarkdownFilePath('docs/Guide.MARKDOWN')).toBe(true);
    expect(isMarkdownFilePath('notes/release.mdown')).toBe(true);
    expect(isMarkdownFilePath('notes/summary.mkdn')).toBe(true);
  });

  it('does not treat non-markdown paths as markdown', () => {
    expect(isMarkdownFilePath('src/app.ts')).toBe(false);
    expect(isMarkdownFilePath('docs/README.md.bak')).toBe(false);
    expect(isMarkdownFilePath('package.json')).toBe(false);
  });
});
