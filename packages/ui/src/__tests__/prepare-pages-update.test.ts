import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import { artifactUrlFromEndpoint, preparePagesUpdate } from '../../scripts/prepare-pages-update.mjs';

function createTempRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'kairos-update-'));
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(
    path.join(root, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ version: '0.2.0' }),
  );
  return root;
}

describe('preparePagesUpdate', () => {
  it('discovers Windows NSIS artifacts and merges them into the updater manifest', () => {
    const root = createTempRepo();
    try {
      const outDir = path.join(root, 'public', 'updates', 'stable');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, 'latest.json'),
        JSON.stringify({
          version: '0.2.0',
          notes: 'Kairos 0.2.0',
          pub_date: '2026-01-01T00:00:00.000Z',
          platforms: {
            'darwin-aarch64': {
              url: 'https://example.com/updates/stable/darwin-aarch64/Kairos.app.tar.gz',
              signature: 'mac-signature',
            },
          },
        }),
      );

      const artifactDir = path.join(
        root,
        'src-tauri',
        'target',
        'x86_64-pc-windows-gnullvm',
        'release',
        'bundle',
        'nsis',
      );
      mkdirSync(artifactDir, { recursive: true });
      const staleArtifact = path.join(artifactDir, 'Kairos_0.1.10_x64-setup.exe');
      writeFileSync(staleArtifact, 'old-installer');
      writeFileSync(`${staleArtifact}.sig`, 'old-windows-signature\n');
      const artifact = path.join(artifactDir, 'Kairos_0.2.0_x64-setup.exe');
      writeFileSync(artifact, 'installer');
      writeFileSync(`${artifact}.sig`, 'windows-signature\n');

      const result = preparePagesUpdate({
        root,
        channel: 'stable',
        platform: 'windows-x86_64-nsis',
        endpoint: 'https://example.com/updates/stable/latest.json',
        version: '0.2.0',
        windowsTarget: 'x86_64-pc-windows-gnullvm',
      });

      expect(result.artifactPath).toBe(artifact);
      expect(
        existsSync(path.join(outDir, 'windows-x86_64-nsis', 'Kairos_0.2.0_x64-setup.exe')),
      ).toBe(true);

      const manifest = JSON.parse(readFileSync(path.join(outDir, 'latest.json'), 'utf8'));
      expect(manifest.pub_date).toBe('2026-01-01T00:00:00.000Z');
      expect(manifest.platforms['darwin-aarch64'].signature).toBe('mac-signature');
      expect(manifest.platforms['windows-x86_64-nsis']).toEqual({
        url: 'https://example.com/updates/stable/windows-x86_64-nsis/Kairos_0.2.0_x64-setup.exe',
        signature: 'windows-signature',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes multi-line markdown release notes into the manifest', () => {
    const root = createTempRepo();
    try {
      const artifactDir = path.join(
        root,
        'src-tauri',
        'target',
        'release',
        'bundle',
        'macos',
      );
      mkdirSync(artifactDir, { recursive: true });
      const artifact = path.join(artifactDir, 'Kairos.app.tar.gz');
      writeFileSync(artifact, 'bundle');
      writeFileSync(`${artifact}.sig`, 'mac-signature\n');

      const notes = "## What's Changed in v0.2.0\n\n### Features\n- a\n- b\n\n### Fixes\n- c";
      const outDir = path.join(root, 'public', 'updates', 'stable');
      preparePagesUpdate({
        root,
        channel: 'stable',
        platform: 'darwin-aarch64',
        endpoint: 'https://example.com/updates/stable/latest.json',
        version: '0.2.0',
        notes,
        outDir,
      });

      const manifest = JSON.parse(readFileSync(path.join(outDir, 'latest.json'), 'utf8'));
      expect(manifest.notes).toBe(notes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to publish a Windows updater manifest with a stale installer', () => {
    const root = createTempRepo();
    try {
      const artifactDir = path.join(
        root,
        'src-tauri',
        'target',
        'x86_64-pc-windows-gnullvm',
        'release',
        'bundle',
        'nsis',
      );
      mkdirSync(artifactDir, { recursive: true });
      const staleArtifact = path.join(artifactDir, 'Kairos_0.1.10_x64-setup.exe');
      writeFileSync(staleArtifact, 'old-installer');
      writeFileSync(`${staleArtifact}.sig`, 'old-windows-signature\n');

      expect(() =>
        preparePagesUpdate({
          root,
          channel: 'stable',
          platform: 'windows-x86_64-nsis',
          endpoint: 'https://example.com/updates/stable/latest.json',
          version: '0.2.0',
          windowsTarget: 'x86_64-pc-windows-gnullvm',
        }),
      ).toThrow('Unable to find Windows NSIS installer for 0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an explicit Windows updater artifact with the wrong version', () => {
    const root = createTempRepo();
    try {
      const artifactDir = path.join(root, 'artifacts');
      mkdirSync(artifactDir, { recursive: true });
      const staleArtifact = path.join(artifactDir, 'Kairos_0.1.10_x64-setup.exe');
      writeFileSync(staleArtifact, 'old-installer');
      writeFileSync(`${staleArtifact}.sig`, 'old-windows-signature\n');

      expect(() =>
        preparePagesUpdate({
          root,
          channel: 'stable',
          platform: 'windows-x86_64-nsis',
          endpoint: 'https://example.com/updates/stable/latest.json',
          version: '0.2.0',
          artifact: staleArtifact,
        }),
      ).toThrow('Windows NSIS updater artifact version mismatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives platform artifact URLs beside latest.json', () => {
    expect(
      artifactUrlFromEndpoint(
        'https://example.com/updates/stable/latest.json',
        'windows-x86_64-nsis',
        'Kairos_0.2.0_x64-setup.exe',
      ),
    ).toBe('https://example.com/updates/stable/windows-x86_64-nsis/Kairos_0.2.0_x64-setup.exe');
  });
});
