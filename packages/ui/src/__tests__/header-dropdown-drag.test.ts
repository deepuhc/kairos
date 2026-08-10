import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', 'components');

function source(file: string): string {
  return readFileSync(path.join(SRC, file), 'utf8');
}

function menuTemplate(file: string): string {
  const src = source(file);
  const start = src.indexOf('class="menu"');
  return start === -1 ? '' : src.slice(start, start + 260);
}

describe('header dropdown drag handling', () => {
  it.each(['theme-picker.ts', 'user-menu.ts', 'presence-pill.ts'])('%s opts menu interactions out of titlebar dragging', (file) => {
    const menu = menuTemplate(file);

    expect(menu).toContain('data-tauri-drag-region="false"');
    expect(menu).toContain('@pointerdown=${(e: Event) => e.stopPropagation()}');
    expect(menu).toContain('@mousedown=${(e: Event) => e.stopPropagation()}');
  });

  it('presence popup exposes a hide entry point', () => {
    const src = source('presence-pill.ts');

    expect(src).toContain('Hide online users pill');
    expect(src).toContain('setShowOnlineUsers(false)');
  });

  it('polls presence at a five minute cadence after the initial load', () => {
    const src = source('presence-pill.ts');

    expect(src).toContain('const POLL_MS = 5 * 60_000;');
    expect(src).toContain('window.setInterval');
  });

  it('keeps release notes out of the account dropdown', () => {
    const src = source('user-menu.ts');

    expect(src).toContain('renderKairosUpdate()');
    expect(src).not.toContain('desktopUpdate.body');
  });
});
