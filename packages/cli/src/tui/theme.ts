/**
 * Kairos TUI Design Tokens
 * Based on DESIGN.md — Calm Technology principles
 */

export const colors = {
  // Primary palette
  primary: '#1e1b4b',      // Deep Indigo
  accent: '#f59e0b',       // Warm Amber
  success: '#059669',      // Sage Green
  warning: '#f97316',      // Soft Coral
  background: '#0f0f23',   // Midnight (terminal)

  // Status colors for agents
  idle: '#6b7280',         // dim gray
  running: '#f59e0b',      // amber
  complete: '#059669',     // green
  failed: '#f97316',       // coral
  blocked: '#9333ea',      // purple

  // Terminal-friendly chalk colors (fallback)
  chalk: {
    idle: 'gray',
    running: 'yellow',
    complete: 'green',
    failed: 'red',
    blocked: 'magenta',
    primary: 'blue',
    accent: 'yellow',
    success: 'green',
    warning: 'red',
  }
} as const;

export const icons = {
  idle: '○',        // open circle — ready, breathing
  running: '◉',     // filled — active, engaged
  complete: '✓',    // check — done, confident
  failed: '✗',      // x — error
  blocked: '◐',     // half — waiting, needs you
  arrow: '→',       // pipeline flow
  connector: '├─',  // tree connector
  lastConnector: '└─', // last tree connector
} as const;

export const spacing = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const;
