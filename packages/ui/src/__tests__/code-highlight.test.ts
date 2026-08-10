import { describe, it, expect } from 'vitest';
import { highlightCode } from '../components/code-highlight.js';

describe('highlightCode', () => {
  it('highlights blocks with a resolved language hint', () => {
    const r = highlightCode('const x = 1;', 'js');
    expect(r.language).toBe('javascript');
    expect(r.value).toContain('hljs-keyword');
  });

  it('returns escaped plain text (no auto-detect) when the hint is unusable', () => {
    const r = highlightCode('a < b && c > d', '');
    expect(r.language).toBeUndefined();
    // No hljs-* token spans — the block was not run through any grammar.
    expect(r.value).not.toContain('hljs-');
    // …but it is HTML-escaped so it stays injection-safe.
    expect(r.value).toBe('a &lt; b &amp;&amp; c &gt; d');
  });

  it('memoizes identical (grammar, source) so re-renders reuse the result', () => {
    const first = highlightCode('let y = 2;', 'ts');
    const second = highlightCode('let y = 2;', 'ts');
    expect(second).toBe(first);
  });
});
