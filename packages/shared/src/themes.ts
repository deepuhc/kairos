export interface ThemeDefinition {
  id: string;
  name: string;
  kind: 'dark' | 'light';
  colors: ThemeColors;
}

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentHover: string;
  green: string;
  red: string;
  amber: string;
  blue: string;
}

export const themes: ThemeDefinition[] = [
  {
    id: 'kairos-dark', name: 'Kairos Dark', kind: 'dark',
    colors: {
      bg: '#0f0f14', surface: '#1a1a22', surface2: '#24242e', border: '#2e2e3a',
      text: '#e4e4e8', textDim: '#8b8b9a', accent: '#f5b732', accentHover: '#ffc94d',
      green: '#4ade80', red: '#f87171', amber: '#f5b732', blue: '#60a5fa',
    },
  },
  {
    id: 'dracula', name: 'Dracula', kind: 'dark',
    colors: {
      bg: '#282a36', surface: '#2d2f3d', surface2: '#343746', border: '#44475a',
      text: '#f8f8f2', textDim: '#6272a4', accent: '#bd93f9', accentHover: '#caa6fc',
      green: '#50fa7b', red: '#ff5555', amber: '#f1fa8c', blue: '#8be9fd',
    },
  },
  {
    id: 'nord', name: 'Nord', kind: 'dark',
    colors: {
      bg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', border: '#4c566a',
      text: '#eceff4', textDim: '#81a1c1', accent: '#88c0d0', accentHover: '#8fbcbb',
      green: '#a3be8c', red: '#bf616a', amber: '#ebcb8b', blue: '#81a1c1',
    },
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', kind: 'dark',
    colors: {
      bg: '#1a1b26', surface: '#1e2030', surface2: '#24283b', border: '#2f334d',
      text: '#c0caf5', textDim: '#565f89', accent: '#7aa2f7', accentHover: '#89b4fa',
      green: '#9ece6a', red: '#f7768e', amber: '#e0af68', blue: '#7aa2f7',
    },
  },
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha', kind: 'dark',
    colors: {
      bg: '#1e1e2e', surface: '#252536', surface2: '#313244', border: '#45475a',
      text: '#cdd6f4', textDim: '#6c7086', accent: '#cba6f7', accentHover: '#d4b5f9',
      green: '#a6e3a1', red: '#f38ba8', amber: '#f9e2af', blue: '#89b4fa',
    },
  },
  {
    id: 'github-dark', name: 'GitHub Dark', kind: 'dark',
    colors: {
      bg: '#0d1117', surface: '#161b22', surface2: '#1c2128', border: '#30363d',
      text: '#e6edf3', textDim: '#8b949e', accent: '#58a6ff', accentHover: '#79c0ff',
      green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff',
    },
  },
  {
    id: 'one-dark', name: 'One Dark', kind: 'dark',
    colors: {
      bg: '#1e2127', surface: '#23272e', surface2: '#2c313a', border: '#3e4452',
      text: '#abb2bf', textDim: '#5c6370', accent: '#61afef', accentHover: '#74baff',
      green: '#98c379', red: '#e06c75', amber: '#e5c07b', blue: '#61afef',
    },
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', kind: 'dark',
    colors: {
      bg: '#002b36', surface: '#073642', surface2: '#0a3f4d', border: '#0d4e5e',
      text: '#fdf6e3', textDim: '#839496', accent: '#268bd2', accentHover: '#2aa7f5',
      green: '#859900', red: '#dc322f', amber: '#b58900', blue: '#268bd2',
    },
  },
  {
    id: 'vitesse-dark', name: 'Vitesse Dark', kind: 'dark',
    colors: {
      bg: '#121212', surface: '#1a1a1a', surface2: '#222222', border: '#2e2e2e',
      text: '#dbd7ca', textDim: '#6b6b6b', accent: '#4d9375', accentHover: '#5ba884',
      green: '#4d9375', red: '#cb7676', amber: '#e6cc77', blue: '#6394bf',
    },
  },
  {
    id: 'kairos-light', name: 'Kairos Light', kind: 'light',
    colors: {
      bg: '#ffffff', surface: '#f5f5f7', surface2: '#ececee', border: '#d4d4d8',
      text: '#18181b', textDim: '#71717a', accent: '#d97706', accentHover: '#b45309',
      green: '#16a34a', red: '#dc2626', amber: '#d97706', blue: '#2563eb',
    },
  },
  {
    id: 'github-light', name: 'GitHub Light', kind: 'light',
    colors: {
      bg: '#ffffff', surface: '#f6f8fa', surface2: '#ebeef1', border: '#d0d7de',
      text: '#1f2328', textDim: '#656d76', accent: '#0969da', accentHover: '#0550ae',
      green: '#1a7f37', red: '#cf222e', amber: '#9a6700', blue: '#0969da',
    },
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte', kind: 'light',
    colors: {
      bg: '#eff1f5', surface: '#e6e9ef', surface2: '#dce0e8', border: '#ccd0da',
      text: '#4c4f69', textDim: '#6c6f85', accent: '#8839ef', accentHover: '#7227d9',
      green: '#40a02b', red: '#d20f39', amber: '#df8e1d', blue: '#1e66f5',
    },
  },
  {
    id: 'solarized-light', name: 'Solarized Light', kind: 'light',
    colors: {
      bg: '#fdf6e3', surface: '#eee8d5', surface2: '#e4ddc8', border: '#d6ceb7',
      text: '#073642', textDim: '#586e75', accent: '#268bd2', accentHover: '#2177b0',
      green: '#859900', red: '#dc322f', amber: '#b58900', blue: '#268bd2',
    },
  },
  {
    id: 'rose-pine-dawn', name: 'Rose Pine Dawn', kind: 'light',
    colors: {
      bg: '#faf4ed', surface: '#fffaf3', surface2: '#f2e9e1', border: '#dfdad9',
      text: '#575279', textDim: '#797593', accent: '#907aa9', accentHover: '#7e6a99',
      green: '#56949f', red: '#b4637a', amber: '#ea9d34', blue: '#286983',
    },
  },
];

export function themeToCssVars(theme: ThemeDefinition): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    vars[`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`] = value;
  }
  return vars;
}

export function themeToStyleString(theme: ThemeDefinition): string {
  return Object.entries(themeToCssVars(theme))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}
