import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { registerStubRoutes } from '../stub-routes.js';

// Boots a real Express app with the stub routes (plus one "real" route mounted
// before them) and exercises it over HTTP via fetch.
let server: Server;
let base: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  // A real route mounted BEFORE the stubs must win over the catch-all.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', real: true }));
  registerStubRoutes(app);

  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('Phase-C REST stubs', () => {
  it('does not shadow real routes registered before it', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', real: true });
  });

  it('serves boot-critical GETs with empty-but-valid shapes', async () => {
    const cases: Array<[string, (body: any) => void]> = [
      ['/api/auth/status', (b) => expect(b).toMatchObject({ loggedIn: false, user: null })],
      ['/api/workspaces', (b) => expect(b.workspaces).toEqual([])],
      ['/api/sessions', (b) => expect(b.sessions).toEqual([])],
      ['/api/agents/roles', (b) => expect(b.roles).toEqual([])],
      ['/api/agents/prefs', (b) => expect(b.prefs).toMatchObject({ autoAccept: false })],
      ['/api/config/status', (b) => expect(b.profiles).toEqual([])],
      ['/api/features/list', (b) => expect(b.items).toEqual([])],
      ['/api/usage', (b) => expect(b.users).toEqual([])],
      ['/api/system/version', (b) => expect(typeof b.version).toBe('string')],
    ];
    for (const [path, assert] of cases) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      assert(await res.json());
    }
  });

  it('returns 501 { unsupported: true } for unimplemented GET routes', async () => {
    const res = await fetch(`${base}/api/does/not/exist`);
    expect(res.status).toBe(501);
    const body = await res.json() as { unsupported: boolean; error: string };
    expect(body.unsupported).toBe(true);
    expect(body.error).toMatch(/not implemented/i);
  });

  it('returns 501 { unsupported: true } for unimplemented POST actions', async () => {
    const res = await fetch(`${base}/api/sessions/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    });
    expect(res.status).toBe(501);
    expect((await res.json() as { unsupported: boolean }).unsupported).toBe(true);
  });
});
