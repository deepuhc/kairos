/**
 * YAML recipe parser with validation.
 */

import type { Recipe, Phase, Agent, Gate, PatternType } from "./types.js";

/**
 * Parse a plain object (from YAML.parse) into a validated Recipe.
 * Throws on invalid structure.
 */
export function parseRecipe(raw: unknown): Recipe {
  if (!raw || typeof raw !== "object") {
    throw new Error("Recipe must be an object");
  }

  const obj = raw as Record<string, unknown>;

  // Required fields
  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error("Recipe must have a 'name' field");
  }
  if (typeof obj.description !== "string") {
    throw new Error("Recipe must have a 'description' field");
  }
  if (typeof obj.version !== "number") {
    throw new Error("Recipe must have a numeric 'version' field");
  }
  if (!obj.providers || typeof obj.providers !== "object") {
    throw new Error("Recipe must have a 'providers' config");
  }
  if (!Array.isArray(obj.agents) || obj.agents.length === 0) {
    throw new Error("Recipe must have at least one agent");
  }
  if (!Array.isArray(obj.pipeline) || obj.pipeline.length === 0) {
    throw new Error("Recipe must have at least one pipeline phase");
  }

  const providers = obj.providers as Record<string, string>;
  if (!providers.default) {
    throw new Error("Providers must include a 'default' model");
  }

  const agents = (obj.agents as unknown[]).map(parseAgent);
  const pipeline = (obj.pipeline as unknown[]).map(parsePhase);

  // Validate all agent references in pipeline exist
  const agentIds = new Set(agents.map((a) => a.id));
  for (const phase of pipeline) {
    for (const agentRef of phase.agents) {
      if (!agentIds.has(agentRef)) {
        throw new Error(
          `Phase '${phase.phase}' references unknown agent '${agentRef}'`
        );
      }
    }
  }

  const recipe: Recipe = {
    name: obj.name,
    description: obj.description,
    version: obj.version,
    providers,
    agents,
    pipeline,
  };

  if (obj.domain) recipe.domain = obj.domain as string;
  if (obj.audience) recipe.audience = obj.audience as Recipe["audience"];

  if (obj.budget && typeof obj.budget === "object") {
    const b = obj.budget as Record<string, unknown>;
    recipe.budget = {
      maxCost: parseCost(b.max_cost ?? b.maxCost),
      fallbackOnBudget: b.fallback_on_budget as string | undefined,
      warnAtPercent: b.warn_at_percent as number | undefined,
    };
  }

  if (obj.security && typeof obj.security === "object") {
    recipe.security = obj.security as Recipe["security"];
  }

  return recipe;
}

function parseAgent(raw: unknown): Agent {
  if (!raw || typeof raw !== "object") {
    throw new Error("Agent must be an object");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== "string") throw new Error("Agent must have an 'id'");
  if (typeof obj.role !== "string") throw new Error("Agent must have a 'role'");

  return {
    id: obj.id,
    role: obj.role,
    model: obj.model as string | undefined,
    tools: obj.tools as string[] | undefined,
    permissions: obj.permissions as Agent["permissions"],
  };
}

function parsePhase(raw: unknown): Phase {
  if (!raw || typeof raw !== "object") {
    throw new Error("Phase must be an object");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.phase !== "string") {
    throw new Error("Phase must have a 'phase' name");
  }
  if (typeof obj.pattern !== "string") {
    throw new Error("Phase must have a 'pattern'");
  }

  const validPatterns: PatternType[] = [
    "sequential",
    "parallel",
    "hierarchical",
    "handoff",
    "loop",
  ];
  if (!validPatterns.includes(obj.pattern as PatternType)) {
    throw new Error(
      `Invalid pattern '${obj.pattern}'. Must be one of: ${validPatterns.join(", ")}`
    );
  }

  if (!Array.isArray(obj.agents) || obj.agents.length === 0) {
    throw new Error(`Phase '${obj.phase}' must have at least one agent`);
  }

  const phase: Phase = {
    phase: obj.phase,
    pattern: obj.pattern as PatternType,
    agents: obj.agents as string[],
  };

  if (obj.input) phase.input = obj.input as string;
  if (obj.output) phase.output = obj.output as string;
  if (obj.timeout) phase.timeout = obj.timeout as string;
  if (obj.condition) phase.condition = obj.condition as string;
  if (obj.max_iterations || obj.maxIterations) {
    phase.maxIterations = (obj.max_iterations ?? obj.maxIterations) as number;
  }

  if (obj.gate && typeof obj.gate === "object") {
    const g = obj.gate as Record<string, unknown>;
    phase.gate = {
      type: g.type as Gate["type"],
      check: g.check as string | undefined,
      message: g.message as string | undefined,
    };
  }

  return phase;
}

function parseCost(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // Handle "$2.00" format
    return parseFloat(value.replace(/[$,]/g, ""));
  }
  return 0;
}
