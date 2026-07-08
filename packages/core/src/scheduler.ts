/**
 * DAG-based pipeline scheduler.
 * Resolves dependencies, dispatches phases in order,
 * and manages parallel execution.
 */

import type { Recipe, Phase } from "./types.js";
import {
  type PipelineState,
  type TaskState,
  createPipelineState,
  recordEvent,
} from "./state.js";

export interface SchedulerOptions {
  /** Called when a phase is ready to execute */
  onPhaseReady: (phase: Phase, state: PipelineState) => Promise<TaskState[]>;
  /** Called when a gate needs checking */
  onGateCheck: (phase: Phase, state: PipelineState) => Promise<boolean>;
  /** Called on state changes (for persistence/UI) */
  onStateChange?: (state: PipelineState) => void;
  /** Called when approval is needed */
  onApprovalNeeded?: (phase: Phase, state: PipelineState) => Promise<boolean>;
}

export class Scheduler {
  private options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  /**
   * Execute a recipe from start to finish.
   * Handles sequential phase execution, gates, and budget tracking.
   */
  async execute(recipe: Recipe): Promise<PipelineState> {
    const pipelineId = crypto.randomUUID();
    let state = createPipelineState(pipelineId, recipe.name);
    state = recordEvent(state, "pipeline_started", { recipe: recipe.name });
    this.notify(state);

    for (let i = 0; i < recipe.pipeline.length; i++) {
      const phase = recipe.pipeline[i];
      state = { ...state, currentPhase: i };

      // Check budget before starting phase
      if (recipe.budget && state.totalCostUsd >= recipe.budget.maxCost) {
        state = recordEvent(state, "budget_exceeded");
        state = { ...state, status: "failed" };
        this.notify(state);
        break;
      }

      // Budget warning
      if (recipe.budget?.warnAtPercent) {
        const usedPercent =
          (state.totalCostUsd / recipe.budget.maxCost) * 100;
        if (usedPercent >= recipe.budget.warnAtPercent) {
          state = recordEvent(state, "budget_warning", {
            usedPercent,
            remaining: recipe.budget.maxCost - state.totalCostUsd,
          });
        }
      }

      // Execute the phase
      state = recordEvent(state, "phase_started", { phase: phase.phase });
      this.notify(state);

      try {
        const taskResults = await this.options.onPhaseReady(phase, state);
        state = {
          ...state,
          tasks: [...state.tasks, ...taskResults],
          totalCostUsd:
            state.totalCostUsd +
            taskResults.reduce((sum, t) => sum + t.costUsd, 0),
          totalTokens:
            state.totalTokens +
            taskResults.reduce((sum, t) => sum + t.tokensUsed, 0),
        };

        // Check if any task failed
        const failed = taskResults.find((t) => t.status === "failed");
        if (failed) {
          state = recordEvent(state, "phase_failed", {
            phase: phase.phase,
            error: failed.error,
          });
          state = { ...state, status: "failed" };
          this.notify(state);
          break;
        }

        state = recordEvent(state, "phase_completed", { phase: phase.phase });
      } catch (error) {
        state = recordEvent(state, "phase_failed", {
          phase: phase.phase,
          error: error instanceof Error ? error.message : String(error),
        });
        state = { ...state, status: "failed" };
        this.notify(state);
        break;
      }

      // Check gate if present
      if (phase.gate) {
        state = recordEvent(state, "gate_check", {
          gate: phase.gate.type,
          phase: phase.phase,
        });

        let passed: boolean;

        if (phase.gate.type === "human_approval") {
          if (this.options.onApprovalNeeded) {
            state = recordEvent(state, "approval_requested", {
              message: phase.gate.message,
            });
            this.notify(state);
            passed = await this.options.onApprovalNeeded(phase, state);
            state = recordEvent(
              state,
              passed ? "approval_granted" : "approval_denied"
            );
          } else {
            passed = true; // No approval handler = auto-approve
          }
        } else {
          passed = await this.options.onGateCheck(phase, state);
        }

        if (!passed) {
          state = recordEvent(state, "gate_failed", { phase: phase.phase });
          state = { ...state, status: "failed" };
          this.notify(state);
          break;
        }

        state = recordEvent(state, "gate_passed", { phase: phase.phase });
      }

      this.notify(state);
    }

    // If we got through all phases without failing
    if (state.status !== "failed") {
      state = {
        ...state,
        status: "completed",
        completedAt: new Date().toISOString(),
      };
      state = recordEvent(state, "pipeline_completed");
    }

    this.notify(state);
    return state;
  }

  private notify(state: PipelineState): void {
    this.options.onStateChange?.(state);
  }
}
