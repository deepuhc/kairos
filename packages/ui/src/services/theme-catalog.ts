// The theme catalog — pure data, no DOM. Kept separate from theme.ts (the
// controller, which touches window/localStorage) so it's importable anywhere,
// including the server-side test runner that has no DOM.

export type ThemeKind = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  name: string;
  kind: ThemeKind;
  // [background, surface, accent] — drives the picker's little preview swatch.
  swatch: [string, string, string];
}

// Curated from the most-installed VS Code themes. The first entry of each kind
// is the built-in devai default (the near-monochrome blue identity).
export const THEMES: ThemeDef[] = [
  { id: 'kairos-dusk', name: 'Kairos Dusk', kind: 'dark', swatch: ['#1C1917', '#292524', '#F59E0B'] },
  { id: 'kairos-dark', name: 'Kairos Dark', kind: 'dark', swatch: ['#1c1c1e', '#2c2c2e', '#007aff'] },
  { id: 'nord', name: 'Nord', kind: 'dark', swatch: ['#2e3440', '#3b4252', '#88c0d0'] },
  { id: 'dracula', name: 'Dracula', kind: 'dark', swatch: ['#282a36', '#343746', '#bd93f9'] },
  { id: 'catppuccin-mocha', name: 'Catppuccin', kind: 'dark', swatch: ['#1e1e2e', '#313244', '#89b4fa'] },

  { id: 'kairos-dawn', name: 'Kairos Dawn', kind: 'light', swatch: ['#FAFAF8', '#FFFFFF', '#D97706'] },
  { id: 'kairos-light', name: 'Kairos Aqua', kind: 'light', swatch: ['#f5f5f7', '#ffffff', '#007aff'] },
  { id: 'solarized-light', name: 'Solarized', kind: 'light', swatch: ['#fdf6e3', '#eee8d5', '#268bd2'] },
  { id: 'catppuccin-latte', name: 'Catppuccin', kind: 'light', swatch: ['#eff1f5', '#ffffff', '#1e66f5'] },
];

export const DARK_THEMES = THEMES.filter((t) => t.kind === 'dark');
export const LIGHT_THEMES = THEMES.filter((t) => t.kind === 'light');

export const DEFAULT_DARK = 'kairos-dusk';
export const DEFAULT_LIGHT = 'kairos-dawn';

export function themeKind(id: string): ThemeKind | null {
  return THEMES.find((t) => t.id === id)?.kind ?? null;
}

export function isKnown(id: string | null, kind: ThemeKind): boolean {
  return THEMES.some((t) => t.id === id && t.kind === kind);
}
