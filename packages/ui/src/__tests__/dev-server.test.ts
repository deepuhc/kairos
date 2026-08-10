import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error - plain ESM script without type declarations
import { parseBackendPort, portConflictMessage } from '../../scripts/lib/dev-server.mjs';

const viteConfig = readFileSync(path.join(__dirname, '..', '..', 'vite.config.ts'), 'utf8');

describe('dev-server', () => {
  it('parses valid backend ports', () => {
    expect(parseBackendPort('3334')).toBe(3334);
  });

  it('falls back for invalid backend ports', () => {
    expect(parseBackendPort('abc')).toBe(3333);
    expect(parseBackendPort('70000')).toBe(3333);
    expect(parseBackendPort('0')).toBe(3333);
  });

  it('prints an actionable port conflict message', () => {
    const message = portConflictMessage(3333);

    expect(message).toContain('Port 3333 is already in use');
    expect(message).toContain('KAIROS_PORT=3334 npm run dev');
    expect(message).toContain('lsof -nP -iTCP:3333 -sTCP:LISTEN');
  });

  it('can point the port conflict message at another launch command', () => {
    const message = portConflictMessage(3000, 'npm run dev', 'KAIROS_PORT');

    expect(message).toContain('Port 3000 is already in use');
    expect(message).toContain('KAIROS_PORT=3001 npm run dev');
  });

  it('proxies all backend websocket routes in Vite dev mode', () => {
    expect(viteConfig).toContain("'/acp'");
    expect(viteConfig).toContain("'/events'");
    expect(viteConfig).toContain("'/terminal'");
    expect(viteConfig.match(/ws:\s*true/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
