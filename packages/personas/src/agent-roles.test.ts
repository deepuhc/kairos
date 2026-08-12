import { describe, it, expect } from 'vitest';
import {
  AGENT_ROLES,
  DEFAULT_PIPELINE_ROLES,
  getAgentRole,
  nextEligibleRoles,
  validateArtifact,
  type AgentRoleId,
} from './agent-roles.js';

describe('AGENT_ROLES', () => {
  it('defines exactly the 7 team roles', () => {
    expect(AGENT_ROLES.map((r) => r.id).sort()).toEqual(
      ['docs-engineer', 'product-marketing', 'program-manager', 'project-manager', 'qa-engineer', 'software-architect', 'ux-designer'],
    );
  });

  it('every role has a non-trivial system prompt, an artifact path, and a model tier', () => {
    for (const r of AGENT_ROLES) {
      expect(r.systemPrompt.length).toBeGreaterThan(80);
      expect(r.artifact.path).toMatch(/\.md$/);
      expect(['frontier', 'mid', 'cheap']).toContain(r.modelTier);
    }
  });

  it('the pipeline excludes the supervisor Program Manager', () => {
    expect(DEFAULT_PIPELINE_ROLES).not.toContain('program-manager');
    expect(DEFAULT_PIPELINE_ROLES).toContain('product-marketing');
    expect(getAgentRole('program-manager')?.supervisorRole).toBe(true);
  });

  it('dependsOn edges reference only real roles (no dangling DAG edges)', () => {
    const ids = new Set(AGENT_ROLES.map((r) => r.id));
    for (const r of AGENT_ROLES) {
      for (const dep of r.dependsOn) expect(ids.has(dep)).toBe(true);
    }
  });
});

describe('nextEligibleRoles — the DAG', () => {
  it('starts with only Product Marketing (the entry point)', () => {
    expect(nextEligibleRoles(new Set())).toEqual(['product-marketing']);
  });

  it('unlocks each stage strictly in SOP order', () => {
    const done = new Set<AgentRoleId>();
    const order: AgentRoleId[] = [];
    // Drive the DAG to completion, always taking the first eligible role.
    for (let i = 0; i < 10; i++) {
      const next = nextEligibleRoles(done);
      if (!next.length) break;
      order.push(next[0]);
      done.add(next[0]);
    }
    expect(order).toEqual([
      'product-marketing', 'ux-designer', 'software-architect',
      'project-manager', 'qa-engineer', 'docs-engineer',
    ]);
  });

  it('does not unlock UX before market research exists', () => {
    expect(nextEligibleRoles(new Set())).not.toContain('ux-designer');
  });
});

describe('validateArtifact', () => {
  const pm = getAgentRole('product-marketing')!;

  it('fails a missing artifact', () => {
    expect(validateArtifact(pm, null).ok).toBe(false);
  });

  it('fails a too-small artifact', () => {
    expect(validateArtifact(pm, 'tiny').ok).toBe(false);
  });

  it('fails when a required section is absent', () => {
    const big = 'x'.repeat(600); // long enough, but no "competit"/"recommend"
    const res = validateArtifact(pm, big);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing required content/);
  });

  it('passes a complete artifact (case-insensitive section match)', () => {
    const body = '# Research\n' + 'Competitive matrix here. '.repeat(20) + '\nRECOMMENDATIONS: do X.';
    expect(validateArtifact(pm, body).ok).toBe(true);
  });

  it('program-manager ledger has no minimum (it starts empty)', () => {
    const prog = getAgentRole('program-manager')!;
    expect(validateArtifact(prog, '').ok).toBe(true);
  });
});
