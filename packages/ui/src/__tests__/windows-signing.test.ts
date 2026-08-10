import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import { windowsSigningConfigFromEnv } from '../../scripts/lib/windows-signing.mjs';

describe('windows signing config', () => {
  it('returns null when signing is not configured', () => {
    expect(windowsSigningConfigFromEnv({})).toBeNull();
  });

  it('enables the default Tauri certificate-thumbprint signing path', () => {
    expect(windowsSigningConfigFromEnv({
      KAIROS_WINDOWS_CERTIFICATE_THUMBPRINT: 'ABC123',
      KAIROS_WINDOWS_TIMESTAMP_URL: 'http://timestamp.example.com',
      KAIROS_WINDOWS_TIMESTAMP_TSP: 'true',
    })).toEqual({
      source: 'certificateThumbprint',
      config: {
        certificateThumbprint: 'ABC123',
        digestAlgorithm: 'sha256',
        timestampUrl: 'http://timestamp.example.com',
        tsp: true,
      },
    });
  });

  it('allows a custom signing command with the Tauri binary placeholder', () => {
    expect(windowsSigningConfigFromEnv({
      KAIROS_WINDOWS_SIGN_COMMAND: 'trusted-sign sign --file %1',
    })).toEqual({
      source: 'signCommand',
      config: {
        signCommand: 'trusted-sign sign --file %1',
      },
    });
  });

  it('fails when release signing is required but not configured', () => {
    expect(() => windowsSigningConfigFromEnv({
      KAIROS_WINDOWS_REQUIRE_SIGNING: '1',
    })).toThrow('Windows signing is required');
  });

  it('rejects ambiguous or invalid signing configuration', () => {
    expect(() => windowsSigningConfigFromEnv({
      KAIROS_WINDOWS_SIGN_COMMAND: 'trusted-sign sign --file',
    })).toThrow('%1');

    expect(() => windowsSigningConfigFromEnv({
      KAIROS_WINDOWS_SIGN_COMMAND: 'trusted-sign sign --file %1',
      KAIROS_WINDOWS_CERTIFICATE_THUMBPRINT: 'ABC123',
    })).toThrow('not both');

    expect(() => windowsSigningConfigFromEnv({
      KAIROS_WINDOWS_CERTIFICATE_THUMBPRINT: 'ABC123',
      KAIROS_WINDOWS_TIMESTAMP_TSP: 'sometimes',
    })).toThrow('KAIROS_WINDOWS_TIMESTAMP_TSP must be a boolean');
  });
});
