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
  it('keeps Poly eyes visible across light and dark themes', () => {
    const eye = cssRule('.eye');
    expect(eye).toContain('fill: var(--on-accent');
    expect(eye).toContain('stroke: rgba(5, 12, 22, 0.42)');
    expect(eye).toContain('filter: drop-shadow');
    expect(eye).not.toContain('var(--bright-white');

    expect(source).toContain("const LEFT_EYE_X = 25.75;");
    expect(source).toContain("const RIGHT_EYE_X = 32.25;");
    expect(source).toContain("const rx = this.mood === 'worried' ? 3.05 : 2.75;");
    expect(source).toContain("const ry = this.mood === 'worried' ? 3.15 : 2.85;");
  });

  it('uses visible face motion without moving the whole hub', () => {
    expect(source).toContain('.working .pupils { animation: scan 2.4s ease-in-out infinite; }');
    expect(source).toContain('@keyframes scan');
  });

  it('renders Poly without an app-icon tile or backplate', () => {
    expect(source).not.toContain('class="tile"');
    expect(source).not.toContain('class="tile-glow"');
    expect(source).not.toContain('class="tile-border"');
    expect(source).not.toContain('class="mark-shadow"');
    expect(source).toContain('<polygon class="ring"');
    expect(source).toContain('r="3.35"');
  });

  it('keeps the spinning network attached to the hexagon frame', () => {
    expect(source).toContain('<svg class="poly-net" viewBox="0 0 58 58">');
    expect(source).toContain('<g class="net">\n                <polygon class="ring" points=${HEX_POINTS} />');
    expect(source).not.toContain('<polygon class="ring" points=${HEX_POINTS} />\n            <g class="net">');
    expect(source).toContain('.working .poly-net { animation: spin 6s linear infinite; }');
    expect(source).not.toContain('.working .net { animation: spin');
    expect(source).toContain('@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }');
  });

  it('avoids zoom-sensitive SVG child scaling while the network spins', () => {
    expect(cssRule('.nodes circle')).not.toContain('transform-box');
    expect(cssRule('.nodes circle')).not.toContain('transform-origin');
    expect(source).toContain('@keyframes nodepulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }');
  });
});
