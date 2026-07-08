/**
 * Agent pool — manages multiple concurrent agent processes.
 */

import { AgentProcess, type AgentConfig, type AgentStatus } from "./agent.js";

export class AgentPool {
  private agents = new Map<string, AgentProcess>();
  private maxConcurrent: number;

  constructor(options?: { maxConcurrent?: number }) {
    this.maxConcurrent = options?.maxConcurrent ?? 10;
  }

  /** Number of currently running agents */
  get activeCount(): number {
    return [...this.agents.values()].filter((a) => a.status === "running").length;
  }

  /** Get all agents and their statuses */
  list(): Array<{ id: string; role: string; status: AgentStatus; elapsedMs: number }> {
    return [...this.agents.values()].map((a) => ({
      id: a.id,
      role: a.config.role,
      status: a.status,
      elapsedMs: a.elapsedMs,
    }));
  }

  /** Spawn a new agent */
  async spawn(config: AgentConfig, input?: string): Promise<AgentProcess> {
    if (this.activeCount >= this.maxConcurrent) {
      throw new Error(
        `Agent pool full (${this.maxConcurrent} max). Kill an agent or wait for one to complete.`
      );
    }

    const agent = new AgentProcess(config);
    this.agents.set(config.id, agent);

    // Don't await — let it run in the background
    agent.start(input).catch(() => {
      // Error already emitted via event
    });

    return agent;
  }

  /** Get an agent by ID */
  get(id: string): AgentProcess | undefined {
    return this.agents.get(id);
  }

  /** Send a message to a running agent */
  send(id: string, message: string): void {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent '${id}' not found`);
    if (agent.status !== "running") {
      throw new Error(`Agent '${id}' is not running (status: ${agent.status})`);
    }
    agent.send(message);
  }

  /** Kill an agent */
  kill(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent '${id}' not found`);
    agent.kill();
  }

  /** Kill all running agents */
  killAll(): void {
    for (const agent of this.agents.values()) {
      if (agent.status === "running") {
        agent.kill();
      }
    }
  }

  /** Remove completed/failed agents from the pool */
  prune(): number {
    let pruned = 0;
    for (const [id, agent] of this.agents) {
      if (agent.status !== "running" && agent.status !== "idle") {
        this.agents.delete(id);
        pruned++;
      }
    }
    return pruned;
  }
}
