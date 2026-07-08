/**
 * Pipeline execution state management.
 * Event-sourced state that supports checkpointing and resumability.
 */

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export interface TaskState {
  id: string;
  agentId: string;
  phase: string;
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
  costUsd: number;
  tokensUsed: number;
}

export interface PipelineState {
  id: string;
  recipeId: string;
  status: TaskStatus;
  currentPhase: number;
  tasks: TaskState[];
  totalCostUsd: number;
  totalTokens: number;
  startedAt: string;
  completedAt?: string;
  events: ExecutionEvent[];
  checkpoint?: Checkpoint;
}

export interface ExecutionEvent {
  timestamp: string;
  type: EventType;
  phase?: string;
  agent?: string;
  details?: Record<string, unknown>;
}

export type EventType =
  | "pipeline_started"
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "agent_spawned"
  | "agent_completed"
  | "agent_failed"
  | "gate_check"
  | "gate_passed"
  | "gate_failed"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "budget_warning"
  | "budget_exceeded"
  | "pipeline_completed"
  | "pipeline_failed"
  | "checkpoint_saved";

export interface Checkpoint {
  phaseIndex: number;
  taskStates: TaskState[];
  savedAt: string;
}

/**
 * Create a fresh pipeline state.
 */
export function createPipelineState(
  id: string,
  recipeId: string
): PipelineState {
  return {
    id,
    recipeId,
    status: "pending",
    currentPhase: 0,
    tasks: [],
    totalCostUsd: 0,
    totalTokens: 0,
    startedAt: new Date().toISOString(),
    events: [],
  };
}

/**
 * Add an event to the pipeline state (event sourcing).
 */
export function recordEvent(
  state: PipelineState,
  type: EventType,
  details?: Record<string, unknown>
): PipelineState {
  const event: ExecutionEvent = {
    timestamp: new Date().toISOString(),
    type,
    ...details,
  };
  return {
    ...state,
    events: [...state.events, event],
  };
}
