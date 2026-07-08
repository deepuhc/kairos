/**
 * Core types for Kairos orchestration.
 * These define the recipe format and pipeline structure.
 */

export interface Recipe {
  name: string;
  description: string;
  domain?: string;
  version: number;
  audience?: "developer" | "non-technical" | "any";
  providers: ProviderConfig;
  budget?: BudgetConfig;
  security?: SecurityConfig;
  agents: Agent[];
  pipeline: Phase[];
}

export interface ProviderConfig {
  default: string;
  [key: string]: string;
}

export interface BudgetConfig {
  /** Maximum cost in USD (e.g., 2.00) */
  maxCost: number;
  /** Provider to fall back to when budget is nearly exhausted */
  fallbackOnBudget?: string;
  /** Warn when this percentage of budget is used */
  warnAtPercent?: number;
}

export interface SecurityConfig {
  dataClassification?: "restricted" | "confidential" | "internal" | "public";
  cloudAllowed?: boolean;
  profile?: string;
}

export interface Agent {
  id: string;
  role: string;
  model?: string;
  tools?: string[];
  permissions?: AgentPermissions;
}

export interface AgentPermissions {
  fileAccess?: "none" | "read-only" | "write";
  paths?: string[];
  network?: string[];
  maxRuntimeMs?: number;
}

export interface Phase {
  id?: string;
  phase: string;
  pattern: PatternType;
  agents: string[];
  input?: string;
  output?: string;
  gate?: Gate;
  timeout?: string;
  /** For loop pattern */
  condition?: string;
  maxIterations?: number;
}

export type PatternType =
  | "sequential"
  | "parallel"
  | "hierarchical"
  | "handoff"
  | "loop";

export interface Gate {
  type: "quality" | "human_approval" | "programmatic" | "budget";
  check?: string;
  message?: string;
}

export interface Pipeline {
  recipe: Recipe;
  phases: Phase[];
}
