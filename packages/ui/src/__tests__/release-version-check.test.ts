import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import { checkReleaseVersions, releaseVersionFromEnv } from '../../scripts/ci/check-release-version.mjs';
// @ts-expect-error - plain ESM script without type declarations
import { setReleaseVersion } from '../../scripts/ci/set-release-version.mjs';

function createVersionFixture(version: string, overrides: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kairos-version-'));
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });

  const versions = {
    packageJson: version,
    packageLock: version,
    packageLockRoot: version,
    tauri: version,
    cargoToml: version,
    cargoLock: version,
    ...overrides,
  };

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'kairos', version: versions.packageJson }));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'kairos',
    version: versions.packageLock,
    packages: { '': { name: 'kairos', version: versions.packageLockRoot } },
  }));
  writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: versions.tauri }));
  writeFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), `[package]\nname = "kairos"\nversion = "${versions.cargoToml}"\n`);
  writeFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), `[[package]]\nname = "kairos"\nversion = "${versions.cargoLock}"\n`);

  return root;
}

describe('release version check', () => {
  it('accepts synchronized manifests that match the release tag', () => {
    const root = createVersionFixture('0.1.9');
    try {
      const result = checkReleaseVersions({ root, env: { CI_COMMIT_TAG: 'v0.1.9' } });
      expect(result.ok).toBe(true);
      expect(result.expectedVersion).toBe('0.1.9');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects manifest drift', () => {
    const root = createVersionFixture('0.1.9', { tauri: '0.1.8' });
    try {
      const result = checkReleaseVersions({ root, env: {} });
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('manifest versions differ');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects tag and manifest mismatch', () => {
    const root = createVersionFixture('0.1.9');
    try {
      const result = checkReleaseVersions({ root, env: { CI_COMMIT_TAG: 'v0.2.0' } });
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('expected 0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes release versions from env and tags', () => {
    expect(releaseVersionFromEnv({ KAIROS_RELEASE_VERSION: 'v1.2.3' })).toBe('1.2.3');
    expect(releaseVersionFromEnv({ CI_COMMIT_TAG: 'v1.2.3-beta.1' })).toBe('1.2.3-beta.1');
  });

  it('updates every release manifest from one version input', () => {
    const root = createVersionFixture('0.1.9');
    try {
      const result = setReleaseVersion({ root, version: 'v0.2.0' });
      expect(result.ok).toBe(true);
      expect(result.versions.map(({ version }) => version)).toEqual([
        '0.2.0',
        '0.2.0',
        '0.2.0',
        '0.2.0',
        '0.2.0',
        '0.2.0',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
