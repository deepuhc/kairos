import { AgentProcess } from '../process.js';
import type { AgentAdapter, AgentConfig, AgentHandle } from '../types.js';

export class CLIAdapter implements AgentAdapter {
  spawn(config: AgentConfig): AgentHandle {
    const agent = new AgentProcess(config);
    agent.start();
    return agent;
  }
}
