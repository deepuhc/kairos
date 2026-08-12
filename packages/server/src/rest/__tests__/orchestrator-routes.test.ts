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
    const body = await res.json();
    expect(body.status).toBe('idle');
    expect(body.phases).toEqual([]);
  });

  it('reflects committed state from disk (wins over the 501 catch-all)', async () => {
    await mutateState((s) => ({ ...s, runId: 'r1', goal: 'ship it', status: 'running' }));
    const res = await fetch(baseUrl + '/api/orchestrator/state');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe('r1');
    expect(body.goal).toBe('ship it');
    expect(body.status).toBe('running');
    expect(body.seq).toBeGreaterThan(0);
  });

  it('exposes the persona catalog + DAG without system prompts', async () => {
    const res = await fetch(baseUrl + '/api/orchestrator/roles');
    expect(res.status).toBe(200);
    const { roles } = await res.json();
    expect(roles.length).toBe(7);
    const pm = roles.find((r: { id: string }) => r.id === 'product-marketing');
    expect(pm.dependsOn).toEqual([]);
    expect(pm.artifact.path).toBe('docs/market-research.md');
    expect(pm.systemPrompt).toBeUndefined(); // not leaked to the client
    const ux = roles.find((r: { id: string }) => r.id === 'ux-designer');
    expect(ux.dependsOn).toEqual(['product-marketing']);
  });
});
