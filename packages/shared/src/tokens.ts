export const tokens = {
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
    sizeXs: '0.7rem',
    sizeSm: '0.8rem',
    sizeMd: '0.875rem',
    sizeLg: '1rem',
    sizeXl: '1.2rem',
  },
  transition: {
    fast: '150ms ease',
    normal: '250ms ease',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.1)',
    md: '0 4px 6px rgba(0,0,0,0.15)',
    lg: '0 10px 15px rgba(0,0,0,0.2)',
  },
} as const;
