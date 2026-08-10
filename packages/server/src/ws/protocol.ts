import type { AgentStatus } from '@kairos/agents';
import type { PipelineState, PipelineEvent } from '@kairos/orchestrator';

// Client → Server messages
export type ClientMessage =
  | { type: 'agent:spawn'; config: { command: string; args: string[]; workingDirectory?: string; model?: string; provider?: string } }
  | { type: 'agent:kill'; agentId: string }
  | { type: 'prompt'; agentId: string; text: string }
  | { type: 'pipeline:start'; plan: string; name?: string }
  | { type: 'pipeline:cancel'; pipelineId: string }
  | { type: 'gate:decide'; pipelineId: string; phaseId: string; approved: boolean; reason?: string };

// Server → Client messages
export type ServerMessage =
  | { type: 'init'; agents: Array<{ id: string; status: AgentStatus; config: any }>; providers: Array<{ name: string; available: boolean; models: any[] }> }
  | { type: 'agent:spawned'; agentId: string; config: any }
  | { type: 'agent:output'; agentId: string; chunk: string }
  | { type: 'agent:status'; agentId: string; status: AgentStatus }
  | { type: 'agent:exit'; agentId: string; code: number | null }
  | { type: 'pipeline:state'; pipelineId: string; state: any }
  | { type: 'pipeline:event'; pipelineId: string; event: PipelineEvent }
  | { type: 'pipeline:gate'; pipelineId: string; phaseId: string; message: string }
  | { type: 'error'; message: string };
