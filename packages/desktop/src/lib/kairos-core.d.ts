declare module "@kairos/core/coordinator" {
  export type PatternType = "sequential" | "parallel" | "hierarchical" | "handoff" | "loop";

  export interface Agent {
    id: string;
    role: string;
    model?: string;
    tools?: string[];
  }

  export interface Gate {
    type: "quality" | "human_approval" | "programmatic" | "budget";
    check?: string;
    message?: string;
  }

  export interface Phase {
    phase: string;
    pattern: PatternType;
    agents: string[];
    gate?: Gate;
    maxIterations?: number;
  }

  export interface TaskAnalysis {
    intent: string;
    complexity: "simple" | "moderate" | "complex";
    subtasks: string[];
    hasDependencies: boolean;
    requiresIteration: boolean;
    requiresSpecialization: boolean;
    requiresDecomposition: boolean;
    needsApproval: boolean;
    riskLevel: "low" | "medium" | "high";
    pattern: PatternType;
    agents: Agent[];
    phases: Phase[];
  }

  export class Coordinator {
    analyze(task: string): TaskAnalysis;
  }
}
