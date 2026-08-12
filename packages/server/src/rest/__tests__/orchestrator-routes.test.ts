import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOrchestratorRoutes } from '../orchestrator-routes.js';
import { registerStubRoutes } from '../stub-routes.js';
import { mutateState } from '../../orchestrator/state.js';

const readJson = async (res: Response): Promise<any> => res.json();

describe('GET /api/orchestrator/* routes', () => {
  let server: Server;
  let baseUrl: string;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-orchr-'));
    process.env.KAIROS_HOME = home;
    const app: Express = express();
    app.use(express.json());
    registerOrchestratorRoutes(app);
    registerStubRoutes(app); // prove the real routes win over the 501 catch-all
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    delete process.env.KAIROS_HOME;
  });

  it('returns an idle empty state when no run exists', async () => {
    const res = await fetch(baseUrl + '/api/orchestrator/state');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.status).toBe('idle');
    expect(body.phases).toEqual([]);
  });

  it('reflects committed state from disk (wins over the 501 catch-all)', async () => {
    await mutateState((s) => ({ ...s, runId: 'r1', goal: 'ship it', status: 'running' }));
    const res = await fetch(baseUrl + '/api/orchestrator/state');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.runId).toBe('r1');
    expect(body.goal).toBe('ship it');
    expect(body.status).toBe('running');
    expect(body.seq).toBeGreaterThan(0);
  });

  it('exposes the persona catalog + DAG without system prompts', async () => {
    const res = await fetch(baseUrl + '/api/orchestrator/roles');
    expect(res.status).toBe(200);
    const { roles } = await readJson(res);
    expect(roles.length).toBe(7);
    const pm = roles.find((r: { id: string }) => r.id === 'product-marketing');
    expect(pm.dependsOn).toEqual([]);
    expect(pm.artifact.path).toBe('docs/market-research.md');
    expect(pm.systemPrompt).toBeUndefined(); // not leaked to the client
    const ux = roles.find((r: { id: string }) => r.id === 'ux-designer');
    expect(ux.dependsOn).toEqual(['product-marketing']);
  });

  it('does not register POST /start when no RunManager is provided', async () => {
    // This suite registers routes without a RunManager, so /start hits the 501.
    const res = await fetch(baseUrl + '/api/orchestrator/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'g', projectDir: '/tmp' }),
    });
    expect(res.status).toBe(501);
    expect((await readJson(res)).unsupported).toBe(true);
  });
});

describe('POST /api/orchestrator/start (with a RunManager)', () => {
  let server: Server;
  let baseUrl: string;
  let home: string;
  let started: Array<{ goal: string; projectDir: string }>;
  let running: boolean;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-orchs-'));
    process.env.KAIROS_HOME = home;
    started = [];
    running = false;
    const fakeRunManager = {
      get isRunning() { return running; },
      start: async (goal: string, projectDir: string) => {
        started.push({ goal, projectDir });
        return {} as never;
      },
    };
    const app: Express = express();
    app.use(express.json());
    registerOrchestratorRoutes(app, fakeRunManager as never);
    registerStubRoutes(app);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    delete process.env.KAIROS_HOME;
  });

  const post = (p: string, body: unknown) =>
    fetch(baseUrl + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('starts a run and returns { started: true }', async () => {
    const res = await post('/api/orchestrator/start', { goal: 'ship it', projectDir: '/tmp/proj' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: true });
    expect(started).toEqual([{ goal: 'ship it', projectDir: '/tmp/proj' }]);
  });

  it('rejects a missing goal or projectDir with 400', async () => {
    expect((await post('/api/orchestrator/start', { projectDir: '/tmp' })).status).toBe(400);
    expect((await post('/api/orchestrator/start', { goal: 'g' })).status).toBe(400);
  });

  it('returns 409 when a run is already active', async () => {
    running = true;
    const res = await post('/api/orchestrator/start', { goal: 'g', projectDir: '/tmp' });
    expect(res.status).toBe(409);
  });
});
