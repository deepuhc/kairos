/**
 * The Coordinator — Kairos's brain.
 *
 * Analyzes user intent and automatically decides:
 * 1. How many agents are needed
 * 2. What roles they should have
 * 3. Which orchestration pattern to use
 * 4. Whether human approval gates are needed
 *
 * Users never need to specify orchestration — they just describe what they want.
 */

import type { Phase, PatternType, Agent, Gate } from "./types.js";

/**
 * Signals extracted from the user's task description.
 */
export interface TaskAnalysis {
  /** What the user wants to accomplish */
  intent: string;
  /** Estimated complexity: simple (1 agent), moderate (2-3), complex (4+) */
  complexity: "simple" | "moderate" | "complex";
  /** Detected sub-tasks that could be parallelized */
  subtasks: string[];
  /** Whether tasks have dependencies (order matters) */
  hasDependencies: boolean;
  /** Whether the task requires iteration/refinement */
  requiresIteration: boolean;
  /** Whether different expertise is needed (routing) */
  requiresSpecialization: boolean;
  /** Whether a manager/decomposer is needed */
  requiresDecomposition: boolean;
  /** Whether human checkpoints are advisable */
  needsApproval: boolean;
  /** Risk level — higher risk = more gates */
  riskLevel: "low" | "medium" | "high";
  /** Selected pattern */
  pattern: PatternType;
  /** Generated agents */
  agents: Agent[];
  /** Generated phases */
  phases: Phase[];
}

/**
 * Keywords/signals that suggest specific patterns.
 */
const PARALLEL_SIGNALS = [
  "and", "also", "simultaneously", "at the same time", "both",
  "each", "all of", "compare", "versus", "vs", "multiple",
  "check for .* and .*", "review .* and .*",
];

const SEQUENTIAL_SIGNALS = [
  "then", "after that", "next", "first .* then", "followed by",
  "step by step", "once .* is done", "before", "pipeline",
  "chain", "workflow",
];

const ITERATION_SIGNALS = [
  "improve", "refine", "iterate", "until", "keep trying",
  "make it better", "optimize", "polish", "revise", "draft",
];

const SPECIALIZATION_SIGNALS = [
  "security", "performance", "style", "accessibility",
  "depending on", "if it's a", "route", "categorize",
  "the right expert", "specialist",
];

const DECOMPOSITION_SIGNALS = [
  "complex", "large", "break down", "decompose", "plan",
  "architecture", "design", "big picture", "comprehensive",
  "thorough", "full analysis",
];

const HIGH_RISK_SIGNALS = [
  "production", "deploy", "delete", "remove", "database",
  "migration", "payment", "billing", "patient", "tax",
  "legal", "compliance", "sensitive", "secret", "credential",
];

const MEDIUM_RISK_SIGNALS = [
  "refactor", "rewrite", "change", "modify", "update",
  "merge", "release", "publish", "api",
];

/**
 * The Coordinator class — analyzes tasks and produces execution plans.
 */
export class Coordinator {
  /**
   * Analyze a natural language task and produce a full orchestration plan.
   * This is the main entry point — user says what they want, Coordinator
   * figures out how to do it.
   */
  analyze(task: string): TaskAnalysis {
    const lower = task.toLowerCase();

    const subtasks = this.extractSubtasks(task);
    const hasDependencies = this.detectDependencies(lower);
    const requiresIteration = this.matchesSignals(lower, ITERATION_SIGNALS);
    const requiresSpecialization = this.matchesSignals(lower, SPECIALIZATION_SIGNALS);
    const requiresDecomposition = this.matchesSignals(lower, DECOMPOSITION_SIGNALS);
    const riskLevel = this.assessRisk(lower);
    const needsApproval = riskLevel === "high" || requiresDecomposition;

    const complexity = this.assessComplexity(
      subtasks, hasDependencies, requiresIteration,
      requiresSpecialization, requiresDecomposition
    );

    const pattern = this.selectPattern({
      subtasks,
      hasDependencies,
      requiresIteration,
      requiresSpecialization,
      requiresDecomposition,
      complexity,
    });

    const agents = this.generateAgents(task, pattern, subtasks, complexity);
    const phases = this.generatePhases(pattern, agents, needsApproval, riskLevel);

    return {
      intent: task,
      complexity,
      subtasks,
      hasDependencies,
      requiresIteration,
      requiresSpecialization,
      requiresDecomposition,
      needsApproval,
      riskLevel,
      pattern,
      agents,
      phases,
    };
  }

  /**
   * Select the best orchestration pattern based on task signals.
   */
  private selectPattern(signals: {
    subtasks: string[];
    hasDependencies: boolean;
    requiresIteration: boolean;
    requiresSpecialization: boolean;
    requiresDecomposition: boolean;
    complexity: "simple" | "moderate" | "complex";
  }): PatternType {
    // Simple task — single agent, sequential
    if (signals.complexity === "simple") {
      return "sequential";
    }

    // Multiple independent subtasks take priority — parallel
    if (signals.subtasks.length >= 2 && !signals.hasDependencies) {
      return "parallel";
    }

    // Needs iteration/refinement — loop
    if (signals.requiresIteration) {
      return "loop";
    }

    // Needs routing to specialist — handoff
    if (signals.requiresSpecialization && !signals.requiresDecomposition) {
      return "handoff";
    }

    // Complex with decomposition — hierarchical
    if (signals.requiresDecomposition) {
      return "hierarchical";
    }

    // Multiple dependent subtasks — sequential
    if (signals.hasDependencies) {
      return "sequential";
    }

    // Default: if multiple subtasks, parallel; otherwise sequential
    return signals.subtasks.length >= 2 ? "parallel" : "sequential";
  }

  /**
   * Generate appropriate agents for the task.
   */
  private generateAgents(
    task: string,
    pattern: PatternType,
    subtasks: string[],
    complexity: "simple" | "moderate" | "complex"
  ): Agent[] {
    if (complexity === "simple") {
      return [{ id: "worker", role: task }];
    }

    switch (pattern) {
      case "parallel":
        return subtasks.map((subtask, i) => ({
          id: `worker-${i + 1}`,
          role: subtask,
        }));

      case "sequential":
        return subtasks.map((subtask, i) => ({
          id: `phase-${i + 1}`,
          role: subtask,
        }));

      case "hierarchical":
        return [
          { id: "manager", role: `Decompose and coordinate: ${task}` },
          ...subtasks.map((subtask, i) => ({
            id: `worker-${i + 1}`,
            role: subtask,
          })),
        ];

      case "handoff":
        return [
          { id: "router", role: `Analyze and route: ${task}` },
          ...subtasks.map((subtask, i) => ({
            id: `specialist-${i + 1}`,
            role: subtask,
          })),
        ];

      case "loop":
        return [
          { id: "drafter", role: `Draft: ${task}` },
          { id: "reviewer", role: `Review and suggest improvements` },
        ];

      default:
        return [{ id: "worker", role: task }];
    }
  }

  /**
   * Generate execution phases with appropriate gates.
   */
  private generatePhases(
    pattern: PatternType,
    agents: Agent[],
    needsApproval: boolean,
    riskLevel: "low" | "medium" | "high"
  ): Phase[] {
    const gate: Gate | undefined = needsApproval
      ? {
          type: "human_approval",
          message: riskLevel === "high"
            ? "High-risk operation. Review the plan before proceeding?"
            : "Ready to proceed to next phase?",
        }
      : undefined;

    switch (pattern) {
      case "parallel":
        return [{
          phase: "execute",
          pattern: "parallel",
          agents: agents.map(a => a.id),
          gate,
        }];

      case "sequential":
        return agents.map((agent, i) => ({
          phase: `step-${i + 1}`,
          pattern: "sequential" as PatternType,
          agents: [agent.id],
          gate: i === 0 && gate ? gate : undefined,
        }));

      case "hierarchical":
        return [{
          phase: "orchestrate",
          pattern: "hierarchical",
          agents: agents.map(a => a.id),
          gate,
        }];

      case "handoff":
        return [{
          phase: "route",
          pattern: "handoff",
          agents: agents.map(a => a.id),
          gate,
        }];

      case "loop":
        return [{
          phase: "iterate",
          pattern: "loop",
          agents: agents.map(a => a.id),
          maxIterations: 3,
          gate,
        }];

      default:
        return [{
          phase: "execute",
          pattern,
          agents: agents.map(a => a.id),
        }];
    }
  }

  /**
   * Extract subtasks from natural language.
   * Splits on conjunctions, list markers, and semantic breaks.
   */
  private extractSubtasks(task: string): string[] {
    // Try splitting on common list patterns
    const listSplit = task.split(/(?:,\s*(?:and\s+)?|\s+and\s+|\s*;\s*|\n\s*[-•*]\s*|\n\s*\d+[\.)]\s*)/i);

    if (listSplit.length >= 2 && listSplit.every(s => s.trim().length > 5)) {
      return listSplit.map(s => s.trim()).filter(s => s.length > 0);
    }

    // Try splitting on "then" / "after" for sequential tasks
    const seqSplit = task.split(/\s*(?:,?\s*then\s+|,?\s*after that\s*,?\s*|,?\s*next\s+|,?\s*followed by\s+)/i);
    if (seqSplit.length >= 2) {
      return seqSplit.map(s => s.trim()).filter(s => s.length > 0);
    }

    // Try detecting "for X" patterns (check for security, for performance, for style)
    const forPattern = task.match(/(?:check|review|analyze|test)\s+(?:for\s+)?(\w+(?:\s+\w+)?)/gi);
    if (forPattern && forPattern.length >= 2) {
      return forPattern.map(s => s.trim());
    }

    // Single task
    return [task];
  }

  /**
   * Detect if subtasks have ordering dependencies.
   */
  private detectDependencies(lower: string): boolean {
    return this.matchesSignals(lower, SEQUENTIAL_SIGNALS);
  }

  /**
   * Check if text matches any signals in a list.
   */
  private matchesSignals(text: string, signals: string[]): boolean {
    return signals.some(signal => {
      if (signal.includes(".*")) {
        return new RegExp(signal, "i").test(text);
      }
      return text.includes(signal);
    });
  }

  /**
   * Assess overall task complexity.
   */
  private assessComplexity(
    subtasks: string[],
    hasDependencies: boolean,
    requiresIteration: boolean,
    requiresSpecialization: boolean,
    requiresDecomposition: boolean
  ): "simple" | "moderate" | "complex" {
    const signals = [
      subtasks.length >= 3,
      hasDependencies,
      requiresIteration,
      requiresSpecialization,
      requiresDecomposition,
    ].filter(Boolean).length;

    if (signals >= 3 || requiresDecomposition) return "complex";
    if (signals >= 1 || subtasks.length >= 2) return "moderate";
    return "simple";
  }

  /**
   * Assess risk level of the task.
   */
  private assessRisk(lower: string): "low" | "medium" | "high" {
    if (this.matchesSignals(lower, HIGH_RISK_SIGNALS)) return "high";
    if (this.matchesSignals(lower, MEDIUM_RISK_SIGNALS)) return "medium";
    return "low";
  }
}
