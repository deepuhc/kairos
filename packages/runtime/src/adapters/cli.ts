/**
 * Universal CLI Adapter for Kairos.
 *
 * Works with ANY command-line tool that:
 * - Accepts a prompt as an argument or via stdin
 * - Returns text output on stdout
 *
 * Examples:
 *   claude -p "{prompt}"
 *   ollama run llama3 "{prompt}"
 *   aichat "{prompt}"
 *   sgpt "{prompt}"
 *   openai api chat.completions.create -m gpt-4 -g user "{prompt}"
 *   cat prompt.txt | any-llm-tool
 *
 * Config is just: { command, args, promptMode }
 * That's it. No auth flows, no API keys in the UI. If the tool works
 * in your terminal, it works in Kairos.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { LLMRuntime } from "../runtime.js";

const DEBUG = process.env.KAIROS_DEBUG === "1" || process.env.DEBUG?.includes("kairos");

function debug(prefix: string, ...args: unknown[]) {
  if (DEBUG) console.log(`[kairos:${prefix}]`, ...args);
}

export interface CLIAdapterConfig {
  /** The command to run (e.g., "claude", "ollama", "/usr/local/bin/aichat") */
  command: string;

  /** Arguments template. Use {prompt} as placeholder.
   *  e.g., ["-p", "{prompt}"] or ["run", "llama3", "{prompt}"]
   */
  args: string[];

  /** How to pass the prompt:
   *  - "arg" (default): substitutes {prompt} in args
   *  - "stdin": pipes the prompt to stdin
   *  - "file": writes prompt to a temp file, substitutes {file} in args
   */
  promptMode?: "arg" | "stdin" | "file";

  /** Working directory for the process */
  workDir?: string;

  /** Extra env vars to set (merged with process.env) */
  env?: Record<string, string>;

  /** Extra args appended after the template args (e.g. permission flags) */
  extraArgs?: string[];

  /** Timeout in ms (default: 600000 = 10 minutes) */
  timeout?: number;

  /** Enable structured JSON streaming (e.g., Claude's --output-format stream-json).
   *  When true, stdout is parsed line-by-line as JSON events and emitted as typed events.
   *  Non-JSON lines fall back to plain agent:output events.
   */
  streamJson?: boolean;
}

interface RunningAgent {
  id: string;
  process: ChildProcess | null;
  output: string;
  status: "running" | "completed" | "failed";
}

/**
 * Universal CLI adapter — spawn any LLM tool as an agent.
 */
export class CLIRuntime extends LLMRuntime {
  readonly name: string;
  private config: CLIAdapterConfig;
  private agents = new Map<string, RunningAgent>();

  constructor(config: CLIAdapterConfig) {
    super();
    this.config = config;
    this.name = config.command.split("/").pop() || config.command;
  }

  async runTask(id: string, prompt: string, overrides?: Record<string, unknown>): Promise<string> {
    const config = { ...this.config, ...overrides } as CLIAdapterConfig;
    const agent: RunningAgent = { id, process: null, output: "", status: "running" };
    this.agents.set(id, agent);
    this.emit("agent:started", { id });

    return new Promise((resolve, reject) => {
      let args = this.buildArgs(config.args, prompt, config.promptMode);

      // If stream-json mode requested and not already in args, inject the format flags
      if (config.streamJson && !args.includes("stream-json")) {
        args = [...args, "--output-format", "stream-json", "--verbose"];
      }

      // Auto-detect streamJson from args (e.g., user put it in config directly)
      if (!config.streamJson && args.includes("stream-json")) {
        config.streamJson = true;
      }

      if (config.extraArgs?.length) args = [...args, ...config.extraArgs];
      const cwd = config.workDir ?? process.cwd();
      const pipeStdin = config.promptMode === "stdin";

      debug(id, `spawn: ${config.command} ${args.map(a => a.length > 50 ? a.slice(0, 50) + '...' : a).join(' ')}`);
      debug(id, `cwd: ${cwd} | promptMode: ${config.promptMode || 'arg'} | streamJson: ${!!config.streamJson}`);

      // Always use stdin: "pipe" so the process can request input (permissions, etc.)
      const proc = spawn(config.command, args, {
        cwd,
        env: { ...process.env, ...(config.env || {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      agent.process = proc;

      if (pipeStdin && proc.stdin) {
        // Prompt delivered via stdin — write it but keep stdin OPEN for follow-up input
        proc.stdin.write(prompt + "\n");
      }
      // For "arg" mode: prompt is already in args, stdin stays open for interactive input

      // Line buffer for stream-json parsing
      let lineBuffer = "";

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        agent.output += chunk;

        if (config.streamJson) {
          // Buffer lines and parse each complete line as JSON
          lineBuffer += chunk;
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || ""; // Keep incomplete last line in buffer
          for (const line of lines) {
            if (line.trim()) this.parseStreamLine(id, line.trim());
          }
        } else {
          this.emit("agent:output", { id, chunk });
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        debug(id, `stderr: ${chunk.trim().slice(0, 200)}`);
        this.emit("agent:stderr", { id, chunk });
        const trimmed = chunk.trim();
        // Check if stderr contains a permission/input prompt
        if (trimmed && this.isPermissionPrompt(trimmed)) {
          this.emit("agent:input_required", { id, prompt: trimmed, type: "permission" });
        } else if (trimmed && !trimmed.startsWith("Warning:")) {
          this.emit("agent:output", { id, chunk: `[progress] ${trimmed}` });
        }
      });

      proc.on("close", (code) => {
        // Flush remaining line buffer
        if (config.streamJson && lineBuffer.trim()) {
          this.parseStreamLine(id, lineBuffer.trim());
        }

        agent.status = code === 0 ? "completed" : "failed";
        agent.process = null;
        debug(id, `exit: ${code} | output: ${agent.output.length} bytes`);
        if (code !== 0) {
          debug(id, `stdout was: ${agent.output.slice(0, 300)}`);
        }
        this.emit("agent:done", { id, status: agent.status, output: agent.output });
        if (code === 0) {
          resolve(agent.output);
        } else {
          reject(new Error(`${this.name} exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        agent.status = "failed";
        agent.process = null;
        this.emit("agent:done", { id, status: "failed", error: err.message });
        reject(err);
      });

      // Timeout (10 min default — real tasks like code analysis take time)
      const timeout = config.timeout ?? 600000;
      setTimeout(() => {
        if (agent.status === "running" && agent.process) {
          agent.process.kill("SIGTERM");
          reject(new Error(`${this.name} timed out after ${Math.round(timeout / 1000)}s`));
        }
      }, timeout);
    });
  }

  send(id: string, message: string): void {
    const agent = this.agents.get(id);
    if (!agent?.process?.stdin?.writable) {
      throw new Error(`Agent '${id}' is not running or not interactive`);
    }
    agent.process.stdin.write(message + "\n");
  }

  kill(id: string): void {
    const agent = this.agents.get(id);
    if (agent?.process) {
      agent.process.kill("SIGTERM");
      agent.status = "failed";
    }
  }

  /**
   * Parse a single line of stream-json output and emit typed events.
   * Handles Claude's --output-format stream-json --verbose format.
   */
  private parseStreamLine(id: string, line: string): void {
    try {
      const event = JSON.parse(line);

      switch (event.type) {
        case "system":
          // Init event — session metadata (tools, model, etc.)
          debug(id, `stream: system/${event.subtype}`);
          break;

        case "assistant": {
          const content = event.message?.content;
          if (!Array.isArray(content)) break;
          for (const block of content) {
            if (block.type === "thinking") {
              this.emit("agent:thinking", { id, thinking: block.thinking });
            } else if (block.type === "text") {
              // Check if this is a permission prompt disguised as text
              if (this.isPermissionPrompt(block.text)) {
                this.emit("agent:input_required", { id, prompt: block.text, type: "permission" });
              } else {
                this.emit("agent:text", { id, text: block.text });
              }
            } else if (block.type === "tool_use") {
              this.emit("agent:tool_use", { id, name: block.name, input: block.input ?? {} });
            }
          }
          break;
        }

        case "user": {
          // Tool results come as "user" messages with tool_result content
          const content = event.message?.content;
          if (!Array.isArray(content)) break;
          for (const block of content) {
            if (block.type === "tool_result") {
              const resultText = typeof block.content === "string"
                ? block.content
                : (event.tool_use_result?.stdout ?? JSON.stringify(block.content));

              this.emit("agent:tool_result", {
                id,
                name: block.tool_use_id || "unknown",
                result: resultText,
                error: block.is_error,
                // Tag permission denials so the UI can highlight them
                isPermissionDenial: block.is_error && this.isPermissionDenial(resultText),
              });
            }
          }
          break;
        }

        case "permission_request": {
          // Permission prompt — forward to user for approval
          const prompt = event.message || event.description ||
            `Permission needed: ${event.tool || "unknown action"}`;
          debug(id, `stream: permission_request — ${prompt}`);
          this.emit("agent:input_required", { id, prompt, type: "permission" });
          break;
        }

        case "result":
          this.emit("agent:result", {
            id,
            result: event.result ?? "",
            cost_usd: event.total_cost_usd,
            duration_ms: event.duration_ms,
          });
          break;

        default:
          debug(id, `stream: type="${event.type}" subtype="${event.subtype || ''}"`);
          break;
      }
    } catch {
      // Not valid JSON — emit as plain output (graceful fallback)
      if (line.length > 0) {
        this.emit("agent:output", { id, chunk: line + "\n" });
      }
    }
  }

  /**
   * Detect if text is a permission/approval prompt from the LLM tool.
   * Works for Claude and generic tools that ask yes/no questions.
   */
  private isPermissionPrompt(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      // Claude permission patterns
      /requested permissions?\s+to/i.test(text) ||
      /haven't granted/i.test(text) ||
      /allow .+ to (read|write|execute|access|create|delete|modify|run)/i.test(text) ||
      /do you want to (allow|grant|permit)/i.test(text) ||
      // Generic yes/no approval patterns
      (/\b(allow|approve|grant|permit|authorize)\b/i.test(text) &&
        /\b(yes|no|y\/n|\[y\]|\[n\])\b/i.test(text))
    );
  }

  /**
   * Detect if a tool result is a permission denial that the user should act on.
   */
  private isPermissionDenial(text: string): boolean {
    return (
      /haven't granted/i.test(text) ||
      /was blocked/i.test(text) ||
      /requires approval/i.test(text) ||
      /permission denied/i.test(text) ||
      /not allowed/i.test(text) ||
      /requested permissions? to/i.test(text)
    );
  }

  private buildArgs(template: string[], prompt: string, mode?: string): string[] {
    if (mode === "stdin") {
      return template.filter((a) => !a.includes("{prompt}"));
    }

    // If {prompt} placeholder exists, substitute it
    if (template.some((a) => a.includes("{prompt}"))) {
      return template.map((a) => a.replace("{prompt}", prompt));
    }

    // No placeholder — just append the prompt as the last argument
    return [...template, prompt];
  }
}
