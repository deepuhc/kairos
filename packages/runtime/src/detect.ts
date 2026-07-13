/**
 * Auto-detect available LLM tools on the system.
 *
 * Kairos scans for known CLI tools and creates a runtime from
 * whatever is already installed and working. Zero configuration.
 */

import { execSync } from "node:child_process";
import { CLIRuntime, type CLIAdapterConfig } from "./adapters/cli.js";
import type { LLMRuntime } from "./runtime.js";

const DEBUG = process.env.KAIROS_DEBUG === "1" || process.env.DEBUG?.includes("kairos");

function debug(...args: unknown[]) {
  if (DEBUG) console.log("[kairos:detect]", ...args);
}

/** Known LLM CLI tools and how to invoke them */
const KNOWN_TOOLS: Array<{
  name: string;
  commands: string[]; // possible binary names/paths
  args: string[];
  promptMode: "arg" | "stdin";
  verify: string; // command to verify it works (should exit 0)
}> = [
  {
    name: "claude",
    commands: ["claude"],
    args: ["-p", "{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
  {
    name: "ollama",
    commands: ["ollama"],
    args: ["run", "llama3.1", "{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
  {
    name: "aichat",
    commands: ["aichat"],
    args: ["{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
  {
    name: "sgpt",
    commands: ["sgpt"],
    args: ["{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
  {
    name: "llm",
    commands: ["llm"],
    args: ["{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
  {
    name: "mods",
    commands: ["mods"],
    args: ["{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
  {
    name: "openai",
    commands: ["openai"],
    args: ["api", "chat.completions.create", "-m", "gpt-4o", "-g", "user", "{prompt}"],
    promptMode: "arg",
    verify: "--version",
  },
];

/**
 * Find a binary on the system. Returns the full path or null.
 */
function findBinary(name: string): string | null {
  try {
    const path = execSync(`which ${name} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Verify a binary actually runs (not just exists).
 */
function verifyBinary(path: string, flag: string): boolean {
  try {
    execSync(`"${path}" ${flag} 2>&1`, { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface DetectedTool {
  name: string;
  path: string;
  config: CLIAdapterConfig;
}

/**
 * Scan the system for available LLM CLI tools.
 * Returns all detected tools, sorted by preference.
 */
export function detectTools(): DetectedTool[] {
  const found: DetectedTool[] = [];

  for (const tool of KNOWN_TOOLS) {
    for (const cmd of tool.commands) {
      const path = findBinary(cmd);
      if (path) {
        debug(`found ${cmd} at ${path}, verifying...`);
        if (verifyBinary(path, tool.verify)) {
          debug(`${cmd} verified OK`);
          found.push({
            name: tool.name,
            path,
            config: {
              command: path,
              args: tool.args,
              promptMode: tool.promptMode,
            },
          });
          break;
        } else {
          debug(`${cmd} verification failed`);
        }
      }
    }
  }

  return found;
}

/**
 * Create a runtime from the best available tool.
 *
 * Resolution order:
 * 1. KAIROS_COMMAND env var (e.g. "claude", "/path/to/ollama")
 * 2. Preferred tool name from config
 * 3. Auto-detected tools (first available)
 *
 * @param preferred - Optional tool name to prefer (from user config)
 */
export function createRuntime(preferred?: string): LLMRuntime {
  // 1. Env var override — simplest way for users to configure
  //    e.g. KAIROS_COMMAND="devai launch claude -p"
  //    No {prompt} needed — it's appended automatically if missing
  const envCommand = process.env.KAIROS_COMMAND;
  if (envCommand) {
    debug(`using KAIROS_COMMAND: ${envCommand}`);
    const parts = envCommand.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.length > 1 ? parts.slice(1) : ["-p"];
    return new CLIRuntime({ command, args, promptMode: "arg" });
  }

  const tools = detectTools();

  if (tools.length === 0) {
    const configExample = JSON.stringify(
      { command: "/path/to/your-llm", args: ["-p", "{prompt}"] },
      null,
      2
    );
    throw new Error(
      "No LLM CLI tools found. Install one of: claude, ollama, aichat, sgpt, llm, mods\n\n" +
      "  Quick fix — pick ONE:\n\n" +
      "  Option A: Set an env var (add to your shell profile):\n" +
      "    export KAIROS_COMMAND=\"/path/to/claude -p {prompt}\"\n\n" +
      "  Option B: Create ~/.kairos/config.json:\n" +
      `    ${configExample}\n`
    );
  }

  // Use preferred tool if specified and available
  if (preferred) {
    const match = tools.find((t) => t.name === preferred);
    if (match) return new CLIRuntime(match.config);
  }

  // Otherwise use the first available (ordered by KNOWN_TOOLS priority)
  return new CLIRuntime(tools[0].config);
}

/**
 * Create a runtime from explicit config (for custom/unknown tools).
 */
export function createCustomRuntime(config: CLIAdapterConfig): LLMRuntime {
  return new CLIRuntime(config);
}
