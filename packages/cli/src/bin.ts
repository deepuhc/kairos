#!/usr/bin/env node

/**
 * Kairos CLI entry point.
 * The decisive moment — the right agent, the right tool, the right time.
 */

import { program } from "commander";
import { startCommand } from "./commands/start.js";
import { runCommand } from "./commands/run.js";
import { agentsCommand } from "./commands/agents.js";
import { configCommand } from "./commands/config.js";
import { statusCommand } from "./commands/status.js";

program
  .name("kairos")
  .description("The decisive moment — universal agent orchestration")
  .version("0.1.0");

program
  .command("start")
  .description("Start interactive orchestration session")
  .option("-p, --provider <model>", "LLM provider (e.g., ollama/llama3.2, anthropic/claude-sonnet)")
  .option("-b, --budget <amount>", "Budget limit in USD")
  .option("--local", "Force local-only mode (no cloud)")
  .option("--profile <name>", "Security profile (personal, tax-firm, enterprise, etc.)")
  .action(startCommand);

program
  .command("run <recipe>")
  .description("Execute a recipe file")
  .option("-p, --provider <model>", "Override default provider")
  .option("-b, --budget <amount>", "Budget limit in USD")
  .option("--dry-run", "Show what would happen without executing")
  .option("-i, --input <data>", "Input data for the pipeline")
  .action(runCommand);

program
  .command("agents")
  .description("Manage running agents")
  .addCommand(
    new (await import("commander")).Command("list")
      .description("List all agents")
      .action(agentsCommand.list)
  )
  .addCommand(
    new (await import("commander")).Command("kill")
      .argument("<id>", "Agent ID to kill")
      .description("Kill a running agent")
      .action(agentsCommand.kill)
  );

program
  .command("status")
  .description("Show orchestrator status")
  .action(statusCommand);

program
  .command("config")
  .description("View or modify configuration")
  .argument("[key]", "Config key to get/set")
  .argument("[value]", "Value to set")
  .action(configCommand);

program.parse();
