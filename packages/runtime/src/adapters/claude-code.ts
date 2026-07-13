/**
 * Claude Code adapter for Kairos.
 * Spawns and orchestrates `claude` CLI processes as agents.
 *
 * This is the fastest way to use Kairos — no API keys needed,
 * just your existing Claude Code installation.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

/** Detect the user's login shell */
function getUserShell(): string {
  // 1. $SHELL env (most reliable — set by OS)
  if (process.env.SHELL) return process.env.SHELL;

  // 2. Try to read from /etc/passwd on unix
  try {
    const passwd = execSync(`getent passwd $(whoami) 2>/dev/null || grep "^$(whoami):" /etc/passwd`, { encoding: "utf-8" });
    const shell = passwd.trim().split(":").pop();
    if (shell && shell.startsWith("/")) return shell;
  } catch { /* skip */ }

  // 3. Platform defaults
  if (process.platform === "win32") return "cmd.exe";
  return "/bin/sh";
}

/** Verify a claude binary actually works (not just exists) */
function verifyClaudeBinary(path: string): boolean {
  try {
    const out = execSync(`"${path}" --version 2>&1`, { encoding: "utf-8", timeout: 5000 }).trim();
    return out.includes("Claude Code") || out.includes("claude");
  } catch {
    return false;
  }
}

/** Resolve the full path to the `claude` binary — verified working */
function resolveClaudePath(): string {
  const shell = getUserShell();
  const tried: string[] = [];

  // 1. Known locations (checked AND verified)
  const candidates = [
    join(homedir(), ".config/devai/bin/claude"),
    join(homedir(), ".claude/bin/claude"),
    "/usr/local/bin/claude",
    join(homedir(), ".local/bin/claude"),
    join(homedir(), ".npm/bin/claude"),
  ];

  for (const c of candidates) {
    tried.push(c);
    try {
      execSync(`test -x "${c}"`, { stdio: "ignore" });
      if (verifyClaudeBinary(c)) return c;
    } catch { /* skip */ }
  }

  // 2. User's login shell
  try {
    const result = execSync(`${shell} -lc 'which claude'`, { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && !tried.includes(result)) {
      tried.push(result);
      if (verifyClaudeBinary(result)) return result;
    }
  } catch { /* skip */ }

  // 3. Try each common shell (in case $SHELL is wrong)
  for (const sh of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    try {
      const result = execSync(`${sh} -lc 'which claude' 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim();
      if (result && !tried.includes(result)) {
        tried.push(result);
        if (verifyClaudeBinary(result)) return result;
      }
    } catch { /* skip */ }
  }

  // 4. Direct which (no login shell)
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && !tried.includes(result)) {
      if (verifyClaudeBinary(result)) return result;
    }
  } catch { /* skip */ }

  console.error("[kairos] WARNING: Could not find a working claude binary. Tried:", tried);
  return "claude"; // last resort — will likely fail
}

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
  readonly claudePath: string;
  private userShell: string;

  constructor(config?: { outputDir?: string }) {
    super();
    this.outputDir = config?.outputDir ?? join(tmpdir(), "kairos-agents");
    this.userShell = getUserShell();
    this.claudePath = resolveClaudePath();
  }

  /**
   * Spawn claude directly using the resolved binary path.
   * No login shell needed — we already resolved the full path.
   * This preserves the parent process's env vars (auth tokens, etc.)
   * without risk of shell profiles overriding or dropping them.
   */
  private spawnClaude(args: string[], cwd: string, interactive: boolean): ChildProcess {
    // For non-interactive (print mode): use "ignore" for stdin so claude
    // doesn't wait for piped input that will never come.
    // For interactive mode: keep stdin as pipe so we can write to it.
    const stdinMode = interactive ? "pipe" : "ignore";

    return spawn(this.claudePath, args, {
      cwd,
      env: { ...process.env },
      stdio: [stdinMode, "pipe", "pipe"],
    });
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
      const cwd = config?.workDir ?? process.cwd();

      // Diagnostic logging
      const logPrefix = `[kairos:${id}]`;
      console.log(`${logPrefix} Claude: ${this.claudePath} | Args: ${args.length}`);
      console.log(`${logPrefix} CWD: ${cwd}`);

      const proc = this.spawnClaude(args, cwd, false);

      agent.process = proc;

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        agent.output += chunk;
        this.emit("agent:output", { id, chunk });
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        console.log(`${logPrefix} STDERR: ${chunk.trim()}`);
        // Claude Code outputs progress/status to stderr
        this.emit("agent:stderr", { id, chunk });
        // Surface errors so dashboard can show them
        if (chunk.toLowerCase().includes("error") || chunk.toLowerCase().includes("not found") || chunk.toLowerCase().includes("not logged")) {
          this.emit("agent:output", { id, chunk: `[stderr] ${chunk.trim()}` });
        }
      });

      proc.on("close", (code) => {
        agent.status = code === 0 ? "completed" : "failed";
        agent.process = null;
        console.log(`${logPrefix} Exit code: ${code}`);
        if (code !== 0) {
          console.log(`${logPrefix} STDOUT was: ${agent.output.slice(0, 500)}`);
        }
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
    const cwd = config?.workDir ?? process.cwd();
    const proc = this.spawnClaude(args, cwd, true);

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
