/**
 * `kairos run <recipe>` — Execute a recipe file.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseRecipe, Scheduler } from "@kairos/core";
import type { TaskState } from "@kairos/core";
import { SmartRouter } from "@kairos/providers";
import { detectProviders } from "@kairos/providers";

interface RunOptions {
  provider?: string;
  budget?: string;
  dryRun?: boolean;
  input?: string;
}

export async function runCommand(
  recipePath: string,
  options: RunOptions
): Promise<void> {
  // Load and parse recipe
  const fullPath = resolve(recipePath);
  let content: string;

  try {
    content = await readFile(fullPath, "utf-8");
  } catch {
    console.error(`  Error: Cannot read recipe file: ${fullPath}`);
    process.exit(1);
  }

  const raw = parseYaml(content);
  const recipe = parseRecipe(raw);

  console.log("");
  console.log(`  Pipeline: ${recipe.name}`);
  console.log(`  Phases: ${recipe.pipeline.length}`);
  console.log(`  Agents: ${recipe.agents.length}`);

  if (recipe.budget) {
    console.log(`  Budget: $${recipe.budget.maxCost.toFixed(2)}`);
  }
  console.log("");

  // Dry run — just show what would happen
  if (options.dryRun) {
    console.log("  Dry run — phases that would execute:");
    console.log("");
    for (let i = 0; i < recipe.pipeline.length; i++) {
      const phase = recipe.pipeline[i];
      const agents = phase.agents.join(", ");
      const gate = phase.gate ? ` [gate: ${phase.gate.type}]` : "";
      console.log(`    ${i + 1}. ${phase.phase} (${phase.pattern}) → ${agents}${gate}`);
    }
    console.log("");
    return;
  }

  // Set up providers
  const providers = await detectProviders();
  if (providers.length === 0) {
    console.error("  Error: No LLM providers available.");
    process.exit(1);
  }

  const router = new SmartRouter({
    providers,
    defaultModel: recipe.providers.default,
    budgetLimit: recipe.budget?.maxCost,
  });

  // Execute pipeline
  const scheduler = new Scheduler({
    onPhaseReady: async (phase): Promise<TaskState[]> => {
      console.log(`  ◉ ${phase.phase} (${phase.pattern})...`);

      // Placeholder task results — in production, this dispatches to real agents
      const results: TaskState[] = phase.agents.map((agentId) => ({
        id: crypto.randomUUID(),
        agentId,
        phase: phase.phase,
        status: "completed" as const,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        costUsd: 0,
        tokensUsed: 0,
      }));

      return results;
    },
    onGateCheck: async (phase): Promise<boolean> => {
      console.log(`  ⊘ Gate: ${phase.gate?.check ?? phase.gate?.type}`);
      return true;
    },
    onApprovalNeeded: async (phase): Promise<boolean> => {
      console.log(`  ⚠ Approval needed: ${phase.gate?.message ?? "Continue?"}`);
      // In production: prompt user via TUI
      return true;
    },
    onStateChange: (state) => {
      // Could update a TUI progress display here
    },
  });

  const result = await scheduler.execute(recipe);

  console.log("");
  if (result.status === "completed") {
    console.log(`  ✓ Complete | $${result.totalCostUsd.toFixed(2)} | ${result.tasks.length} tasks`);
  } else {
    console.log(`  ✗ Failed at phase ${result.currentPhase}`);
  }
  console.log("");
}
