import { EventEmitter } from 'node:events';
import { AgentProcess } from './process.js';
import type { AgentConfig, AgentInfo, AgentStatus } from './types.js';

export class AgentPool extends EventEmitter {
  private agents = new Map<string, AgentProcess>();
  private maxConcurrent: number;

  constructor(maxConcurrent = 8) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  spawn(config: AgentConfig): AgentProcess {
    if (this.agents.size >= this.maxConcurrent) {
      throw new Error(`Agent pool at capacity (${this.maxConcurrent})`);
    }

    const agent = new AgentProcess(config);

    agent.onStatus((status) => {
      this.emit('agent:status', { id: config.id, status });
    });

    agent.onOutput((chunk) => {
      this.emit('agent:output', { id: config.id, chunk });
    });

    agent.onExit((code) => {
      this.emit('agent:exit', { id: config.id, code });
      this.agents.delete(config.id);
    });

    this.agents.set(config.id, agent);
    agent.start();
    this.emit('agent:spawned', { id: config.id });
    return agent;
  }

  get(id: string): AgentProcess | undefined {
    return this.agents.get(id);
  }

  kill(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.kill();
    this.agents.delete(id);
    return true;
  }

  killAll(): void {
    for (const [id, agent] of this.agents) {
      agent.kill();
      this.agents.delete(id);
    }
  }

  list(): AgentInfo[] {
    return [...this.agents.entries()].map(([id, agent]) => ({
      id,
      config: (agent as any).config as AgentConfig,
      status: agent.status,
      pid: agent.pid,
      startedAt: Date.now(),
    }));
  }

  get size(): number {
    return this.agents.size;
  }

  get capacity(): number {
    return this.maxConcurrent - this.agents.size;
  }
}
