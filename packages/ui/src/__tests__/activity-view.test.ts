import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Source-level checks (mirrors agents-sidebar-style.test.ts): the activity view
// is a thin render over the orchestrator REST surface + live events, so we assert
// its load/subscribe/teardown wiring and status vocabulary are present rather
// than mounting the component (no happy-dom in this suite).
const source = readFileSync(
  path.join(__dirname, '..', 'components', 'activity-view.ts'),
  'utf8',
);
const apiSource = readFileSync(
  path.join(__dirname, '..', 'services', 'api.ts'),
  'utf8',
);

describe('activity view wiring', () => {
  it('fetches both the run state and the role catalog on connect', () => {
    expect(source).toContain('getOrchestratorState()');
    expect(source).toContain('getOrchestratorRoles()');
    expect(source).toMatch(/connectedCallback\(\)/);
  });

  it('subscribes to orchestrator live events and tears the subscription down', () => {
    expect(source).toContain("this.events.on('orchestrator:update'");
    expect(source).toContain("this.events?.off('orchestrator:update'");
    expect(source).toMatch(/disconnectedCallback\(\)/);
  });

  it('guards against stale event snapshots via the seq counter', () => {
    expect(source).toContain('next.seq >= this.run.seq');
  });

  it('renders an idle empty state and surfaces blocked reasons', () => {
    expect(source).toContain('No orchestrator run is active');
    expect(source).toContain('blocked-reason');
    expect(source).toContain('blockedReason');
  });

  it('has a status label for every phase status and a liveness label for every verdict', () => {
    for (const s of ['pending', 'ready', 'running', 'blocked', 'done']) {
      expect(source).toContain(`${s}:`);
    }
    for (const l of ['ok', 'soft-stall', 'stalled', 'timeout']) {
      expect(source).toMatch(new RegExp(`['"]?${l.replace('-', '\\-')}['"]?:`));
    }
  });

  it('exposes the read-only orchestrator API methods', () => {
    expect(apiSource).toContain("request<OrchestratorRunState>('/orchestrator/state')");
    expect(apiSource).toContain("request<{ roles: OrchestratorRole[] }>('/orchestrator/roles')");
  });
});
