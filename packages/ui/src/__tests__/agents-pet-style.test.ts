import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-pet.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

// The sidebar pet is the "Waveform Companion" — five equalizer bars that
// express agent mood through rhythm and color. These tests pin that design
// (deliberately distinct from a geometric-shape-with-eyes mascot).
describe('agents pet styles', () => {
  it('renders exactly five waveform bars', () => {
    const bars = source.match(/<span class="bar"><\/span>/g) ?? [];
    expect(bars).toHaveLength(5);
    expect(source).not.toContain('<polygon class="ring"');
    expect(source).not.toContain('class="eye"');
  });

  it('tints the bars by mood state', () => {
    // Base (idle) uses the accent; each mood recolors the bars.
    expect(cssRule('.bar')).toContain('background: var(--accent');
    expect(cssRule('.sleeping .bar')).toContain('background: var(--neutral-gray)');
    expect(cssRule('.celebrating .bar')).toContain('background: var(--emerald');
    expect(cssRule('.worried .bar')).toContain('background: var(--red');
  });

  it('animates the bars only when motion is allowed', () => {
    expect(source).toContain('@media (prefers-reduced-motion: no-preference)');
    // Each mood has its own rhythm keyframes.
    expect(source).toContain('.idle .bar { animation: wave');
    expect(source).toContain('.working .bar { animation: bounce');
    expect(source).toContain('.sleeping .bar { animation: breathe');
    expect(source).toContain('.worried .bar { animation: erratic');
    expect(source).toContain('@keyframes wave');
    expect(source).toContain('@keyframes bounce');
  });

  it('scales bars from a stable bottom baseline (no layout shift)', () => {
    expect(cssRule('.bar')).toContain('transform-origin: bottom center');
    // The wave/bounce animations scale on Y, so the bars grow upward in place.
    expect(source).toContain('transform: scaleY');
  });

  it('bursts sparkles on celebrate and exposes an accessible label', () => {
    expect(cssRule('.spark')).toContain('background: var(--emerald');
    expect(source).toContain('.celebrating .spark { animation: pop');
    expect(source).toContain('@keyframes pop');
    // The stage is announced to assistive tech with the mood hint.
    expect(source).toContain('role="img"');
    expect(source).toContain('aria-label=${MOOD_HINT[this.mood]}');
  });
});
