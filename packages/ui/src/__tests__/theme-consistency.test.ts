import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { THEMES, DARK_THEMES, LIGHT_THEMES } from '../services/theme-catalog.js';

// Guards the theme catalog against drift between the TypeScript registry
// (services/theme.ts), the CSS palette blocks (styles/theme.css), and the
// pre-paint inline script (index.html). Adding a theme to THEMES without a
// matching `:root[data-theme='<id>']` block would render it with the wrong
// palette; the whole system is otherwise untyped CSS, so nothing else catches it.

const SRC = path.join(__dirname, '..');
const css = readFileSync(path.join(SRC, 'styles', 'theme.css'), 'utf8');
const indexHtml = readFileSync(path.join(SRC, 'index.html'), 'utf8');

// kairos-light is carried by the :root baseline (aqua) so it needs no block.
const NO_PALETTE_BLOCK = new Set(['kairos-light']);

describe('theme registry', () => {
  it('has at least one dark and one light theme', () => {
    expect(DARK_THEMES.length).toBeGreaterThan(0);
    expect(LIGHT_THEMES.length).toBeGreaterThan(0);
  });

  it('has unique, non-empty theme ids', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('gives every theme a three-color swatch', () => {
    for (const t of THEMES) {
      expect(t.swatch, t.id).toHaveLength(3);
      for (const c of t.swatch) expect(c, t.id).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('theme.css palette blocks', () => {
  for (const t of THEMES) {
    if (NO_PALETTE_BLOCK.has(t.id)) continue;
    it(`defines a palette block + accent for "${t.id}"`, () => {
      // The block exists...
      const block = new RegExp(`:root\\[data-theme='${t.id}'\\]\\s*\\{([^}]*)\\}`).exec(css);
      expect(block, `missing :root[data-theme='${t.id}'] block`).not.toBeNull();
      const body = block![1];
      // ...and sets both the accent color and its rgb triple, since every wash
      // in the app derives from --accent-rgb.
      expect(body, `${t.id} missing --accent`).toMatch(/--accent:\s*#[0-9a-fA-F]{6}/);
      expect(body, `${t.id} missing --accent-rgb`).toMatch(/--accent-rgb:\s*\d+,\s*\d+,\s*\d+/);
      // ...and repoints the canvas so it doesn't inherit the wrong base.
      expect(body, `${t.id} missing --bg-base`).toMatch(/--bg-base:/);
    });
  }

  it('sets data-theme-kind="light" for the shared light structural block', () => {
    expect(css).toMatch(/:root\[data-theme-kind='light'\]\s*\{/);
  });
});

describe('index.html pre-paint script', () => {
  it('defaults match the theme service defaults', () => {
    expect(indexHtml).toContain("'kairos-light'");
    expect(indexHtml).toContain("'kairos-dark'");
    expect(indexHtml).toContain('kairos-');
    expect(indexHtml).toContain('theme-light');
    expect(indexHtml).toContain('theme-dark');
  });

  it('sets both data-theme and data-theme-kind before paint', () => {
    expect(indexHtml).toContain("setAttribute('data-theme'");
    expect(indexHtml).toContain("setAttribute('data-theme-kind'");
  });
});
