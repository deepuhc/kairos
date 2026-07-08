/**
 * Pipeline Executor — Bridge between scheduler and LLM execution.
 * This connects the scheduler's phases to actual provider calls,
 * enforces security policies, tracks costs, and emits events.
 */

import { EventEmitter } from "node:events";
import type { Recipe, Agent } from "./types.js";
import type { PipelineState, TaskState } from "./state.js";
import { Scheduler, type SchedulerOptions } from "./scheduler.js";
import { executePattern, type PatternContext } from "./patterns.js";
import { validateGate } from "./gates.js";
import type { SmartRouter } from "@kairos/providers";
import type { ProviderMessage } from "@kairos/providers";
import { classify, redact, rehydrate, AuditLog, type DataClass } from "@kairos/security";
import type { RedactionMap } from "@kairos/security";

export interface ExecutorConfig {
  /** LLM router that selects models and providers */
  router: SmartRouter;
  /** Optional audit log for compliance */
  auditLog?: AuditLog;
  /** Session ID for audit trail */
  sessionId?: string;
  /** User identifier for audit trail */
  user?: string;
  /** Human approval handler for approval gates */
  onApprovalNeeded?: (message: string, state: PipelineState) => Promise<boolean>;
}

export interface ExecutorEvents {
  stateChange: (state: PipelineState) => void;
  taskStarted: (task: TaskState) => void;
  taskCompleted: (task: TaskState) => void;
  budgetWarning: (remaining: number) => void;
  budgetExceeded: (spent: number) => void;
}

/**
 * PipelineExecutor orchestrates recipe execution end-to-end.
 * It bridges the scheduler to real LLM calls via the router.
 */
export class PipelineExecutor extends EventEmitter {
  private config: ExecutorConfig;
  private sessionId: string;
  private agentMap = new Map<string, Agent>();
  private phaseOutputs = new Map<string, unknown>();
  private redactionMaps = new Map<string, RedactionMap>();

  constructor(config: ExecutorConfig) {
    super();
    this.config = config;
    this.sessionId = config.sessionId ?? crypto.randomUUID();
  }

  /**
   * Execute a recipe from start to finish.
   */
  async execute(recipe: Recipe): Promise<PipelineState> {
    // Initialize router (checks provider availability)
    await this.config.router.initialize();

    // Build agent lookup map
    this.agentMap.clear();
    for (const agent of recipe.agents) {
      this.agentMap.set(agent.id, agent);
    }

    // Build scheduler with our handlers
    const scheduler = new Scheduler({
      onPhaseReady: this.handlePhaseReady.bind(this, recipe),
      onGateCheck: this.handleGateCheck.bind(this, recipe),
      onStateChange: (state) => this.emit("stateChange", state),
      onApprovalNeeded: this.handleApproval.bind(this),
    });

    // Execute the recipe
    const result = await scheduler.execute(recipe);

    return result;
  }

  /**
   * Handle phase execution — this is where we invoke the pattern
   * with a real LLM-calling context.
   */
  private async handlePhaseReady(
    recipe: Recipe,
    phase: { phase: string; pattern: string; agents: string[]; input?: string },
    state: PipelineState
  ): Promise<TaskState[]> {
    // Create pattern context with real LLM execution
    const context: PatternContext = {
      executeAgent: this.executeAgent.bind(this, recipe, phase.phase, state),
      getPhaseOutput: (phaseName: string) => this.phaseOutputs.get(phaseName),
      budgetRemaining: this.config.router.budgetRemaining,
    };

    // Execute the pattern
    const results = await executePattern(
      phase as any, // Phase interface matches
      context
    );

    // Store phase output (last task's output)
    if (results.length > 0) {
      const lastResult = results[results.length - 1];
      if (lastResult.output !== undefined) {
        this.phaseOutputs.set(phase.phase, lastResult.output);
      }
    }

    return results;
  }

  /**
   * Execute a single agent task — this is where we call the LLM.
   */
  private async executeAgent(
    recipe: Recipe,
    phaseName: string,
    state: PipelineState,
    agentId: string,
    input: unknown
  ): Promise<TaskState> {
    const agent = this.agentMap.get(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' not found in recipe`);
    }

    const taskId = crypto.randomUUID();
    const startTime = Date.now();

    // Create initial task state
    const task: TaskState = {
      id: taskId,
      agentId,
      phase: phaseName,
      status: "running",
      startedAt: new Date().toISOString(),
      costUsd: 0,
      tokensUsed: 0,
    };

    this.emit("taskStarted", task);

    try {
      // Check budget before proceeding
      if (recipe.budget && state.totalCostUsd >= recipe.budget.maxCost) {
        this.emit("budgetExceeded", state.totalCostUsd);
        throw new Error("Budget exceeded before task execution");
      }

      // Classify input for security
      const inputText = JSON.stringify(input ?? "");
      const classification = classify(inputText);
      const dataClass = classification.class;

      // Redact PII if needed
      let finalInput = inputText;
      let redactionMap: RedactionMap | undefined;

      if (classification.matches.length > 0) {
        const redacted = redact(inputText);
        finalInput = redacted.redactedText;
        redactionMap = redacted;
        this.redactionMaps.set(taskId, redacted);
      }

      // Build messages for the LLM
      const messages: ProviderMessage[] = [
        {
          role: "system",
          content: `You are ${agent.role}. Respond concisely with the requested information.`,
        },
        {
          role: "user",
          content: finalInput,
        },
      ];

      // Determine task complexity (simplified heuristic)
      const complexity = this.estimateComplexity(agent, input);

      // Route and execute
      const response = await this.config.router.route(messages, {
        model: agent.model ?? recipe.providers.default,
        complexity,
        maxTokens: 2048,
        temperature: 0.7,
      });

      // Rehydrate response if we redacted
      let finalOutput = response.content;
      if (redactionMap) {
        finalOutput = rehydrate(finalOutput, redactionMap);
      }

      // Update task state
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      task.output = finalOutput;
      task.costUsd = response.costUsd;
      task.tokensUsed = response.tokensUsed.total;

      // Emit completion
      this.emit("taskCompleted", task);

      // Record audit entry
      if (this.config.auditLog) {
        await this.config.auditLog.record(
          this.config.auditLog.entry(
            {
              user: this.config.user,
              agent: agentId,
              action: "task_executed",
              details: {
                phase: phaseName,
                taskId,
                complexity,
                hadRedaction: !!redactionMap,
              },
              dataClassification: dataClass,
              modelUsed: response.model,
              dataSentToCloud: !this.config.router.decide({ complexity }).provider.isLocal,
              durationMs: response.durationMs,
              costUsd: response.costUsd,
            },
            this.sessionId
          )
        );
      }

      return task;
    } catch (error) {
      // Task failed
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      task.error = error instanceof Error ? error.message : String(error);

      // Record failure in audit
      if (this.config.auditLog) {
        await this.config.auditLog.record(
          this.config.auditLog.entry(
            {
              user: this.config.user,
              agent: agentId,
              action: "task_failed",
              details: {
                phase: phaseName,
                taskId,
                error: task.error,
              },
              dataClassification: "internal",
              modelUsed: "none",
              dataSentToCloud: false,
            },
            this.sessionId
          )
        );
      }

      return task;
    }
  }

  /**
   * Handle gate checking.
   */
  private async handleGateCheck(
    recipe: Recipe,
    phase: { phase: string; gate?: any },
    state: PipelineState
  ): Promise<boolean> {
    if (!phase.gate) return true;

    const result = await validateGate(phase.gate, state, {
      budgetLimit: recipe.budget?.maxCost,
    });

    return result.passed;
  }

  /**
   * Handle human approval requests.
   */
  private async handleApproval(
    phase: { phase: string; gate?: any },
    state: PipelineState
  ): Promise<boolean> {
    if (!this.config.onApprovalNeeded) {
      return true; // Auto-approve if no handler
    }

    const message = phase.gate?.message ?? "Approval required to continue.";
    return this.config.onApprovalNeeded(message, state);
  }

  /**
   * Estimate task complexity based on agent role and input size.
   * In production, this could use heuristics or a dedicated classifier.
   */
  private estimateComplexity(
    agent: Agent,
    input: unknown
  ): "low" | "medium" | "high" {
    const inputSize = JSON.stringify(input ?? "").length;

    // Simple heuristic: longer inputs = more complex
    if (inputSize > 4000) return "high";
    if (inputSize > 1000) return "medium";

    // Role-based hints
    const role = agent.role.toLowerCase();
    if (role.includes("architect") || role.includes("complex")) return "high";
    if (role.includes("simple") || role.includes("quick")) return "low";

    return "medium";
  }
}
