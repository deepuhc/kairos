import type { PhaseDefinition, PipelineDefinition, PhaseState } from './types.js';

export function validateDAG(definition: PipelineDefinition): { valid: boolean; error?: string } {
  const ids = new Set(definition.phases.map((p) => p.id));

  for (const phase of definition.phases) {
    for (const dep of phase.dependsOn) {
      if (!ids.has(dep)) {
        return { valid: false, error: `Phase "${phase.id}" depends on unknown phase "${dep}"` };
      }
    }
  }

  const cycle = detectCycle(definition.phases);
  if (cycle) {
    return { valid: false, error: `Cycle detected: ${cycle.join(' → ')}` };
  }

  return { valid: true };
}

export function detectCycle(phases: PhaseDefinition[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const p of phases) {
    graph.set(p.id, p.dependsOn);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      return [...path.slice(cycleStart), node];
    }
    if (visited.has(node)) return null;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of graph.get(node) || []) {
      const result = dfs(dep);
      if (result) return result;
    }

    path.pop();
    inStack.delete(node);
    return null;
  }

  for (const p of phases) {
    const cycle = dfs(p.id);
    if (cycle) return cycle;
  }
  return null;
}

export function computeReadySet(phases: PhaseDefinition[], states: Map<string, PhaseState>): PhaseDefinition[] {
  return phases.filter((phase) => {
    const state = states.get(phase.id);
    if (!state || state.status !== 'pending') return false;
    return phase.dependsOn.every((dep) => {
      const depState = states.get(dep);
      return depState?.status === 'completed';
    });
  });
}

export function topologicalSort(phases: PhaseDefinition[]): PhaseDefinition[] {
  const sorted: PhaseDefinition[] = [];
  const visited = new Set<string>();
  const phaseMap = new Map(phases.map((p) => [p.id, p]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const phase = phaseMap.get(id);
    if (!phase) return;
    for (const dep of phase.dependsOn) {
      visit(dep);
    }
    sorted.push(phase);
  }

  for (const p of phases) visit(p.id);
  return sorted;
}
