import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import { developmentEnv, developmentPath } from '../../scripts/lib/dev-env.mjs';

// developmentPath builds the cargo bin path with path.join, so the expected
// value is derived the same way to hold on both POSIX and Windows separators.
const CARGO_BIN = path.join('/Users/rsehgal', '.cargo', 'bin');

describe('dev-env', () => {
  it('prepends the rustup cargo bin directory when it exists', () => {
    const result = developmentPath(
      { PATH: '/usr/bin:/bin' },
      {
        delimiter: ':',
        homeDir: '/Users/rsehgal',
        exists: (entry: string) => entry === CARGO_BIN,
      },
    );

    expect(result).toBe(`${CARGO_BIN}:/usr/bin:/bin`);
  });

  it('does not duplicate cargo bin when PATH already contains it', () => {
    const result = developmentPath(
      { PATH: `${CARGO_BIN}:/usr/bin:/bin` },
      {
        delimiter: ':',
        homeDir: '/Users/rsehgal',
        exists: () => true,
      },
    );

    expect(result).toBe(`${CARGO_BIN}:/usr/bin:/bin`);
  });

  it('preserves the existing PATH key casing', () => {
    const env = developmentEnv(
      { Path: '/usr/bin' },
      {
        delimiter: ':',
        homeDir: '/Users/rsehgal',
        exists: (entry: string) => entry === CARGO_BIN,
      },
    );

    expect(env).toEqual({ Path: `${CARGO_BIN}:/usr/bin` });
  });
});
