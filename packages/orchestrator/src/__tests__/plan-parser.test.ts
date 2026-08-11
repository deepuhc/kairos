import { describe, it, expect } from 'vitest';
import { parsePlan } from '../plan-parser.js';

describe('parsePlan — task lines', () => {
  it('parses a simple checkbox task into an agent phase', () => {
    const plan = parsePlan('- [ ] build: compile the project');
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({
      id: 'build',
      type: 'agent',
      dependsOn: [],
      prompt: 'compile the project',
    });
  });

  it('accepts checked and unchecked boxes and hyphenated ids', () => {
    const plan = parsePlan(
      ['- [x] step-one: done already', '- [ ] step-two: not yet'].join('\n'),
    );
    expect(plan.phases.map((p) => p.id)).toEqual(['step-one', 'step-two']);
  });

  it('ignores non-task lines (prose, headings, blanks)', () => {
    const plan = parsePlan(
      ['Some intro prose.', '', '## A subheading', '- [ ] a: do a', 'trailing text'].join('\n'),
    );
    expect(plan.phases.map((p) => p.id)).toEqual(['a']);
  });

  it('returns no phases for an empty or prose-only document', () => {
    expect(parsePlan('').phases).toEqual([]);
    expect(parsePlan('just a paragraph, no tasks').phases).toEqual([]);
  });
});

describe('parsePlan — annotations', () => {
  it('extracts [depends: ...] into a trimmed, comma-split dependency list', () => {
    const plan = parsePlan('- [ ] c: run c [depends: a, b]');
    expect(plan.phases[0].dependsOn).toEqual(['a', 'b']);
  });

  it('strips all annotations from the resulting prompt text', () => {
    const plan = parsePlan('- [ ] x: do the thing [depends: a] [role: builder]');
    expect(plan.phases[0].prompt).toBe('do the thing');
    expect(plan.phases[0].role).toBe('builder');
  });

  it('marks [type: gate] phases as gates with a default gate type', () => {
    const plan = parsePlan('- [ ] approve: sign off please [type: gate]');
    const phase = plan.phases[0];
    expect(phase.type).toBe('gate');
    expect(phase.gateType).toBe('human_approval');
    // gateMessage is the cleaned description (annotations stripped).
    expect(phase.gateMessage).toBe('sign off please');
  });

  it('honors an explicit [gate: ...] gate type', () => {
    const plan = parsePlan('- [ ] budget: check spend [type: gate] [gate: budget]');
    expect(plan.phases[0].type).toBe('gate');
    expect(plan.phases[0].gateType).toBe('budget');
  });

  it('marks [type: fanout] phases as fanout', () => {
    const plan = parsePlan('- [ ] spread: parallelize [type: fanout]');
    expect(plan.phases[0].type).toBe('fanout');
  });

  it('defaults to an agent phase when no type annotation is present', () => {
    expect(parsePlan('- [ ] a: plain task').phases[0].type).toBe('agent');
  });
});

describe('parsePlan — plan name', () => {
  it('uses an explicitly provided name', () => {
    expect(parsePlan('- [ ] a: x', 'My Pipeline').name).toBe('My Pipeline');
  });

  it('extracts the plan name from the first "# " heading when no name arg is given', () => {
    const plan = parsePlan('# Great Plan\n- [ ] a: x');
    expect(plan.name).toBe('Great Plan');
  });

  it('an explicit name argument overrides a heading', () => {
    expect(parsePlan('# Heading Name\n- [ ] a: x', 'Explicit').name).toBe('Explicit');
  });

  it('falls back to "Unnamed Plan" when there is neither a name arg nor a heading', () => {
    expect(parsePlan('- [ ] a: x').name).toBe('Unnamed Plan');
  });

  it('always assigns a plan id', () => {
    expect(parsePlan('- [ ] a: x').id).toMatch(/^plan_/);
  });
});
