import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  defaultSignedTarballPath,
  metadataForApp,
  signNotarizeUrl,
} from '../../scripts/ci/codesign-mac-app-bundle.mjs';

describe('mac app bundle codesign helpers', () => {
  it('builds sign-notarize test-certificate URLs', () => {
    expect(signNotarizeUrl({ serviceUrl: 'https://codesign.example.com:10443' })).toBe(
      'https://codesign.example.com:10443/api/sign-notarize/?certtype=test',
    );
  });

  it('creates service metadata with the required app zip output', () => {
    expect(metadataForApp('Kairos.app', ['Kairos.app/Contents/MacOS/kairos'])).toEqual([
      {
        name: 'Codesign Kairos.app',
        codesign: [
          { item: 'Kairos.app/Contents/MacOS/kairos', entitle: 'entitlements.plist' },
          { item: 'Kairos.app', entitle: 'entitlements.plist' },
        ],
        zip: ['Kairos.app', 'Kairos.app.zip'],
        notarize: 'Kairos.app.zip',
        staple: 'Kairos.app',
      },
    ]);
  });

  it('derives signed updater tarball paths under signed-artifacts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-codesign-mac-'));
    try {
      const app = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Kairos.app');
      expect(defaultSignedTarballPath({ root, appPath: app })).toBe(
        path.join(root, 'signed-artifacts', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Kairos.app.tar.gz'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
