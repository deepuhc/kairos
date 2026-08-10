import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  assertLikelyBinaryArtifact,
  codesignArtifact,
  codesignUploadUrl,
  codesignUrl,
  defaultSignedArtifactPath,
  joinUrlPath,
} from '../../scripts/ci/codesign-artifact.mjs';

describe('codesign artifact helpers', () => {
  it('builds test-certificate Code Sign Service URLs', () => {
    expect(
      codesignUrl({
        serviceUrl: 'https://codesign.example.com:10443',
        platform: 'mac',
        inputUrl: 'https://iat-artifactory.example.com/repo/Kairos.app.tar.gz',
      }),
    ).toBe(
      'https://codesign.example.com:10443/api/codesign?platform=mac&certtype=test&inputurl=https%3A%2F%2Fiat-artifactory.example.com%2Frepo%2FKairos.app.tar.gz',
    );
  });

  it('builds explicit test-certificate Code Sign Service URLs', () => {
    expect(
      codesignUrl({
        serviceUrl: 'https://codesign.example.com:10443',
        platform: 'win',
        inputUrl: 'https://iat-artifactory.example.com/repo/Kairos.exe',
        certtype: 'test',
      }),
    ).toBe(
      'https://codesign.example.com:10443/api/codesign?platform=win&certtype=test&inputurl=https%3A%2F%2Fiat-artifactory.example.com%2Frepo%2FKairos.exe',
    );
  });

  it('builds filesystem-upload Code Sign Service URLs', () => {
    expect(
      codesignUploadUrl({
        serviceUrl: 'https://codesign.example.com:10443',
        platform: 'win',
      }),
    ).toBe(
      'https://codesign.example.com:10443/api/codesign/?platform=win&certtype=test',
    );
  });

  it('builds filesystem-upload URLs with explicit test certificate type', () => {
    expect(
      codesignUploadUrl({
        serviceUrl: 'https://codesign.example.com:10443',
        platform: 'win',
        certtype: 'test',
      }),
    ).toBe(
      'https://codesign.example.com:10443/api/codesign/?platform=win&certtype=test',
    );
  });

  it('appends encoded artifact names to Artifactory folder URLs', () => {
    expect(
      joinUrlPath(
        'https://iat-artifactory.example.com/artifactory/kairos/',
        'Kairos 0.2.0.app.tar.gz',
      ),
    ).toBe(
      'https://iat-artifactory.example.com/artifactory/kairos/Kairos%200.2.0.app.tar.gz',
    );
  });

  it('derives signed output paths under signed-artifacts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-codesign-'));
    try {
      const artifact = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Kairos.app.tar.gz');
      expect(defaultSignedArtifactPath({ root, artifactPath: artifact })).toBe(
        path.join(root, 'signed-artifacts', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Kairos.app.tar.gz'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects short textual service error responses', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-codesign-'));
    try {
      const original = path.join(root, 'unsigned.exe');
      const response = path.join(root, 'signed.exe');
      writeFileSync(original, Buffer.alloc(8192, 1));
      writeFileSync(response, 'failed: caller is not authorized');

      expect(() =>
        assertLikelyBinaryArtifact({
          filePath: response,
          originalPath: original,
          headers: 'content-type: text/plain',
        }),
      ).toThrow('instead of an artifact');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts non-textual artifact output', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-codesign-'));
    try {
      mkdirSync(root, { recursive: true });
      const original = path.join(root, 'unsigned.exe');
      const response = path.join(root, 'signed.exe');
      writeFileSync(original, Buffer.alloc(8192, 1));
      writeFileSync(response, Buffer.alloc(8192, 2));

      expect(() =>
        assertLikelyBinaryArtifact({
          filePath: response,
          originalPath: original,
          headers: 'content-type: application/octet-stream',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses filesystem upload by default', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-codesign-'));
    try {
      const artifact = path.join(root, 'Kairos.app.tar.gz');
      writeFileSync(artifact, Buffer.alloc(8192, 1));

      expect(() =>
        codesignArtifact({
          args: ['--platform', 'mac', '--artifact', artifact],
          env: {},
          root,
        }),
      ).toThrow('KAIROS_CODESIGN_API_TOKEN');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an empty API token file before calling curl', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-codesign-'));
    try {
      const artifact = path.join(root, 'Kairos.app.tar.gz');
      const tokenFile = path.join(root, 'token');
      writeFileSync(artifact, Buffer.alloc(8192, 1));
      writeFileSync(tokenFile, '');

      expect(() =>
        codesignArtifact({
          args: ['--platform', 'mac', '--artifact', artifact],
          env: { KAIROS_CODESIGN_API_TOKEN_FILE: tokenFile },
          root,
        }),
      ).toThrow('KAIROS_CODESIGN_API_TOKEN_FILE is empty');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
