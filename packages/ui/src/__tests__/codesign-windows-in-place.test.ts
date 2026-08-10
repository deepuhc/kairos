import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  resolveArtifactArg,
  windowsInPlaceCodesignArgs,
  windowsInPlaceCodesignEnv,
  writeSignedAppMarker,
} from '../../scripts/ci/codesign-windows-in-place.mjs';

describe('Windows in-place codesign wrapper', () => {
  it('builds codesign-artifact arguments for in-place Windows signing', () => {
    expect(windowsInPlaceCodesignArgs('C:\\build\\kairos.exe')).toEqual([
      '--platform',
      'win',
      '--artifact',
      'C:\\build\\kairos.exe',
      '--out',
      'C:\\build\\kairos.exe',
    ]);
  });

  it('disables updater resigning by default for raw Windows binaries', () => {
    expect(windowsInPlaceCodesignEnv({}).KAIROS_CODESIGN_RESIGN_UPDATER).toBe('0');
    expect(windowsInPlaceCodesignEnv({ KAIROS_CODESIGN_RESIGN_UPDATER: '1' }).KAIROS_CODESIGN_RESIGN_UPDATER).toBe('1');
  });

  it('reconstructs unquoted artifact paths with spaces', () => {
    expect(resolveArtifactArg(['C:\\Program', 'Files\\Kairos\\kairos.exe'])).toBe(
      'C:\\Program Files\\Kairos\\kairos.exe',
    );
  });

  it('writes a marker only for the signed app executable', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-windows-marker-'));
    try {
      const artifactPath = path.join(root, 'Kairos.exe');
      const markerPath = path.join(root, 'marker.json');
      writeFileSync(artifactPath, 'signed-app');

      const payload = writeSignedAppMarker({
        artifactPath,
        env: { KAIROS_WINDOWS_SIGNED_APP_MARKER: markerPath },
      });

      expect(payload?.artifactPath).toBe(artifactPath);
      expect(payload?.sha256).toMatch(/^[A-F0-9]{64}$/);
      expect(JSON.parse(readFileSync(markerPath, 'utf8')).artifactPath).toBe(artifactPath);

      expect(writeSignedAppMarker({
        artifactPath: path.join(root, 'NSISdl.dll'),
        env: { KAIROS_WINDOWS_SIGNED_APP_MARKER: markerPath },
      })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
