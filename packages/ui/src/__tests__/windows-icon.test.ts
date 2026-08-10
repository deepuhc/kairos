import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureRcedit,
  RCEDIT_ASSET_NAME,
  rceditIconArgs,
  resolveWindowsExe,
  toWindowsFileVersion,
} from '../../scripts/lib/windows-icon.mjs';

describe('windows icon embedding', () => {
  const target = 'x86_64-pc-windows-gnullvm';

  it('normalizes versions to a 4-part Windows file version', () => {
    expect(toWindowsFileVersion('0.1.21')).toBe('0.1.21.0');
    expect(toWindowsFileVersion('0.1.21-beta.2')).toBe('0.1.21.0');
    expect(toWindowsFileVersion('1.2.3.4')).toBe('1.2.3.4');
    expect(toWindowsFileVersion('')).toBe('0.0.0.0');
    expect(toWindowsFileVersion(undefined)).toBe('0.0.0.0');
  });

  it('prefers the per-target release exe over the plain release exe', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-icon-'));
    try {
      const targetExe = path.join(root, 'src-tauri', 'target', target, 'release', 'kairos.exe');
      const plainExe = path.join(root, 'src-tauri', 'target', 'release', 'kairos.exe');
      mkdirSync(path.dirname(targetExe), { recursive: true });
      mkdirSync(path.dirname(plainExe), { recursive: true });
      writeFileSync(targetExe, 'stub', { flag: 'wx' });
      writeFileSync(plainExe, 'stub', { flag: 'wx' });

      expect(resolveWindowsExe({ repoRoot: root, target })).toBe(targetExe);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the plain release exe and returns null when absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-icon-'));
    try {
      expect(resolveWindowsExe({ repoRoot: root, target })).toBeNull();

      const plainExe = path.join(root, 'src-tauri', 'target', 'release', 'kairos.exe');
      mkdirSync(path.dirname(plainExe), { recursive: true });
      writeFileSync(plainExe, 'stub', { flag: 'wx' });
      expect(resolveWindowsExe({ repoRoot: root, target })).toBe(plainExe);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds rcedit args that set the icon and version resources', () => {
    const args = rceditIconArgs({
      exePath: 'C:\\build\\kairos.exe',
      iconPath: 'C:\\build\\icon.ico',
      version: '0.1.21',
    });

    expect(args[0]).toBe('C:\\build\\kairos.exe');
    expect(args).toContain('--set-icon');
    expect(args).toContain('C:\\build\\icon.ico');
    expect(args.join(' ')).toContain('--set-file-version 0.1.21.0');
    expect(args.join(' ')).toContain('--set-product-version 0.1.21.0');
    expect(args.join(' ')).toContain('--set-version-string ProductName Kairos');
    expect(args.join(' ')).toContain('--set-version-string OriginalFilename kairos.exe');
  });

  it('omits version flags when no version is provided', () => {
    const args = rceditIconArgs({ exePath: 'a.exe', iconPath: 'a.ico' });
    expect(args).toContain('--set-icon');
    expect(args).not.toContain('--set-file-version');
    expect(args).not.toContain('--set-product-version');
  });

  it('reuses an already-cached rcedit without downloading', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-rcedit-'));
    try {
      const toolsDir = path.join(root, '.ci-tools');
      mkdirSync(toolsDir, { recursive: true });
      const cached = path.join(toolsDir, RCEDIT_ASSET_NAME);
      writeFileSync(cached, 'stub-binary');

      expect(ensureRcedit({ toolsDir })).toBe(cached);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors KAIROS_RCEDIT_PATH and returns null when it is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-rcedit-'));
    const prev = process.env.KAIROS_RCEDIT_PATH;
    try {
      const override = path.join(root, 'my-rcedit.exe');
      writeFileSync(override, 'stub-binary');
      process.env.KAIROS_RCEDIT_PATH = override;
      expect(ensureRcedit({ toolsDir: path.join(root, '.ci-tools') })).toBe(override);

      process.env.KAIROS_RCEDIT_PATH = path.join(root, 'nope.exe');
      expect(ensureRcedit({ toolsDir: path.join(root, '.ci-tools') })).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.KAIROS_RCEDIT_PATH;
      else process.env.KAIROS_RCEDIT_PATH = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
