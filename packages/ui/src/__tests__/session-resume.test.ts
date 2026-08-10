import { describe, expect, it } from 'vitest';
import { usableSessionDir } from '../services/session-resume.js';

describe('usableSessionDir', () => {
  it('rejects missing and backslash-only legacy placeholders', () => {
    expect(usableSessionDir(undefined)).toBeNull();
    expect(usableSessionDir('')).toBeNull();
    expect(usableSessionDir('  ')).toBeNull();
    expect(usableSessionDir('\\\\')).toBeNull();
  });

  it('keeps local and UNC Windows paths', () => {
    expect(usableSessionDir(' C:\\Users\\rajat\\repo ')).toBe('C:\\Users\\rajat\\repo');
    expect(usableSessionDir('\\\\server\\share\\repo')).toBe('\\\\server\\share\\repo');
  });
});
