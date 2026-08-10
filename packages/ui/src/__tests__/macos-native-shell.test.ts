import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const cargoToml = readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const tauriConfig = readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');
const rustShell = readFileSync(path.join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const themeCss = readFileSync(path.join(root, 'src', 'styles', 'theme.css'), 'utf8');
const capabilities = readFileSync(path.join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8');
const capabilitiesConfig = JSON.parse(capabilities);

describe('native desktop shell', () => {
  it('keeps the Tauri feature required for macOS titlebar controls', () => {
    expect(cargoToml).toMatch(/tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"macos-private-api"/s);
    expect(tauriConfig).toContain('"macOSPrivateApi": true');
  });

  it('configures macOS windows with an overlay titlebar but no transparent material', () => {
    expect(rustShell).toContain('.title_bar_style(tauri::TitleBarStyle::Overlay)');
    expect(rustShell).toContain('.traffic_light_position(tauri::LogicalPosition::new(18.0, 17.0))');
    expect(rustShell).not.toContain('.transparent(true)');
    expect(rustShell).not.toContain('tauri::window::Effect::WindowBackground');
    expect(rustShell).not.toContain('tauri::window::EffectState::FollowsWindowActiveState');
  });

  it('configures Windows main windows as solid app-owned titlebar chrome', () => {
    expect(rustShell).toContain('window = apply_native_titlebar_chrome(window)');
    expect(rustShell).toContain('.decorations(false)');
    expect(rustShell).toContain('.shadow(true)');
    expect(rustShell).not.toContain('tauri::window::Effect::Mica');
  });

  it('allows the window commands used by the custom Windows controls', () => {
    expect(capabilities).toContain('"core:window:allow-close"');
    expect(capabilities).toContain('"core:window:allow-is-maximized"');
    expect(capabilities).toContain('"core:window:allow-minimize"');
    expect(capabilities).toContain('"core:window:allow-toggle-maximize"');
  });

  it('allows Tauri window APIs on the origins used by local desktop launch modes', () => {
    const remoteUrls: string[] = capabilitiesConfig.remote.urls;
    const desktopScript: string = packageJson.scripts.desktop;
    const desktopPort = /--default-port\s+(\d+)/.exec(desktopScript)?.[1];

    expect(remoteUrls).toContain('http://127.0.0.1:3333/*');
    expect(remoteUrls).toContain('http://127.0.0.1:5174/*');
    expect(desktopPort).toBeTruthy();
    expect(remoteUrls).toContain(`http://127.0.0.1:${desktopPort}/*`);
  });

  it('enables regular webview zoom shortcuts', () => {
    expect(rustShell).toContain('.zoom_hotkeys_enabled(true)');
    expect(capabilities).toContain('"core:webview:allow-set-webview-zoom"');
  });

  it('keeps solid native-shell styling platform-scoped in CSS', () => {
    expect(themeCss).toContain(':root[data-tauri-native-titlebar]');
    expect(themeCss).toContain(':root[data-tauri-macos]');
    expect(themeCss).toContain(':root[data-tauri-windows]');
    expect(themeCss).toContain('--native-toolbar-bg');
    expect(themeCss).toContain('--native-control-bg');
    expect(themeCss).not.toContain('--native-window-tint');
    expect(themeCss).not.toContain(':root[data-tauri-native-titlebar] body {\n  font-feature-settings: normal;\n  background-image:');
  });
});
