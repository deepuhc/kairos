import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildNsisRuntimeHooks,
  findWindowsRuntimeDlls,
  findWebview2LoaderDll,
  WEBVIEW2_LOADER_DLL_NAME,
  WINDOWS_APP_MANIFEST,
  WINDOWS_APP_MANIFEST_NAME,
  writeWindowsRuntimeHooks,
} from '../../scripts/lib/windows-runtime-hooks.mjs';

describe('windows runtime NSIS hooks', () => {
  const target = 'x86_64-pc-windows-gnullvm';

  function writeCargoLock(root: string, webview2Version = '0.38.2') {
    const srcTauri = path.join(root, 'src-tauri');
    mkdirSync(srcTauri, { recursive: true });
    writeFileSync(path.join(srcTauri, 'Cargo.lock'), `[[package]]
name = "webview2-com-sys"
version = "${webview2Version}"
`);
  }

  it('finds GNULLVM runtime DLLs from the Rust target directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-runtime-'));
    try {
      const runtimeDir = path.join(root, 'lib', 'rustlib', target, 'bin', 'self-contained');
      mkdirSync(runtimeDir, { recursive: true });
      writeFileSync(path.join(runtimeDir, 'libunwind.dll'), '', { flag: 'wx' });
      writeFileSync(path.join(runtimeDir, 'not-runtime.dll'), '', { flag: 'wx' });

      const dlls = findWindowsRuntimeDlls({ cargoHome: root, target });
      expect(dlls).toEqual([{ name: 'libunwind.dll', filePath: path.join(runtimeDir, 'libunwind.dll') }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('generates installer hooks that copy runtime DLLs beside the app exe', () => {
    const hooks = buildNsisRuntimeHooks([
      { name: 'libunwind.dll', filePath: 'C:\\Rust\\libunwind.dll' },
      { name: WEBVIEW2_LOADER_DLL_NAME, filePath: `C:\\Rust\\${WEBVIEW2_LOADER_DLL_NAME}` },
    ], { name: WINDOWS_APP_MANIFEST_NAME, filePath: 'C:\\Build\\kairos.exe.manifest' });

    expect(hooks).toContain('!macro NSIS_HOOK_POSTINSTALL');
    expect(hooks).toContain('SetOutPath "$INSTDIR"');
    expect(hooks).toContain('File /oname=libunwind.dll "C:\\Rust\\libunwind.dll"');
    expect(hooks).toContain(`File /oname=${WEBVIEW2_LOADER_DLL_NAME} "C:\\Rust\\${WEBVIEW2_LOADER_DLL_NAME}"`);
    expect(hooks).toContain('File /oname=kairos.exe.manifest "C:\\Build\\kairos.exe.manifest"');
    expect(hooks).toContain('Delete "$INSTDIR\\libunwind.dll"');
    expect(hooks).toContain(`Delete "$INSTDIR\\${WEBVIEW2_LOADER_DLL_NAME}"`);
    expect(hooks).toContain('Delete "$INSTDIR\\kairos.exe.manifest"');
  });

  it('finds the WebView2 loader from the locked Cargo registry source', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-runtime-'));
    try {
      writeCargoLock(root, '0.38.2');

      const cargoHome = path.join(root, 'cargo');
      const lockedLoader = path.join(
        cargoHome,
        'registry',
        'src',
        'index.crates.io',
        'webview2-com-sys-0.38.2',
        'x64',
        WEBVIEW2_LOADER_DLL_NAME,
      );
      const newerLoader = path.join(
        cargoHome,
        'registry',
        'src',
        'index.crates.io',
        'webview2-com-sys-9.99.0',
        'x64',
        WEBVIEW2_LOADER_DLL_NAME,
      );
      mkdirSync(path.dirname(lockedLoader), { recursive: true });
      mkdirSync(path.dirname(newerLoader), { recursive: true });
      writeFileSync(lockedLoader, 'locked', { flag: 'wx' });
      writeFileSync(newerLoader, 'newer', { flag: 'wx' });

      expect(findWebview2LoaderDll({ repoRoot: root, cargoHome, target })).toEqual({
        name: WEBVIEW2_LOADER_DLL_NAME,
        filePath: lockedLoader,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('extracts the WebView2 loader from the offline Cargo crate cache', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-runtime-'));
    try {
      writeCargoLock(root, '0.38.2');

      const cargoHome = path.join(root, 'cargo');
      const staleLoader = path.join(
        cargoHome,
        'registry',
        'src',
        'index.crates.io',
        'webview2-com-sys-9.99.0',
        'x64',
        WEBVIEW2_LOADER_DLL_NAME,
      );
      mkdirSync(path.dirname(staleLoader), { recursive: true });
      writeFileSync(staleLoader, 'stale-source', { flag: 'wx' });

      const payloadRoot = path.join(root, 'payload');
      const crateName = 'webview2-com-sys-0.38.2';
      const payloadLoader = path.join(payloadRoot, crateName, 'x64', WEBVIEW2_LOADER_DLL_NAME);
      mkdirSync(path.dirname(payloadLoader), { recursive: true });
      writeFileSync(payloadLoader, 'loader-bytes', { flag: 'wx' });

      const cratePath = path.join(cargoHome, 'registry', 'cache', 'index.crates.io', `${crateName}.crate`);
      mkdirSync(path.dirname(cratePath), { recursive: true });
      const result = spawnSync('tar', ['-czf', cratePath, '-C', payloadRoot, crateName]);
      expect(result.status).toBe(0);

      const extractedLoader = path.join(root, '.cache', 'webview2', 'x64', WEBVIEW2_LOADER_DLL_NAME);
      expect(findWebview2LoaderDll({ repoRoot: root, cargoHome, target })).toEqual({
        name: WEBVIEW2_LOADER_DLL_NAME,
        filePath: extractedLoader,
      });
      expect(readFileSync(extractedLoader, 'utf8')).toBe('loader-bytes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ships a common-controls v6 manifest for the app executable', () => {
    expect(WINDOWS_APP_MANIFEST).toContain('name="Kairos.app"');
    expect(WINDOWS_APP_MANIFEST).toContain('Microsoft.Windows.Common-Controls');
    expect(WINDOWS_APP_MANIFEST).toContain('version="6.0.0.0"');
    expect(WINDOWS_APP_MANIFEST_NAME).toBe('kairos.exe.manifest');
  });

  it('writes hooks only for the GNULLVM target and always includes the app manifest', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-runtime-'));
    try {
      writeCargoLock(root, '0.38.2');

      const runtimeDir = path.join(root, 'cargo', 'lib', 'rustlib', target, 'bin', 'self-contained');
      mkdirSync(runtimeDir, { recursive: true });
      writeFileSync(path.join(runtimeDir, 'libunwind.dll'), '', { flag: 'wx' });
      const webview2Loader = path.join(
        root,
        'cargo',
        'registry',
        'src',
        'index.crates.io',
        'webview2-com-sys-0.38.2',
        'x64',
        WEBVIEW2_LOADER_DLL_NAME,
      );
      mkdirSync(path.dirname(webview2Loader), { recursive: true });
      writeFileSync(webview2Loader, '', { flag: 'wx' });

      const result = writeWindowsRuntimeHooks({
        repoRoot: root,
        cargoHome: path.join(root, 'cargo'),
        target,
      });
      expect(result?.hookPath).toBe(path.join(root, '.cache', 'windows-runtime-hooks.nsh'));
      expect(result?.dlls.map(({ name }) => name)).toEqual(['libunwind.dll', WEBVIEW2_LOADER_DLL_NAME]);
      expect(result?.webview2Loader?.filePath).toBe(webview2Loader);
      expect(result?.appManifest.name).toBe(WINDOWS_APP_MANIFEST_NAME);
      expect(result?.appManifest.filePath).toBe(path.join(root, '.cache', WINDOWS_APP_MANIFEST_NAME));

      expect(
        writeWindowsRuntimeHooks({
          repoRoot: root,
          cargoHome: path.join(root, 'cargo'),
          target: 'x86_64-pc-windows-msvc',
        }),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
