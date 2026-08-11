import { describe, it, expect } from 'vitest';
import { isOnPath } from '../which.js';

describe('isOnPath', () => {
  it('finds a bare command that lives in a PATH dir', () => {
    // node ran this test, so it is guaranteed to be on PATH.
    expect(isOnPath('node')).toBe(true);
  });

  it('returns false for a command that is not installed', () => {
    expect(isOnPath('kairos-definitely-not-a-real-binary-xyz')).toBe(false);
  });

  it('returns false for an empty command', () => {
    expect(isOnPath('')).toBe(false);
  });

  it('checks an absolute path directly rather than searching PATH', () => {
    expect(isOnPath(process.execPath)).toBe(true);
    expect(isOnPath('/no/such/absolute/binary')).toBe(false);
  });

  it('respects a custom PATH environment', () => {
    expect(isOnPath('node', { PATH: '' })).toBe(false);
  });
});
