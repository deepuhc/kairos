import { describe, it, expect } from 'vitest';
import { validateDAG, detectCycle, computeReadySet, topologicalSort } from '../dag.js';
import type { PhaseDefinition, PipelineDefinition, PhaseState } from '../types.js';

// Minimal phase factory — only the fields the DAG functions read (id, type,
// dependsOn) matter here.
function phase(id: string, dependsOn: string[] = []): PhaseDefinition {
  return { id, type: 'agent', dependsOn };
}

function pipeline(phases: PhaseDefinition[]): PipelineDefinition {
  return { id: 'p', name: 'test', phases };
}

function stateMap(entries: Array<[string, PhaseState['status']]>): Map<string, PhaseState> {
  return new Map(entries.map(([id, status]) => [id, { id, status }]));
}

describe('validateDAG', () => {
  it('accepts a valid linear pipeline', () => {
    const result = validateDAG(pipeline([phase('a'), phase('b', ['a']), phase('c', ['b'])]));
    expect(result).toEqual({ valid: true });
  });

  it('accepts a diamond dependency (multiple deps, no cycle)', () => {
    const result = validateDAG(
      pipeline([phase('a'), phase('b', ['a']), phase('c', ['a']), phase('d', ['b', 'c'])]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a dependency on an unknown phase', () => {
    const result = validateDAG(pipeline([phase('a'), phase('b', ['ghost'])]));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/depends on unknown phase "ghost"/);
  });

  it('rejects a cycle and names the phases in it', () => {
    const result = validateDAG(pipeline([phase('a', ['b']), phase('b', ['a'])]));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Cycle detected/);
  });

  it('rejects a self-dependency as a cycle', () => {
    const result = validateDAG(pipeline([phase('a', ['a'])]));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Cycle detected/);
  });

  it('accepts an empty pipeline', () => {
    expect(validateDAG(pipeline([]))).toEqual({ valid: true });
  });
});

describe('detectCycle', () => {
  it('returns null when there is no cycle', () => {
    expect(detectCycle([phase('a'), phase('b', ['a'])])).toBeNull();
  });

  it('returns the cycle path (start repeated at the end) for a direct cycle', () => {
    const cycle = detectCycle([phase('a', ['b']), phase('b', ['a'])]);
    expect(cycle).not.toBeNull();
    // Path closes on itself: first and last element are the same node.
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['a', 'b']));
  });

  it('detects a longer transitive cycle a→b→c→a', () => {
    const cycle = detectCycle([phase('a', ['c']), phase('b', ['a']), phase('c', ['b'])]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('detects a self-loop', () => {
    const cycle = detectCycle([phase('a', ['a'])]);
    expect(cycle).toEqual(['a', 'a']);
  });
});

describe('computeReadySet', () => {
  it('returns pending phases whose deps are all completed', () => {
    const phases = [phase('a'), phase('b', ['a']), phase('c', ['a'])];
    const states = stateMap([['a', 'completed'], ['b', 'pending'], ['c', 'pending']]);
    const ready = computeReadySet(phases, states).map((p) => p.id);
    expect(ready.sort()).toEqual(['b', 'c']);
  });

  it('excludes a phase with an incomplete dependency', () => {
    const phases = [phase('a'), phase('b', ['a'])];
    const states = stateMap([['a', 'running'], ['b', 'pending']]);
    expect(computeReadySet(phases, states)).toEqual([]);
  });

  it('excludes phases that are not pending (already running/completed)', () => {
    const phases = [phase('a'), phase('b', ['a'])];
    const states = stateMap([['a', 'completed'], ['b', 'running']]);
    expect(computeReadySet(phases, states)).toEqual([]);
  });

  it('treats a phase with no state entry as not ready', () => {
    const phases = [phase('a')];
    const ready = computeReadySet(phases, new Map());
    expect(ready).toEqual([]);
  });

  it('a dependency-free pending phase is immediately ready', () => {
    const phases = [phase('a')];
    const states = stateMap([['a', 'pending']]);
    expect(computeReadySet(phases, states).map((p) => p.id)).toEqual(['a']);
  });

  it('does not treat a failed dependency as satisfied', () => {
    const phases = [phase('a'), phase('b', ['a'])];
    const states = stateMap([['a', 'failed'], ['b', 'pending']]);
    expect(computeReadySet(phases, states)).toEqual([]);
  });
});

describe('topologicalSort', () => {
  it('orders dependencies before dependents', () => {
    const sorted = topologicalSort([phase('c', ['b']), phase('b', ['a']), phase('a')]).map((p) => p.id);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });

  it('places every dependency before the phase that needs it (diamond)', () => {
    const sorted = topologicalSort([
      phase('d', ['b', 'c']), phase('b', ['a']), phase('c', ['a']), phase('a'),
    ]).map((p) => p.id);
    const idx = (id: string) => sorted.indexOf(id);
    expect(idx('a')).toBeLessThan(idx('b'));
    expect(idx('a')).toBeLessThan(idx('c'));
    expect(idx('b')).toBeLessThan(idx('d'));
    expect(idx('c')).toBeLessThan(idx('d'));
    expect(sorted).toHaveLength(4);
  });

  it('returns all phases with no duplicates', () => {
    const sorted = topologicalSort([phase('a'), phase('b', ['a']), phase('c', ['a'])]);
    expect(new Set(sorted.map((p) => p.id))).toEqual(new Set(['a', 'b', 'c']));
    expect(sorted).toHaveLength(3);
  });

  it('handles independent phases (no dependencies)', () => {
    const sorted = topologicalSort([phase('a'), phase('b'), phase('c')]).map((p) => p.id);
    expect(sorted.sort()).toEqual(['a', 'b', 'c']);
  });
});
