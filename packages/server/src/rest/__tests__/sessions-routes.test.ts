import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSessionRoutes } from '../sessions-routes.js';
import { registerStubRoutes } from '../stub-routes.js';
import {
  applyRename,
  applyPin,
  applyUnpin,
  applyPinnedOrder,
  readOverrides,
  type SessionOverrides,
} from '../session-overrides.js';

const base0: SessionOverrides = { titles: {}, pinned: [] };

describe('session-overrides transforms', () => {
  it('applyRename sets a title, and a blank name clears it', () => {
    const named = applyRename(base0, 's1', '  My Session  ');
    expect(named.titles.s1).toBe('My Session'); // trimmed
    expect(applyRename(named, 's1', '   ').titles.s1).toBeUndefined();
  });

  it('applyPin adds once (idempotent), applyUnpin removes', () => {
    const once = applyPin(base0, 's1');
    expect(once.pinned).toEqual(['s1']);
    expect(applyPin(once, 's1').pinned).toEqual(['s1']); // no dup
    expect(applyUnpin(once, 's1').pinned).toEqual([]);
  });

  it('applyPinnedOrder reorders known pins and drops unknown ids', () => {
    const o: SessionOverrides = { titles: {}, pinned: ['a', 'b', 'c'] };
    const reordered = applyPinnedOrder(o, ['c', 'a', 'zzz']);
    // unknown 'zzz' dropped; 'b' (unmentioned but still pinned) appended.
    expect(reordered.pinned).toEqual(['c', 'a', 'b']);
  });
});

describe('POST /api/sessions/* routes (persisted)', () => {
  let server: Server;
  let baseUrl: string;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-sess-'));
    process.env.KAIROS_HOME = home;
    const app: Express = express();
    app.use(express.json());
    registerSessionRoutes(app);
    registerStubRoutes(app); // prove the real routes win over the 501 catch-all
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env.KAIROS_HOME;
  });

  const post = (p: string, body: unknown) =>
    fetch(baseUrl + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rename persists a title to disk and wins over the 501 catch-all', async () => {
    const res = await post('/api/sessions/rename', { id: 's1', name: 'Hello' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const saved = await readOverrides();
    expect(saved.titles.s1).toBe('Hello');
    // and it really hit disk
    const raw = JSON.parse(await readFile(join(home, 'session-overrides.json'), 'utf8'));
    expect(raw.titles.s1).toBe('Hello');
  });

  it('rename with a blank name clears the override', async () => {
    await post('/api/sessions/rename', { id: 's1', name: 'X' });
    await post('/api/sessions/rename', { id: 's1', name: '' });
    expect((await readOverrides()).titles.s1).toBeUndefined();
  });

  it('rejects a missing id with 400', async () => {
    expect((await post('/api/sessions/rename', { name: 'x' })).status).toBe(400);
  });

  it('pin then unpin round-trips through disk', async () => {
    await post('/api/sessions/pin', { id: 's1' });
    expect((await readOverrides()).pinned).toEqual(['s1']);
    await post('/api/sessions/unpin', { id: 's1' });
    expect((await readOverrides()).pinned).toEqual([]);
  });

  it('pinned-order rejects a non-array and accepts string ids', async () => {
    expect((await post('/api/sessions/pinned-order', { ids: 'nope' })).status).toBe(400);
    await post('/api/sessions/pin', { id: 'a' });
    await post('/api/sessions/pin', { id: 'b' });
    const ok = await post('/api/sessions/pinned-order', { ids: ['b', 'a'] });
    expect(ok.status).toBe(200);
    expect((await readOverrides()).pinned).toEqual(['b', 'a']);
  });
});
