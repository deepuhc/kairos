/**
 * Validation gates between pipeline phases.
 * Gates are checkpoints that determine whether to proceed.
 */

import type { Gate } from "./types.js";
import type { PipelineState } from "./state.js";

export interface GateResult {
  passed: boolean;
  reason?: string;
}

/**
 * Validate a gate condition against current pipeline state.
 */
export async function validateGate(
  gate: Gate,
  state: PipelineState,
  options?: {
    budgetLimit?: number;
    customCheck?: (check: string) => Promise<boolean>;
    requestApproval?: (message: string) => Promise<boolean>;
  }
): Promise<GateResult> {
  switch (gate.type) {
    case "budget":
      return checkBudget(state, options?.budgetLimit);

    case "programmatic":
      if (gate.check && options?.customCheck) {
        const passed = await options.customCheck(gate.check);
        return { passed, reason: passed ? undefined : `Check failed: ${gate.check}` };
      }
      return { passed: true };

    case "quality":
      // Quality gates check that all tasks in the current phase succeeded
      return checkQuality(state, gate.check);

    case "human_approval":
      if (options?.requestApproval) {
        const message = gate.message ?? "Approval required to continue.";
        const passed = await options.requestApproval(message);
        return { passed, reason: passed ? undefined : "User denied approval" };
      }
      // No approval handler — auto-pass (for testing/CI)
      return { passed: true };

    default:
      return { passed: true };
  }
}

function checkBudget(
  state: PipelineState,
  limit?: number
): GateResult {
  if (!limit) return { passed: true };

  if (state.totalCostUsd >= limit) {
    return {
      passed: false,
      reason: `Budget exceeded: $${state.totalCostUsd.toFixed(2)} / $${limit.toFixed(2)}`,
    };
  }
  return { passed: true };
}

function checkQuality(
  state: PipelineState,
  check?: string
): GateResult {
  // Check that all tasks in the most recent phase completed successfully
  const currentPhaseTasks = state.tasks.filter(
    (t) => t.phase === state.events[state.events.length - 1]?.phase
  );

  const allCompleted = currentPhaseTasks.every(
    (t) => t.status === "completed"
  );

  if (!allCompleted) {
    const failed = currentPhaseTasks.filter((t) => t.status === "failed");
    return {
      passed: false,
      reason: `${failed.length} task(s) failed in phase. ${check ?? ""}`.trim(),
    };
  }

  return { passed: true };
}
