import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import { applySignedArtifacts } from '../../scripts/ci/apply-signed-artifacts.mjs';

describe('applySignedArtifacts', () => {
  it('copies signed artifacts back into their repository-relative locations', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-signed-artifacts-'));
    try {
      const signedArtifact = path.join(
        root,
        'signed-artifacts',
        'src-tauri',
        'target',
        'release',
        'bundle',
        'macos',
        'Kairos.app.tar.gz',
      );
      const signedSignature = `${signedArtifact}.sig`;
      mkdirSync(path.dirname(signedArtifact), { recursive: true });
      writeFileSync(signedArtifact, 'signed-app');
      writeFileSync(signedSignature, 'signed-updater-signature');

      const copied = applySignedArtifacts({ root });
      const destination = path.join(
        root,
        'src-tauri',
        'target',
        'release',
        'bundle',
        'macos',
        'Kairos.app.tar.gz',
      );

      expect(copied.sort()).toEqual([destination, `${destination}.sig`].sort());
      expect(readFileSync(destination, 'utf8')).toBe('signed-app');
      expect(readFileSync(`${destination}.sig`, 'utf8')).toBe('signed-updater-signature');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is a no-op when no signed artifacts are present', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-signed-artifacts-'));
    try {
      expect(applySignedArtifacts({ root })).toEqual([]);
      expect(existsSync(path.join(root, 'src-tauri'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
