import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandHome, normalizeParamsCwd } from '../paths.js';

describe('expandHome', () => {
  it('expands a bare ~ to the home directory', () => {
    expect(expandHome('~')).toBe(homedir());
  });

  it('expands a ~/subdir prefix', () => {
    expect(expandHome('~/projects/kairos')).toBe(join(homedir(), 'projects/kairos'));
  });

  it('leaves an absolute path untouched', () => {
    expect(expandHome('/tmp/work')).toBe('/tmp/work');
  });

  it('does not expand a ~ that is not a leading path segment', () => {
    expect(expandHome('/home/~backup')).toBe('/home/~backup');
    expect(expandHome('relative/dir')).toBe('relative/dir');
  });
});

describe('normalizeParamsCwd', () => {
  it('expands a ~ cwd field', () => {
    expect(normalizeParamsCwd({ cwd: '~', mcpServers: [] })).toEqual({ cwd: homedir(), mcpServers: [] });
  });

  it('leaves params without a string cwd untouched', () => {
    const p1 = { mcpServers: [] };
    expect(normalizeParamsCwd(p1)).toBe(p1);
    const p2 = { cwd: 123 } as unknown as Record<string, unknown>;
    expect(normalizeParamsCwd(p2)).toBe(p2);
  });

  it('does not mutate the input object', () => {
    const input = { cwd: '~' };
    normalizeParamsCwd(input);
    expect(input.cwd).toBe('~');
  });
});
