export type AgentStatus = 'spawning' | 'ready' | 'working' | 'idle' | 'terminated' | 'error';

export interface AgentConfig {
  id: string;
  command: string;
  args: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  adapter?: 'cli' | 'ollama-http';
  model?: string;
  provider?: string;
}

export interface AgentInfo {
  id: string;
  config: AgentConfig;
  status: AgentStatus;
  pid?: number;
  startedAt: number;
  lastActivity?: number;
}

export interface AgentAdapter {
  spawn(config: AgentConfig): AgentHandle;
}

export interface AgentHandle {
  readonly id: string;
  readonly status: AgentStatus;
  send(text: string): void;
  kill(): void;
  onOutput(handler: (chunk: string) => void): void;
  onStatus(handler: (status: AgentStatus) => void): void;
  onExit(handler: (code: number | null) => void): void;
}
