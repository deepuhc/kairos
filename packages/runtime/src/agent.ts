/**
 * Agent process management.
 * Spawns, monitors, and controls individual agent processes.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface AgentConfig {
  id: string;
  role: string;
  model: string;
  tools?: string[];
  workDir?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "killed";

export class AgentProcess extends EventEmitter {
  readonly id: string;
  readonly config: AgentConfig;
  private process: ChildProcess | null = null;
  private _status: AgentStatus = "idle";
  private _output = "";
  private startTime?: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(config: AgentConfig) {
    super();
    this.id = config.id;
    this.config = config;
  }

  get status(): AgentStatus {
    return this._status;
  }

  get output(): string {
    return this._output;
  }

  get elapsedMs(): number {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  /**
   * Start the agent process.
   * For now, uses a simple subprocess model.
   * Future: support tmux sessions, containers, etc.
   */
  async start(input?: string): Promise<void> {
    this._status = "running";
    this.startTime = Date.now();
    this.emit("started", { id: this.id });

    // Set timeout if configured
    if (this.config.timeout) {
      this.timer = setTimeout(() => {
        this.kill("timed_out");
      }, this.config.timeout);
    }

    return new Promise((resolve, reject) => {
      // Spawn agent process
      // In production, this would invoke the actual LLM CLI
      // For now, it's a placeholder that demonstrates the lifecycle
      this.process = spawn("echo", [
        JSON.stringify({ agentId: this.id, input, role: this.config.role }),
      ], {
        cwd: this.config.workDir,
        env: { ...process.env, ...this.config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        this._output += chunk;
        this.emit("output", { id: this.id, chunk });
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        this.emit("error_output", { id: this.id, chunk: data.toString() });
      });

      this.process.on("close", (code) => {
        if (this.timer) clearTimeout(this.timer);

        if (this._status === "timed_out" || this._status === "killed") {
          // Already handled
          return;
        }

        this._status = code === 0 ? "completed" : "failed";
        this.emit("done", { id: this.id, status: this._status, output: this._output });
        resolve();
      });

      this.process.on("error", (err) => {
        this._status = "failed";
        this.emit("done", { id: this.id, status: "failed", error: err.message });
        reject(err);
      });

      // Send input if provided
      if (input && this.process.stdin) {
        this.process.stdin.write(input);
        this.process.stdin.end();
      }
    });
  }

  /**
   * Send a message to a running agent.
   */
  send(message: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(message + "\n");
    }
  }

  /**
   * Kill the agent process.
   */
  kill(reason: "timed_out" | "killed" = "killed"): void {
    this._status = reason;
    if (this.timer) clearTimeout(this.timer);
    if (this.process) {
      this.process.kill("SIGTERM");
      // Force kill after 5s
      setTimeout(() => this.process?.kill("SIGKILL"), 5000);
    }
    this.emit("done", { id: this.id, status: reason });
  }
}
