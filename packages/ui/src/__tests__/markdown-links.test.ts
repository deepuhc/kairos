import { describe, expect, it } from 'vitest';
import { classifyMarkdownHref, shouldReuseLiveMarkdown } from '../components/markdown.js';
import { workspacePathFromHref } from '../services/workspace-links.js';

describe('markdown link handling', () => {
  it('classifies web links as external and file-style links as local', () => {
    expect(classifyMarkdownHref('https://example.com/a')).toBe('external');
    expect(classifyMarkdownHref('mailto:test@example.com')).toBe('external');
    expect(classifyMarkdownHref('src/components/markdown.ts')).toBe('local');
    expect(classifyMarkdownHref('/Users/rsehgal/code/kairos/src/components/markdown.ts:12')).toBe('local');
    expect(classifyMarkdownHref('file:///Users/rsehgal/code/kairos/src/components/markdown.ts')).toBe('local');
  });

  it('blocks unsafe protocols', () => {
    expect(classifyMarkdownHref('javascript:alert(1)')).toBe('unsafe');
    expect(classifyMarkdownHref('data:text/html,hello')).toBe('unsafe');
  });

  it('throttles live markdown reparse windows', () => {
    expect(shouldReuseLiveMarkdown(1_000, 1_050, 160)).toBe(true);
    expect(shouldReuseLiveMarkdown(1_000, 1_160, 160)).toBe(false);
    expect(shouldReuseLiveMarkdown(1_000, 900, 160)).toBe(false);
  });

  it('resolves workspace file hrefs to relative paths', () => {
    const cwd = '/Users/rsehgal/code/kairos';
    expect(workspacePathFromHref('src/components/markdown.ts', cwd)).toBe('src/components/markdown.ts');
    expect(workspacePathFromHref('./src/components/markdown.ts:12', cwd)).toBe('src/components/markdown.ts');
    expect(workspacePathFromHref('/Users/rsehgal/code/kairos/src/components/markdown.ts:12', cwd)).toBe('src/components/markdown.ts');
    expect(workspacePathFromHref('file:///Users/rsehgal/code/kairos/src/a%20b.ts#L4', cwd)).toBe('src/a b.ts');
    expect(workspacePathFromHref('/src/components/markdown.ts', cwd)).toBe('src/components/markdown.ts');
  });

  it('rejects external, traversing, and outside-workspace hrefs', () => {
    const cwd = '/Users/rsehgal/code/kairos';
    expect(workspacePathFromHref('https://example.com/src/components/markdown.ts', cwd)).toBeNull();
    expect(workspacePathFromHref('../outside.ts', cwd)).toBeNull();
    expect(workspacePathFromHref('/Users/rsehgal/Brain/INDEX.md', cwd)).toBeNull();
  });
});
