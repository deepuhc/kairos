import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..');

function source(rel: string): string {
  return readFileSync(path.join(SRC, rel), 'utf8');
}

/** The backdrop rule body for a given selector in a component source. */
function backdropRule(rel: string, selector: string): string {
  const src = source(rel);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(src);
  return match?.[1] ?? '';
}

// Every full-viewport scrim must start below the app chrome on native-titlebar
// platforms, so the in-webview window controls / drag region stay usable while
// a modal is open (GitLab #31). Browser mode falls back to 0 → full viewport.
const OVERLAYS: Array<{ file: string; selector: string }> = [
  { file: 'components/sessions.ts', selector: '.delete-backdrop' },
  { file: 'components/agents-sidebar.ts', selector: '.delete-backdrop' },
  { file: 'components/agents-view.ts', selector: '.resume-backdrop' },
  { file: 'components/whats-new-panel.ts', selector: '.backdrop' },
  { file: 'components/session-preview.ts', selector: '.backdrop' },
  { file: 'components/launch-picker.ts', selector: '.backdrop' },
  { file: 'components/help-drawer.ts', selector: '.backdrop' },
  { file: 'components/testimonials.ts', selector: '.backdrop' },
];

describe('full-viewport overlays clear the custom titlebar', () => {
  it.each(OVERLAYS)('$file $selector insets its top below the chrome', ({ file, selector }) => {
    const rule = backdropRule(file, selector);

    expect(rule).toContain('position: fixed');
    expect(rule).toContain('inset: var(--overlay-top-inset, 0px) 0 0 0');
    // Guard against the old full-viewport scrim slipping back in.
    expect(rule).not.toMatch(/inset:\s*0\s*;/);
  });
});
