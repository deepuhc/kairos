/**
 * LLM Runtime — the generic interface that all adapters implement.
 *
 * Kairos doesn't care what LLM you use. It only needs:
 * 1. A way to send a prompt and get a response
 * 2. Events for streaming progress
 *
 * Any CLI tool that accepts a prompt and produces text output can be an adapter.
 */

import { EventEmitter } from "node:events";

export interface RuntimeTask {
  id: string;
  prompt: string;
  config?: Record<string, unknown>;
}

export interface RuntimeEvents {
  "agent:started": { id: string };
  "agent:output": { id: string; chunk: string };
  "agent:stderr": { id: string; chunk: string };
  "agent:done": { id: string; status: "completed" | "failed"; output?: string; error?: string };
  /** Structured streaming events (emitted by tools that support stream-json) */
  "agent:thinking": { id: string; thinking: string };
  "agent:text": { id: string; text: string };
  "agent:tool_use": { id: string; name: string; input: Record<string, unknown> };
  "agent:tool_result": { id: string; name: string; result: string; error?: boolean; isPermissionDenial?: boolean };
  "agent:result": { id: string; result: string; cost_usd?: number; duration_ms?: number };
  /** The agent is waiting for user input (e.g., permission prompt, question) */
  "agent:input_required": { id: string; prompt: string; type: "permission" | "question" | "unknown" };
}

/**
 * Abstract runtime interface. All LLM adapters extend this.
 */
export abstract class LLMRuntime extends EventEmitter {
  abstract readonly name: string;

  /** Run a single prompt and return the full output */
  abstract runTask(id: string, prompt: string, config?: Record<string, unknown>): Promise<string>;

  /** Run multiple tasks in parallel */
  async runParallel(tasks: RuntimeTask[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    await Promise.all(
      tasks.map(async (t) => {
        const output = await this.runTask(t.id, t.prompt, t.config);
        results.set(t.id, output);
      })
    );
    return results;
  }

  /** Send input to a running interactive agent (optional — not all runtimes support this) */
  send(_id: string, _message: string): void {
    throw new Error(`${this.name} does not support interactive messaging`);
  }

  /** Kill a running agent */
  abstract kill(id: string): void;
}
