import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readGnullvmAliases() {
  const script = readFileSync(
    new URL('../../scripts/ci/configure-windows-cargo-offline.ps1', import.meta.url),
    'utf8',
  );
  const match = script.match(/\$aliases\s*=\s*@\(([\s\S]*?)\n\s*\)/);
  if (!match) throw new Error('Unable to find gnullvm import library aliases');

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

describe('Windows CI import library aliases', () => {
  it('covers Windows system libraries required by the gnullvm release link', () => {
    expect(readGnullvmAliases()).toEqual(expect.arrayContaining([
      'cfgmgr32',
      'msimg32',
      'opengl32',
    ]));
  });
});
