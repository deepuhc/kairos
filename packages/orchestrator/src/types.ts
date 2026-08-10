export type PhaseStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';
export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type PhaseType = 'agent' | 'gate' | 'fanout';
export type GateType = 'human_approval' | 'budget' | 'quality' | 'programmatic';

export interface PhaseDefinition {
  id: string;
  type: PhaseType;
  dependsOn: string[];
  role?: string;
  prompt?: string;
  gateType?: GateType;
  gateMessage?: string;
  fanoutItems?: unknown[];
  maxRetries?: number;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  phases: PhaseDefinition[];
}

export interface PhaseState {
  id: string;
  status: PhaseStatus;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  agentId?: string;
}

export interface PipelineState {
  id: string;
  definitionId: string;
  status: PipelineStatus;
  phases: Map<string, PhaseState>;
  startedAt?: number;
  completedAt?: number;
  events: PipelineEvent[];
}

export type PipelineEvent =
  | { type: 'pipeline:started'; timestamp: number }
  | { type: 'pipeline:completed'; timestamp: number }
  | { type: 'pipeline:failed'; timestamp: number; error: string }
  | { type: 'pipeline:cancelled'; timestamp: number }
  | { type: 'pipeline:paused'; timestamp: number; phaseId: string }
  | { type: 'pipeline:resumed'; timestamp: number; phaseId: string }
  | { type: 'phase:ready'; timestamp: number; phaseId: string }
  | { type: 'phase:started'; timestamp: number; phaseId: string; agentId?: string }
  | { type: 'phase:completed'; timestamp: number; phaseId: string; result?: unknown }
  | { type: 'phase:failed'; timestamp: number; phaseId: string; error: string }
  | { type: 'phase:skipped'; timestamp: number; phaseId: string }
  | { type: 'gate:waiting'; timestamp: number; phaseId: string; message: string }
  | { type: 'gate:approved'; timestamp: number; phaseId: string }
  | { type: 'gate:rejected'; timestamp: number; phaseId: string; reason?: string };

export interface PhaseExecutor {
  execute(phase: PhaseDefinition, context: ExecutionContext): Promise<unknown>;
}

export interface ExecutionContext {
  pipelineId: string;
  dependencyResults: Map<string, unknown>;
  workingDirectory?: string;
}
