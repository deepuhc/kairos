import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  checkPushedReleaseTags,
  formatPushedReleaseTagCheck,
  parsePrePushInput,
  releaseTagFromRef,
} from '../../scripts/ci/check-pushed-release-tags.mjs';

function manifestFiles(version: string, overrides: Record<string, string> = {}) {
  const versions = {
    packageJson: version,
    packageLock: version,
    packageLockRoot: version,
    tauri: version,
    cargoToml: version,
    cargoLock: version,
    releaseNotes: `### v${version}\n\n- Shipped\n`,
    ...overrides,
  };

  return {
    packageJson: JSON.stringify({ name: 'kairos', version: versions.packageJson }),
    packageLock: JSON.stringify({
      name: 'kairos',
      version: versions.packageLock,
      packages: { '': { name: 'kairos', version: versions.packageLockRoot } },
    }),
    tauri: JSON.stringify({ version: versions.tauri }),
    cargoToml: `[package]\nname = "kairos"\nversion = "${versions.cargoToml}"\n`,
    cargoLock: `[[package]]\nname = "kairos"\nversion = "${versions.cargoLock}"\n`,
    releaseNotes: versions.releaseNotes,
  };
}

function fakeGit(
  files = manifestFiles('0.2.0'),
  subjectsByRange: Record<string, string[]> = { 'v0.1.9..commit-sha': ['feat: shipped'] },
) {
  return (args: string[]) => {
    if (args[0] === 'rev-parse') return 'commit-sha\n';
    if (args[0] === 'cat-file') return 'commit\n';
    if (args[0] === 'tag') return 'v0.1.9\n';
    if (args[0] === 'log') {
      const range = args[1];
      return `${(subjectsByRange[range] ?? []).join('\n')}\n`;
    }
    if (args[0] === 'show') {
      const path = args[1].split(':').slice(1).join(':');
      if (path === 'package.json') return files.packageJson;
      if (path === 'package-lock.json') return files.packageLock;
      if (path === 'src-tauri/tauri.conf.json') return files.tauri;
      if (path === 'src-tauri/Cargo.toml') return files.cargoToml;
      if (path === 'src-tauri/Cargo.lock') return files.cargoLock;
      if (path === 'src/generated/release-notes.md') return files.releaseNotes;
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

describe('release tag pre-push check', () => {
  it('parses git pre-push updates', () => {
    expect(parsePrePushInput('refs/heads/main abc refs/heads/main def\n')).toEqual([
      { localRef: 'refs/heads/main', localOid: 'abc', remoteRef: 'refs/heads/main', remoteOid: 'def' },
    ]);
  });

  it('detects semver tag refs', () => {
    expect(releaseTagFromRef('refs/tags/v0.2.0')).toBe('v0.2.0');
    expect(releaseTagFromRef('refs/tags/0.2.0-beta.1')).toBe('0.2.0-beta.1');
    expect(releaseTagFromRef('refs/tags/not-a-release')).toBeNull();
    expect(releaseTagFromRef('refs/heads/main')).toBeNull();
  });

  it('accepts a release tag whose target manifests match the tag', () => {
    const result = checkPushedReleaseTags({
      input: 'refs/tags/v0.2.0 tag-sha refs/tags/v0.2.0 0000000000000000000000000000000000000000\n',
      run: fakeGit(manifestFiles('0.2.0')),
    });

    expect(result.ok).toBe(true);
    expect(result.checked.map(({ tag }) => tag)).toEqual(['v0.2.0']);
  });

  it('rejects a release tag whose target manifests do not match the tag', () => {
    const result = checkPushedReleaseTags({
      input: 'refs/tags/v0.2.0 tag-sha refs/tags/v0.2.0 0000000000000000000000000000000000000000\n',
      run: fakeGit(manifestFiles('0.1.9')),
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0].result.errors.join('\n')).toContain('expected 0.2.0');
    expect(formatPushedReleaseTagCheck(result).join('\n')).toContain('npm run release:version');
  });

  it('rejects a release tag whose generated release notes are stale', () => {
    const result = checkPushedReleaseTags({
      input: 'refs/tags/v0.2.0 tag-sha refs/tags/v0.2.0 0000000000000000000000000000000000000000\n',
      run: fakeGit(manifestFiles('0.2.0', { releaseNotes: '### v0.2.0\n\n- Old notes\n' })),
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0].result.errors.join('\n')).toContain('src/generated/release-notes.md is stale');
    expect(formatPushedReleaseTagCheck(result).join('\n')).toContain('release notes');
  });

  it('ignores branch pushes, non-semver tags, and tag deletions', () => {
    const result = checkPushedReleaseTags({
      input: [
        'refs/heads/main branch-sha refs/heads/main remote-sha',
        'refs/tags/latest tag-sha refs/tags/latest 0000000000000000000000000000000000000000',
        'refs/tags/v0.2.0 0000000000000000000000000000000000000000 refs/tags/v0.2.0 remote-sha',
      ].join('\n'),
      run: () => {
        throw new Error('git should not be called');
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checked).toEqual([]);
  });

  it('reports release tags that do not resolve to commits', () => {
    const result = checkPushedReleaseTags({
      input: 'refs/tags/v0.2.0 tag-sha refs/tags/v0.2.0 0000000000000000000000000000000000000000\n',
      run: (args: string[]) => {
        if (args[0] === 'rev-parse') return 'tree-sha\n';
        if (args[0] === 'cat-file') return 'tree\n';
        throw new Error(`unexpected git ${args.join(' ')}`);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0].error).toContain('not a commit');
  });
});
