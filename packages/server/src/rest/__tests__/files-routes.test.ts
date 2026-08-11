import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { registerFileRoutes, safeResolve } from '../files-routes.js';
import { registerStubRoutes } from '../stub-routes.js';

let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kairos-files-'));
  await writeFile(join(dir, 'a.txt'), 'hello');
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'sub', 'b.txt'), 'world');
  await mkdir(join(dir, 'node_modules'));
  await writeFile(join(dir, 'node_modules', 'skip.js'), 'nope');
  // A NUL byte marks a binary file for the read sniff.
  await writeFile(join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));

  const app: Express = express();
  registerFileRoutes(app);
  registerStubRoutes(app); // prove the real routes win over the 501 catch-all
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const get = (p: string) => fetch(base + p);
const readJson = async (res: Response): Promise<any> => res.json();

describe('safeResolve', () => {
  it('expands ~ and keeps paths within the root', () => {
    const loc = safeResolve('~', 'x');
    expect(loc?.root).toBe(homedir());
    expect(loc?.abs).toBe(join(homedir(), 'x'));
  });
  it('rejects a path that escapes the root', () => {
    expect(safeResolve('/tmp/root', '../../etc/passwd')).toBeNull();
  });
});

describe('GET /api/files/list', () => {
  it('lists a directory, dirs first then alphabetical', async () => {
    const res = await get(`/api/files/list?cwd=${encodeURIComponent(dir)}&path=`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const names = body.entries.map((e: any) => e.name);
    // node_modules + sub are dirs (come first), then files a.txt, bin.dat.
    expect(names.indexOf('sub')).toBeLessThan(names.indexOf('a.txt'));
    expect(body.entries.find((e: any) => e.name === 'sub').kind).toBe('dir');
    expect(body.truncated).toBe(false);
  });

  it('rejects a path that escapes cwd with 400', async () => {
    const res = await get(`/api/files/list?cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent('../..')}`);
    expect(res.status).toBe(400);
  });

  it('404s a nonexistent directory', async () => {
    const res = await get(`/api/files/list?cwd=${encodeURIComponent(join(dir, 'nope'))}&path=`);
    expect(res.status).toBe(404);
  });

  it('requires cwd', async () => {
    expect((await get('/api/files/list')).status).toBe(400);
  });
});

describe('GET /api/files/read', () => {
  it('reads a text file', async () => {
    const res = await get(`/api/files/read?cwd=${encodeURIComponent(dir)}&path=a.txt`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toMatchObject({ content: 'hello', binary: false, truncated: false });
  });

  it('flags a binary file without returning its bytes', async () => {
    const res = await get(`/api/files/read?cwd=${encodeURIComponent(dir)}&path=bin.dat`);
    const body = await readJson(res);
    expect(body.binary).toBe(true);
    expect(body.content).toBe('');
  });

  it('404s a missing file', async () => {
    const res = await get(`/api/files/read?cwd=${encodeURIComponent(dir)}&path=missing.txt`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/files/all', () => {
  it('walks the tree and skips node_modules', async () => {
    const res = await get(`/api/files/all?cwd=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.files).toContain('a.txt');
    expect(body.files).toContain(join('sub', 'b.txt'));
    expect(body.files.some((f: string) => f.includes('node_modules'))).toBe(false);
  });
});
