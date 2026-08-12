import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readState,
  mutateState,
  logEvent,
  appendLedger,
  formatLedgerLine,
  type OrchestratorState,
} from '../state.js';

describe('orchestrator state store', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-orch-'));
    process.env.KAIROS_HOME = home;
  });

  afterAll(() => {
    delete process.env.KAIROS_HOME;
  });

  it('returns an idle empty state when no file exists', async () => {
    const s = await readState();
    expect(s.status).toBe('idle');
    expect(s.phases).toEqual([]);
    expect(s.seq).toBe(0);
  });

  it('mutateState persists to disk and bumps seq + updatedAt', async () => {
    const before = Date.now();
    const s1 = await mutateState((s) => ({ ...s, runId: 'r1', goal: 'build X', status: 'running' }));
    expect(s1.runId).toBe('r1');
    expect(s1.seq).toBe(1);
    expect(s1.updatedAt).toBeGreaterThanOrEqual(before);

    const raw = JSON.parse(await readFile(join(home, 'orchestrator-state.json'), 'utf8'));
    expect(raw.runId).toBe('r1');
    expect(raw.status).toBe('running');

    const s2 = await mutateState((s) => ({ ...s, status: 'done' }));
    expect(s2.seq).toBe(2); // monotonic
  });

  it('tolerates a malformed state file', async () => {
    await writeFile(join(home, 'orchestrator-state.json'), '{not json', 'utf8');
    const s = await readState();
    expect(s.status).toBe('idle');
  });
});

describe('PROGRESS.md ledger', () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'kairos-proj-'));
  });

  it('formatLedgerLine renders a minute-precision timestamp line', () => {
    const line = formatLedgerLine(new Date('2026-08-12T09:05:30.123Z'), 'phase ux-designer → running');
    expect(line).toBe('- 2026-08-12 09:05Z phase ux-designer → running');
  });

  it('creates PROGRESS.md with the run-log header on first append', async () => {
    await appendLedger(project, 'run started', new Date('2026-08-12T09:00:00Z'));
    const md = await readFile(join(project, 'PROGRESS.md'), 'utf8');
    expect(md).toContain('## Orchestrator run log');
    expect(md).toContain('- 2026-08-12 09:00Z run started');
  });

  it('appends under an existing run-log section without duplicating the header', async () => {
    await appendLedger(project, 'line 1', new Date('2026-08-12T09:00:00Z'));
    await appendLedger(project, 'line 2', new Date('2026-08-12T09:01:00Z'));
    const md = await readFile(join(project, 'PROGRESS.md'), 'utf8');
    expect(md.match(/## Orchestrator run log/g)?.length).toBe(1);
    expect(md.indexOf('line 1')).toBeLessThan(md.indexOf('line 2'));
  });

  it('preserves pre-existing PROGRESS.md content above the run log', async () => {
    await writeFile(join(project, 'PROGRESS.md'), '# My Project\n\nSome notes.\n', 'utf8');
    await appendLedger(project, 'run started', new Date('2026-08-12T09:00:00Z'));
    const md = await readFile(join(project, 'PROGRESS.md'), 'utf8');
    expect(md).toContain('# My Project');
    expect(md).toContain('Some notes.');
    expect(md).toContain('## Orchestrator run log');
  });
});

describe('logEvent dual write', () => {
  let home: string;
  let project: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-dw-'));
    project = await mkdtemp(join(tmpdir(), 'kairos-dwp-'));
    process.env.KAIROS_HOME = home;
  });

  afterAll(() => {
    delete process.env.KAIROS_HOME;
  });

  it('updates machine state AND the ledger in one call', async () => {
    const next: OrchestratorState = await logEvent(
      project,
      'phase product-marketing → done',
      (s) => ({ ...s, runId: 'r1', status: 'running' }),
    );
    expect(next.runId).toBe('r1');
    // machine state on disk
    const raw = JSON.parse(await readFile(join(home, 'orchestrator-state.json'), 'utf8'));
    expect(raw.runId).toBe('r1');
    // ledger on disk
    const md = await readFile(join(project, 'PROGRESS.md'), 'utf8');
    expect(md).toContain('phase product-marketing → done');
  });
});
