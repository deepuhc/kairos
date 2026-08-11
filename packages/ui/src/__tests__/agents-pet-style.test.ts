// Copyright 2024-2026 MathWorks, Inc.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-pet.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

describe('agents pet styles', () => {
  it('keeps waveform bars visible across mood states', () => {
    const bar = cssRule('.bar');
    expect(bar).toContain('background: var(--accent');
    expect(bar).toContain('border-radius: 2px');

    // Base idle heights form a wave pattern
    expect(source).toContain('.bar:nth-child(3) { height: 22px; }');
  });

  it('uses visible bar animations without moving the whole stage', () => {
    // Working mode: energetic bounce on bars
    expect(source).toContain('.working .bar { animation: bounce');
    expect(source).toContain('@keyframes bounce');
    // Idle mode: gentle wave
    expect(source).toContain('.idle .bar { animation: wave');
    expect(source).toContain('@keyframes wave');
  });

  it('renders waveform stage without tile or backplate elements', () => {
    expect(source).not.toContain('class="tile"');
    expect(source).not.toContain('class="tile-glow"');
    expect(source).not.toContain('class="tile-border"');
    expect(source).not.toContain('class="mark-shadow"');
    // Waveform bars are spans, not SVG polygons
    expect(source).toContain('<span class="bar">');
  });

  it('keeps the waveform stage within a fixed-size container', () => {
    const stage = cssRule('.stage');
    expect(stage).toContain('width: 36px');
    expect(stage).toContain('height: 32px');
    expect(stage).toContain('display: flex');
  });

  it('avoids zoom-sensitive transforms on individual bars while animating', () => {
    // bars use transform: scaleY(...) with transform-origin: bottom center
    expect(source).toContain('transform-origin: bottom center');
    // No transform-box on bar rules (which would cause zoom jitter)
    const barRule = cssRule('.bar');
    expect(barRule).not.toContain('transform-box');

    expect(source).toContain('@keyframes wave');
    expect(source).toContain('@keyframes bounce');
    expect(source).toContain('@keyframes breathe');
  });
});
