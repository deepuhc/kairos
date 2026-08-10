// Theme controller.
//
// A theme has a `kind` (light | dark). The user picks three things, kept
// independently in localStorage:
//   • mode         — `system` (default, follow the OS), `light`, or `dark`
//   • dark theme   — which dark theme to use when a dark theme is showing
//   • light theme  — which light theme to use when a light theme is showing
//
// The mode decides which KIND is active; the matching slot decides WHICH theme
// of that kind. In `system` mode the OS `prefers-color-scheme` picks the kind,
// so you get your chosen light theme by day and your chosen dark theme by night
// (mirroring VS Code's "preferred light/dark theme" auto-switch).
//
// The active theme is written to two attributes on <html>:
//   • data-theme='<id>'         — per-theme palette block in theme.css
//   • data-theme-kind='<kind>'  — structural light/dark flips shared by a kind
//
// The initial attributes are set by an inline script in index.html before first
// paint, so there's no flash of the wrong theme. This module reuses the same
// keys and logic for runtime changes. The theme catalog (pure data) lives in
// theme-catalog.ts so it's importable without a DOM.

import {
  THEMES,
  DARK_THEMES,
  LIGHT_THEMES,
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  isKnown,
  type ThemeKind,
  type ThemeDef,
} from './theme-catalog.js';

export { THEMES, DARK_THEMES, LIGHT_THEMES, type ThemeKind, type ThemeDef };
export type ThemeMode = 'system' | 'light' | 'dark';

const MODE_KEY = 'kairos-theme';
const DARK_KEY = 'kairos-theme-dark';
const LIGHT_KEY = 'kairos-theme-light';

// Pre-Kairos key names. Migrated once below so a user who set a theme under
// the old build keeps it; kept in lockstep with the pre-paint script in
// index.html, which reads the same new keys with the same legacy fallback.
const LEGACY_KEYS: Record<string, string> = {
  [MODE_KEY]: 'kairos-ui-theme',
  [DARK_KEY]: 'kairos-ui-theme-dark',
  [LIGHT_KEY]: 'kairos-ui-theme-light',
};

// One-time copy of any legacy theme keys to their new names. Runs before the
// first read; a no-op once migrated (or for a fresh install). Best-effort —
// private-mode localStorage throws, and a lost theme preference is harmless.
function migrateLegacyThemeKeys() {
  try {
    for (const [newKey, oldKey] of Object.entries(LEGACY_KEYS)) {
      if (localStorage.getItem(newKey) === null) {
        const legacy = localStorage.getItem(oldKey);
        if (legacy !== null) localStorage.setItem(newKey, legacy);
      }
    }
  } catch {}
}

migrateLegacyThemeKeys();

const media = window.matchMedia('(prefers-color-scheme: light)');

export function getMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
}

export function getDarkTheme(): string {
  const stored = localStorage.getItem(DARK_KEY);
  return isKnown(stored, 'dark') ? (stored as string) : DEFAULT_DARK;
}

export function getLightTheme(): string {
  const stored = localStorage.getItem(LIGHT_KEY);
  return isKnown(stored, 'light') ? (stored as string) : DEFAULT_LIGHT;
}

// Which KIND is showing right now, given the mode and (for `system`) the OS.
export function resolveKind(mode: ThemeMode = getMode()): ThemeKind {
  if (mode === 'system') return media.matches ? 'light' : 'dark';
  return mode;
}

// The theme id that should be applied right now.
export function resolveThemeId(mode: ThemeMode = getMode()): string {
  return resolveKind(mode) === 'light' ? getLightTheme() : getDarkTheme();
}

function apply(id: string, kind: ThemeKind) {
  const root = document.documentElement;
  root.setAttribute('data-theme', id);
  root.setAttribute('data-theme-kind', kind);
}

function reapply() {
  const kind = resolveKind();
  apply(kind === 'light' ? getLightTheme() : getDarkTheme(), kind);
  window.dispatchEvent(new CustomEvent('theme-changed'));
}

export function setMode(mode: ThemeMode) {
  localStorage.setItem(MODE_KEY, mode);
  reapply();
}

export function setDarkTheme(id: string) {
  if (!isKnown(id, 'dark')) return;
  localStorage.setItem(DARK_KEY, id);
  reapply();
}

export function setLightTheme(id: string) {
  if (!isKnown(id, 'light')) return;
  localStorage.setItem(LIGHT_KEY, id);
  reapply();
}

// Re-apply when the OS theme flips, but only while in `system` mode.
media.addEventListener('change', () => {
  if (getMode() === 'system') reapply();
});

// Ensure the runtime state matches the (inline-script-set) attributes.
apply(resolveThemeId(), resolveKind());
