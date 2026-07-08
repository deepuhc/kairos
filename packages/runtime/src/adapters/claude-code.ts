/**
 * Claude Code adapter for Kairos.
 * Spawns and orchestrates `claude` CLI processes as agents.
 *
 * This is the fastest way to use Kairos — no API keys needed,
 * just your existing Claude Code installation.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ClaudeCodeConfig {
  /** Working directory for the claude process */
  workDir?: string;
  /** Model to use (default: current Claude Code model) */
  model?: string;
  /** Max turns before stopping (default: unlimited) */
  maxTurns?: number;
  /** Permission mode: default, auto, bypassPermissions */
  permissionMode?: "default" | "auto" | "bypassPermissions";
  /** Additional CLI flags */
  extraFlags?: string[];
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Output file for results */
  outputDir?: string;
}

export interface ClaudeCodeAgent {
  id: string;
  process: ChildProcess | null;
  status: "idle" | "running" | "completed" | "failed";
  output: string;
  outputFile?: string;
}

/**
 * Spawn a Claude Code agent that executes a task.
 * Uses `claude --print` for non-interactive single-shot tasks,
 * or `claude` with piped input for multi-turn.
 */
export class ClaudeCodeRuntime extends EventEmitter {
  private agents = new Map<string, ClaudeCodeAgent>();
  private outputDir: string;

  constructor(config?: { outputDir?: string }) {
    super();
    this.outputDir = config?.outputDir ?? join(tmpdir(), "kairos-agents");
  }

  /**
   * Run a single-shot task with Claude Code.
   * Uses `claude -p` (print mode) — sends prompt, gets response, exits.
   */
  async runTask(
    id: string,
    prompt: string,
    config?: ClaudeCodeConfig
  ): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });

    const agent: ClaudeCodeAgent = {
      id,
      process: null,
      status: "running",
      output: "",
    };
    this.agents.set(id, agent);
    this.emit("agent:started", { id });

    const args = this.buildArgs(prompt, config, "print");

    return new Promise((resolve, reject) => {
      const proc = spawn("claude", args, {
        cwd: config?.workDir ?? process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      agent.process = proc;

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        agent.output += chunk;
        this.emit("agent:output", { id, chunk });
      });

      proc.stderr?.on("data", (data: Buffer) => {
        // Claude Code outputs progress/status to stderr
        this.emit("agent:stderr", { id, chunk: data.toString() });
      });

      proc.on("close", (code) => {
        agent.status = code === 0 ? "completed" : "failed";
        agent.process = null;
        this.emit("agent:done", { id, status: agent.status, output: agent.output });

        if (code === 0) {
          resolve(agent.output);
        } else {
          reject(new Error(`Claude Code exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        agent.status = "failed";
        agent.process = null;
        this.emit("agent:done", { id, status: "failed", error: err.message });
        reject(err);
      });
    });
  }

  /**
   * Run multiple tasks in parallel using Claude Code.
   */
  async runParallel(
    tasks: Array<{ id: string; prompt: string; config?: ClaudeCodeConfig }>
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const promises = tasks.map(async (task) => {
      const output = await this.runTask(task.id, task.prompt, task.config);
      results.set(task.id, output);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Run a task with conversation continuation (multi-turn).
   * Uses `claude --resume` to maintain context across turns.
   */
  async runConversation(
    id: string,
    messages: string[],
    config?: ClaudeCodeConfig
  ): Promise<string> {
    let lastOutput = "";
    const sessionId = `kairos-${id}`;

    for (let i = 0; i < messages.length; i++) {
      const isFirst = i === 0;
      const args = isFirst
        ? this.buildArgs(messages[i], config, "print")
        : this.buildArgs(messages[i], {
            ...config,
            extraFlags: [...(config?.extraFlags ?? []), "--resume", sessionId],
          }, "print");

      lastOutput = await this.runTask(`${id}-turn-${i}`, messages[i], {
        ...config,
        extraFlags: isFirst ? config?.extraFlags : [...(config?.extraFlags ?? []), "--resume"],
      });
    }

    return lastOutput;
  }

  /**
   * Spawn an interactive Claude Code agent (long-running).
   * Useful for agents that need to respond to follow-up questions.
   */
  spawnInteractive(
    id: string,
    initialPrompt: string,
    config?: ClaudeCodeConfig
  ): ClaudeCodeAgent {
    const args = this.buildArgs(initialPrompt, config, "interactive");

    const proc = spawn("claude", args, {
      cwd: config?.workDir ?? process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const agent: ClaudeCodeAgent = {
      id,
      process: proc,
      status: "running",
      output: "",
    };

    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      agent.output += chunk;
      this.emit("agent:output", { id, chunk });
    });

    proc.on("close", (code) => {
      agent.status = code === 0 ? "completed" : "failed";
      agent.process = null;
      this.emit("agent:done", { id, status: agent.status });
    });

    this.agents.set(id, agent);
    this.emit("agent:started", { id });
    return agent;
  }

  /**
   * Send a message to a running interactive agent.
   */
  send(id: string, message: string): void {
    const agent = this.agents.get(id);
    if (!agent?.process?.stdin?.writable) {
      throw new Error(`Agent '${id}' is not running or not interactive`);
    }
    agent.process.stdin.write(message + "\n");
  }

  /**
   * Kill an agent.
   */
  kill(id: string): void {
    const agent = this.agents.get(id);
    if (agent?.process) {
      agent.process.kill("SIGTERM");
      agent.status = "failed";
    }
  }

  /**
   * Get agent status.
   */
  get(id: string): ClaudeCodeAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * List all agents.
   */
  list(): ClaudeCodeAgent[] {
    return [...this.agents.values()];
  }

  private buildArgs(
    prompt: string,
    config?: ClaudeCodeConfig,
    mode: "print" | "interactive" = "print"
  ): string[] {
    const args: string[] = [];

    if (mode === "print") {
      args.push("-p", prompt);
    }

    if (config?.model) {
      args.push("--model", config.model);
    }

    if (config?.maxTurns) {
      args.push("--max-turns", String(config.maxTurns));
    }

    if (config?.permissionMode === "auto") {
      args.push("--dangerously-skip-permissions");
    }

    if (config?.systemPrompt) {
      args.push("--system-prompt", config.systemPrompt);
    }

    if (config?.extraFlags) {
      args.push(...config.extraFlags);
    }

    // For interactive mode, prompt goes via stdin
    if (mode === "interactive") {
      args.push("--verbose");
    }

    return args;
  }
}
