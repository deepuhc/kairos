import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

describe('app shell styles', () => {
  it('keeps top chrome fixed by scrolling the main view area', () => {
    const host = cssRule(':host');
    expect(host).toContain('display: flex');
    expect(host).toContain('flex-direction: column');
    expect(host).toContain('height: 100vh');
    expect(host).toContain('overflow: hidden');
    expect(host).toContain('--app-chrome-height: 65px');
    expect(host).toContain('--overlay-top-inset: 0px');

    const main = cssRule('main');
    expect(main).toContain('flex: 1 1 auto');
    expect(main).toContain('min-height: 0');
    expect(main).toContain('overflow-y: auto');

    expect(cssRule('header')).toContain('flex: none');
    expect(cssRule('.auth-banner')).toContain('flex: none');
  });

  it('Files-view copy does not falsely claim no cloud upload (images may use cloud vision)', () => {
    // The vision path can send images to a cloud provider when no local vision
    // model is configured, so the Files blurb must not promise otherwise.
    expect(source).not.toMatch(/no cloud upload/i);
    expect(source).not.toMatch(/never leaves the machine/i);
    // It should still make clear text extraction is local.
    expect(source).toMatch(/Text extraction runs locally/i);
  });

  it('preserves full-bleed Agents layout and measured page width for other views', () => {
    const fullBleed = cssRule('main.full-bleed');
    expect(fullBleed).toContain('padding: 0');
    expect(fullBleed).toContain('overflow: hidden');

    const viewEnter = cssRule('.view-enter');
    expect(viewEnter).toContain('max-width: 1200px');
    expect(viewEnter).toContain('margin: 0 auto');
  });

  it('keeps header navigation single-line and scrollbar-free when space is tight', () => {
    const nav = cssRule('nav');
    expect(nav).toContain('flex-wrap: nowrap');
    expect(nav).toContain('overflow-x: auto');
    expect(nav).toContain('scrollbar-width: none');

    expect(cssRule('nav::-webkit-scrollbar')).toContain('display: none');
    expect(cssRule('nav button')).toContain('flex: 0 0 auto');
    expect(source).not.toContain('"nav nav"');
  });

  it('renders the header logo as a bare Kalimba mark with no backplate tile', () => {
    // The mark blends with the toolbar by having no tile/glow/border backplate.
    expect(source).not.toContain('class="tile"');
    expect(source).not.toContain('class="tile-glow"');
    expect(source).not.toContain('class="tile-border"');
    // It is the Kalimba (tines + bridge), and it animates on hover / when active.
    expect(source).toContain('class="tine"');
    expect(source).toContain('class="bridge"');
    expect(source).toContain('@keyframes tine-ripple');
    expect(cssRule(':host([agent-active]) .logo-mark')).not.toBe('');
  });

  it('scopes native titlebar chrome to Tauri desktop shells', () => {
    expect(source).toContain("document.documentElement.setAttribute('data-tauri-native-titlebar'");
    expect(source).toContain("document.documentElement.setAttribute('data-tauri-macos'");
    expect(source).toContain("document.documentElement.setAttribute('data-tauri-windows'");

    const nativeHost = cssRule(':host([tauri-native-titlebar])');
    expect(nativeHost).toContain('--app-chrome-height: 45px');
    expect(nativeHost).toContain('--overlay-top-inset: var(--app-chrome-height)');
    expect(nativeHost).toContain('--header-control-size: 30px');
    expect(nativeHost).toContain('--header-control-bg: transparent');
    expect(nativeHost).toContain('--header-control-border: transparent');

    const macHost = cssRule(':host([tauri-macos-titlebar])');
    expect(macHost).toContain('--native-titlebar-left-padding: 104px');

    const windowsHost = cssRule(':host([tauri-windows-titlebar])');
    expect(windowsHost).toContain('--native-titlebar-right-padding: calc(16px + var(--windows-titlebar-control-width))');

    const nativeHeader = cssRule(':host([tauri-native-titlebar]) header');
    expect(nativeHeader).toContain('min-height: 44px');
    expect(nativeHeader).toContain('padding: 5px var(--native-titlebar-right-padding) 5px var(--native-titlebar-left-padding)');
    expect(nativeHeader).toContain('background: var(--native-toolbar-bg');
    expect(nativeHeader).not.toContain('backdrop-filter');
    expect(nativeHeader).not.toContain('-webkit-backdrop-filter');

    const nativeNav = cssRule(':host([tauri-native-titlebar]) nav');
    // Under a native titlebar the nav collapses into a compact rounded pill.
    expect(nativeNav).toContain('border-radius: 100px');
    expect(nativeNav).toContain('background: var(--w4)');
  });

  it('keeps header controls visually quiet until interaction', () => {
    const host = cssRule(':host');
    expect(host).toContain('--header-control-bg: transparent');
    expect(host).toContain('--header-control-border: transparent');

    const activeNav = cssRule('nav button[active]');
    // The active tab reads as a soft filled accent pill (no underline marker).
    expect(activeNav).toContain('background: var(--accent-a18)');
    expect(activeNav).toContain('color: var(--accent)');

    const activeNavUnderline = cssRule('nav button[active]::after');
    expect(activeNavUnderline).toContain('display: none');

    const toggle = cssRule('.theme-toggle');
    expect(toggle).toContain('border: 1px solid var(--header-control-border)');

    const toggleHover = cssRule('.theme-toggle:hover');
    expect(toggleHover).toContain('background: var(--header-control-bg-hover)');
  });

  it('renders Windows window controls outside drag handling', () => {
    expect(source).toContain("this.toggleAttribute('tauri-windows-titlebar'");
    expect(source).toContain("import('@tauri-apps/api/window')");
    expect(source).toContain("this.controlWindow('minimize')");
    expect(source).toContain("this.controlWindow('toggle-maximize')");
    expect(source).toContain("this.controlWindow('close')");

    const controls = cssRule(':host([tauri-windows-titlebar]) .windows-window-controls');
    expect(controls).toContain('position: absolute');
    expect(controls).toContain('right: 0');
    expect(controls).toContain('grid-template-columns: repeat(3, 46px)');

    expect(source).toContain('data-tauri-drag-region="false"');
    expect(source).toContain('aria-label="Minimize window"');
    expect(source).toContain('aria-label="Close window"');
  });
});
