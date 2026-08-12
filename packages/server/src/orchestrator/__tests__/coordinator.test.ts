import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PIPELINE_ROLES, getAgentRole, type AgentRoleId } from '@kairos/personas';
import { Coordinator, type CoordinatorEvent, type RoleRunContext } from '../coordinator.js';

// Build a valid artifact body for a role: long enough + contains every required
// section token, so validateArtifact passes.
function goodArtifact(roleId: AgentRoleId): string {
  const role = getAgentRole(roleId)!;
  const sections = (role.artifact.requiredSections ?? []).join(' and ');
  return `# ${role.name}\n\n${sections} content. ${'x'.repeat(role.artifact.minBytes)}`;
}

describe('Coordinator', () => {
  let home: string;
  let project: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-coord-'));
    project = await mkdtemp(join(tmpdir(), 'kairos-coordp-'));
    process.env.KAIROS_HOME = home;
  });

  afterAll(() => {
    delete process.env.KAIROS_HOME;
  });

  it('drives the full pipeline to done when every role produces a valid artifact', async () => {
    const artifacts = new Map<string, string>();
    const ran: AgentRoleId[] = [];
    const events: CoordinatorEvent['type'][] = [];

    const coord = new Coordinator({
      goal: 'build a todo app',
      projectDir: project,
      executeRole: async (ctx: RoleRunContext) => {
        ran.push(ctx.role.id);
        ctx.heartbeat('fp');
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (path) => artifacts.get(path) ?? null,
      emit: (e) => events.push(e.type),
    });

    const final = await coord.run();
    expect(final.status).toBe('done');
    // Ran in dependency order (the SOP chain).
    expect(ran).toEqual(DEFAULT_PIPELINE_ROLES);
    expect(final.phases.every((p) => p.status === 'done')).toBe(true);
    expect(events[0]).toBe('run:started');
    expect(events.at(-1)).toBe('run:done');
  });

  it('passes upstream artifact paths to each role', async () => {
    const artifacts = new Map<string, string>();
    const upstreamSeen: Record<string, string[]> = {};

    const coord = new Coordinator({
      goal: 'g',
      projectDir: project,
      executeRole: async (ctx) => {
        upstreamSeen[ctx.role.id] = ctx.upstreamArtifacts;
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (p) => artifacts.get(p) ?? null,
    });
    await coord.run();

    expect(upstreamSeen['product-marketing']).toEqual([]); // entry role
    expect(upstreamSeen['ux-designer']).toEqual(['docs/market-research.md']);
    expect(upstreamSeen['software-architect']).toEqual(['docs/ux-spec.md']);
  });

  it('retries a phase whose artifact is invalid, then succeeds', async () => {
    const artifacts = new Map<string, string>();
    let pmAttempts = 0;
    const events: CoordinatorEvent[] = [];

    const coord = new Coordinator({
      goal: 'g',
      projectDir: project,
      maxAttemptsPerPhase: 3,
      executeRole: async (ctx) => {
        if (ctx.role.id === 'product-marketing') {
          pmAttempts++;
          // First attempt writes a too-short (invalid) artifact; second is valid.
          artifacts.set(ctx.role.artifact.path, pmAttempts < 2 ? 'nope' : goodArtifact('product-marketing'));
          return;
        }
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (p) => artifacts.get(p) ?? null,
      emit: (e) => events.push(e),
    });

    const final = await coord.run();
    expect(final.status).toBe('done');
    expect(pmAttempts).toBe(2);
    expect(events.some((e) => e.type === 'phase:retry' && e.role === 'product-marketing')).toBe(true);
    const pm = final.phases.find((p) => p.role === 'product-marketing')!;
    expect(pm.attempts).toBe(2);
  });

  it('blocks a phase after maxAttempts and stops its dependents', async () => {
    const artifacts = new Map<string, string>();
    const ran: AgentRoleId[] = [];

    const coord = new Coordinator({
      goal: 'g',
      projectDir: project,
      maxAttemptsPerPhase: 2,
      executeRole: async (ctx) => {
        ran.push(ctx.role.id);
        // ux-designer never produces a valid artifact.
        if (ctx.role.id === 'ux-designer') {
          artifacts.set(ctx.role.artifact.path, 'too short');
          return;
        }
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (p) => artifacts.get(p) ?? null,
    });

    const final = await coord.run();
    expect(final.status).toBe('blocked');
    const ux = final.phases.find((p) => p.role === 'ux-designer')!;
    expect(ux.status).toBe('blocked');
    expect(ux.blockedReason).toMatch(/too small|missing/);
    // product-marketing completed; ux-designer blocked; NOTHING downstream ran.
    expect(ran.filter((r) => r === 'ux-designer').length).toBe(2); // both attempts
    expect(ran).not.toContain('software-architect');
    // The deadlock sweep marks the stranded dependent blocked (not left silently
    // pending) so the run is fully accounted for — but it never executed.
    const arch = final.phases.find((p) => p.role === 'software-architect')!;
    expect(arch.status).toBe('blocked');
    expect(arch.blockedReason).toContain('deadlock');
  });

  it('blocks a phase whose executor throws every attempt', async () => {
    const artifacts = new Map<string, string>();
    const coord = new Coordinator({
      goal: 'g',
      projectDir: project,
      maxAttemptsPerPhase: 2,
      executeRole: async (ctx) => {
        if (ctx.role.id === 'product-marketing') throw new Error('agent crashed');
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (p) => artifacts.get(p) ?? null,
    });
    const final = await coord.run();
    expect(final.status).toBe('blocked');
    const pm = final.phases.find((p) => p.role === 'product-marketing')!;
    expect(pm.status).toBe('blocked');
    expect(pm.blockedReason).toContain('agent crashed');
  });

  it('never ends in a non-terminal state: a stranded phase is blocked as a deadlock', async () => {
    const artifacts = new Map<string, string>();
    // A roles subset that omits ux-designer's dependency (product-marketing):
    // ux-designer can never become eligible and would otherwise strand at pending.
    const coord = new Coordinator({
      goal: 'g',
      projectDir: project,
      roles: ['ux-designer'],
      executeRole: async (ctx) => {
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (p) => artifacts.get(p) ?? null,
    });
    const final = await coord.run();
    expect(final.status).toBe('blocked'); // NOT left at 'running'
    const ux = final.phases.find((p) => p.role === 'ux-designer')!;
    expect(ux.status).toBe('blocked');
    expect(ux.blockedReason).toContain('deadlock');
    expect(ux.blockedReason).toContain('product-marketing');
  });

  it('records heartbeats as activity on the running phase', async () => {
    const artifacts = new Map<string, string>();
    let clock = 1000;
    const coord = new Coordinator({
      goal: 'g',
      projectDir: project,
      now: () => clock,
      executeRole: async (ctx) => {
        clock += 500;
        ctx.heartbeat('fp-1');
        artifacts.set(ctx.role.artifact.path, goodArtifact(ctx.role.id));
      },
      readArtifact: async (p) => artifacts.get(p) ?? null,
    });
    const final = await coord.run();
    const pm = final.phases.find((p) => p.role === 'product-marketing')!;
    expect(pm.lastActivityAt).toBeGreaterThanOrEqual(1500);
  });
});
