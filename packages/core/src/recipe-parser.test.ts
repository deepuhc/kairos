import { describe, it, expect } from "vitest";
import { parseRecipe } from "./recipe-parser.js";

describe("Recipe Parser", () => {
  const validRecipe = {
    name: "Test Recipe",
    description: "A test recipe",
    version: 1,
    providers: { default: "ollama/llama3.2" },
    agents: [
      { id: "agent-a", role: "First agent" },
      { id: "agent-b", role: "Second agent" },
    ],
    pipeline: [
      { phase: "step-1", pattern: "sequential", agents: ["agent-a"] },
      { phase: "step-2", pattern: "parallel", agents: ["agent-a", "agent-b"] },
    ],
  };

  it("parses a valid recipe", () => {
    const recipe = parseRecipe(validRecipe);
    expect(recipe.name).toBe("Test Recipe");
    expect(recipe.agents).toHaveLength(2);
    expect(recipe.pipeline).toHaveLength(2);
  });

  it("parses budget with dollar sign", () => {
    const recipe = parseRecipe({
      ...validRecipe,
      budget: { max_cost: "$2.50", warn_at_percent: 80 },
    });
    expect(recipe.budget?.maxCost).toBe(2.5);
    expect(recipe.budget?.warnAtPercent).toBe(80);
  });

  it("parses budget with number", () => {
    const recipe = parseRecipe({
      ...validRecipe,
      budget: { max_cost: 5.0 },
    });
    expect(recipe.budget?.maxCost).toBe(5.0);
  });

  it("validates all patterns", () => {
    for (const pattern of ["sequential", "parallel", "hierarchical", "handoff", "loop"]) {
      const recipe = parseRecipe({
        ...validRecipe,
        pipeline: [{ phase: "test", pattern, agents: ["agent-a"] }],
      });
      expect(recipe.pipeline[0].pattern).toBe(pattern);
    }
  });

  it("throws on missing name", () => {
    expect(() => parseRecipe({ ...validRecipe, name: undefined })).toThrow("name");
  });

  it("throws on missing providers", () => {
    expect(() => parseRecipe({ ...validRecipe, providers: undefined })).toThrow("providers");
  });

  it("throws on empty agents", () => {
    expect(() => parseRecipe({ ...validRecipe, agents: [] })).toThrow("at least one agent");
  });

  it("throws on invalid pattern", () => {
    expect(() =>
      parseRecipe({
        ...validRecipe,
        pipeline: [{ phase: "bad", pattern: "invalid", agents: ["agent-a"] }],
      })
    ).toThrow("Invalid pattern");
  });

  it("throws on unknown agent reference in pipeline", () => {
    expect(() =>
      parseRecipe({
        ...validRecipe,
        pipeline: [{ phase: "test", pattern: "sequential", agents: ["ghost-agent"] }],
      })
    ).toThrow("unknown agent 'ghost-agent'");
  });

  it("parses gates", () => {
    const recipe = parseRecipe({
      ...validRecipe,
      pipeline: [
        {
          phase: "test",
          pattern: "sequential",
          agents: ["agent-a"],
          gate: { type: "human_approval", message: "Continue?" },
        },
      ],
    });
    expect(recipe.pipeline[0].gate?.type).toBe("human_approval");
    expect(recipe.pipeline[0].gate?.message).toBe("Continue?");
  });

  it("parses loop configuration", () => {
    const recipe = parseRecipe({
      ...validRecipe,
      pipeline: [
        {
          phase: "iterate",
          pattern: "loop",
          agents: ["agent-a"],
          condition: "confidence < 0.8",
          max_iterations: 5,
        },
      ],
    });
    expect(recipe.pipeline[0].maxIterations).toBe(5);
    expect(recipe.pipeline[0].condition).toBe("confidence < 0.8");
  });
});
