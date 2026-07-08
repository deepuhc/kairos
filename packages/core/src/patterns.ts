/**
 * Orchestration pattern implementations.
 * Each pattern defines how agents coordinate within a phase.
 */

import type { Phase, PatternType } from "./types.js";
import type { TaskState } from "./state.js";

export interface PatternContext {
  /** Execute a single agent task */
  executeAgent: (agentId: string, input: unknown) => Promise<TaskState>;
  /** Get output from a previous phase */
  getPhaseOutput: (phaseName: string) => unknown;
  /** Current budget remaining (USD) */
  budgetRemaining?: number;
}

/**
 * Execute a phase using its declared pattern.
 */
export async function executePattern(
  phase: Phase,
  context: PatternContext
): Promise<TaskState[]> {
  switch (phase.pattern) {
    case "sequential":
      return executeSequential(phase, context);
    case "parallel":
      return executeParallel(phase, context);
    case "hierarchical":
      return executeHierarchical(phase, context);
    case "handoff":
      return executeHandoff(phase, context);
    case "loop":
      return executeLoop(phase, context);
    default:
      throw new Error(`Unknown pattern: ${phase.pattern}`);
  }
}

/**
 * Sequential: A → B → C
 * Each agent runs after the previous completes.
 */
async function executeSequential(
  phase: Phase,
  context: PatternContext
): Promise<TaskState[]> {
  const results: TaskState[] = [];
  let currentInput = phase.input
    ? context.getPhaseOutput(phase.input)
    : undefined;

  for (const agentId of phase.agents) {
    const result = await context.executeAgent(agentId, currentInput);
    results.push(result);

    if (result.status === "failed") break;
    currentInput = result.output;
  }

  return results;
}

/**
 * Parallel: Fan-out to all agents simultaneously, collect results.
 */
async function executeParallel(
  phase: Phase,
  context: PatternContext
): Promise<TaskState[]> {
  const input = phase.input
    ? context.getPhaseOutput(phase.input)
    : undefined;

  const promises = phase.agents.map((agentId) =>
    context.executeAgent(agentId, input)
  );

  return Promise.all(promises);
}

/**
 * Hierarchical: First agent is the manager, rest are workers.
 * Manager decomposes the task, delegates to workers, synthesizes.
 */
async function executeHierarchical(
  phase: Phase,
  context: PatternContext
): Promise<TaskState[]> {
  if (phase.agents.length < 2) {
    throw new Error("Hierarchical pattern requires at least 2 agents (1 manager + workers)");
  }

  const [managerId, ...workerIds] = phase.agents;
  const input = phase.input
    ? context.getPhaseOutput(phase.input)
    : undefined;

  // Manager plans the work
  const managerResult = await context.executeAgent(managerId, {
    type: "plan",
    input,
    availableWorkers: workerIds,
  });

  if (managerResult.status === "failed") return [managerResult];

  // Workers execute in parallel
  const workerPromises = workerIds.map((workerId) =>
    context.executeAgent(workerId, managerResult.output)
  );
  const workerResults = await Promise.all(workerPromises);

  // Manager synthesizes
  const synthesisResult = await context.executeAgent(managerId, {
    type: "synthesize",
    workerOutputs: workerResults.map((r) => r.output),
  });

  return [managerResult, ...workerResults, synthesisResult];
}

/**
 * Handoff: First agent triages, routes to appropriate specialist.
 */
async function executeHandoff(
  phase: Phase,
  context: PatternContext
): Promise<TaskState[]> {
  if (phase.agents.length < 2) {
    throw new Error("Handoff pattern requires at least 2 agents (1 router + specialists)");
  }

  const [routerId, ...specialistIds] = phase.agents;
  const input = phase.input
    ? context.getPhaseOutput(phase.input)
    : undefined;

  // Router decides which specialist to use
  const routerResult = await context.executeAgent(routerId, {
    type: "route",
    input,
    availableSpecialists: specialistIds,
  });

  if (routerResult.status === "failed") return [routerResult];

  // Route to the selected specialist
  const selectedId =
    typeof routerResult.output === "string"
      ? routerResult.output
      : specialistIds[0];

  const specialistResult = await context.executeAgent(selectedId, input);
  return [routerResult, specialistResult];
}

/**
 * Loop: Execute until condition is met or max iterations reached.
 */
async function executeLoop(
  phase: Phase,
  context: PatternContext
): Promise<TaskState[]> {
  const maxIterations = phase.maxIterations ?? 3;
  const results: TaskState[] = [];
  let currentInput = phase.input
    ? context.getPhaseOutput(phase.input)
    : undefined;

  for (let i = 0; i < maxIterations; i++) {
    for (const agentId of phase.agents) {
      const result = await context.executeAgent(agentId, {
        iteration: i + 1,
        maxIterations,
        input: currentInput,
        previousResults: results.map((r) => r.output),
      });

      results.push(result);

      if (result.status === "failed") return results;
      currentInput = result.output;
    }

    // Check if loop should terminate (simplified — in production this
    // would evaluate the condition expression against the output)
    const lastOutput = results[results.length - 1]?.output;
    if (
      lastOutput &&
      typeof lastOutput === "object" &&
      "done" in (lastOutput as Record<string, unknown>) &&
      (lastOutput as Record<string, unknown>).done === true
    ) {
      break;
    }
  }

  return results;
}
