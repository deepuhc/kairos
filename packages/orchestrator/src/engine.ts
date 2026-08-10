import { EventEmitter } from 'node:events';
import type {
  PipelineDefinition, PipelineState, PhaseState, PhaseExecutor,
  ExecutionContext, PipelineEvent, PhaseDefinition,
} from './types.js';
import { validateDAG, computeReadySet } from './dag.js';

export class PipelineEngine extends EventEmitter {
  private definition: PipelineDefinition;
  private state: PipelineState;
  private executor: PhaseExecutor;
  private gateResolvers = new Map<string, (approved: boolean, reason?: string) => void>();

  constructor(definition: PipelineDefinition, executor: PhaseExecutor) {
    super();
    this.definition = definition;
    this.executor = executor;

    const phases = new Map<string, PhaseState>();
    for (const p of definition.phases) {
      phases.set(p.id, { id: p.id, status: 'pending' });
    }

    this.state = {
      id: `run_${Date.now()}`,
      definitionId: definition.id,
      status: 'idle',
      phases,
      events: [],
    };
  }

  async run(): Promise<PipelineState> {
    const validation = validateDAG(this.definition);
    if (!validation.valid) {
      throw new Error(`Invalid pipeline: ${validation.error}`);
    }

    this.transition('running');
    this.recordEvent({ type: 'pipeline:started', timestamp: Date.now() });

    try {
      await this.executeLoop();

      const allCompleted = [...this.state.phases.values()].every(
        (p) => p.status === 'completed' || p.status === 'skipped'
      );

      if (allCompleted) {
        this.transition('completed');
        this.recordEvent({ type: 'pipeline:completed', timestamp: Date.now() });
      }
    } catch (err) {
      this.transition('failed');
      this.recordEvent({ type: 'pipeline:failed', timestamp: Date.now(), error: String(err) });
    }

    return this.state;
  }

  approveGate(phaseId: string, approved: boolean, reason?: string): void {
    const resolver = this.gateResolvers.get(phaseId);
    if (resolver) {
      resolver(approved, reason);
      this.gateResolvers.delete(phaseId);
    }
  }

  cancel(): void {
    this.transition('cancelled');
    this.recordEvent({ type: 'pipeline:cancelled', timestamp: Date.now() });
    for (const [, resolver] of this.gateResolvers) {
      resolver(false, 'Pipeline cancelled');
    }
    this.gateResolvers.clear();
  }

  getState(): Readonly<PipelineState> {
    return this.state;
  }

  private async executeLoop(): Promise<void> {
    while (this.state.status === 'running') {
      const ready = computeReadySet(this.definition.phases, this.state.phases);

      if (ready.length === 0) {
        const hasRunning = [...this.state.phases.values()].some((p) => p.status === 'running');
        if (!hasRunning) break;
        await this.waitForCompletion();
        continue;
      }

      const executions = ready.map((phase) => this.executePhase(phase));
      await Promise.all(executions);
    }
  }

  private async executePhase(phase: PhaseDefinition): Promise<void> {
    if (phase.type === 'gate') {
      await this.executeGate(phase);
      return;
    }

    this.setPhaseStatus(phase.id, 'running');
    this.recordEvent({ type: 'phase:started', timestamp: Date.now(), phaseId: phase.id });

    try {
      const context: ExecutionContext = {
        pipelineId: this.state.id,
        dependencyResults: this.gatherDependencyResults(phase),
      };

      const result = await this.executor.execute(phase, context);

      this.setPhaseStatus(phase.id, 'completed');
      const phaseState = this.state.phases.get(phase.id)!;
      phaseState.result = result;
      phaseState.completedAt = Date.now();
      this.recordEvent({ type: 'phase:completed', timestamp: Date.now(), phaseId: phase.id, result });
    } catch (err) {
      this.setPhaseStatus(phase.id, 'failed');
      const phaseState = this.state.phases.get(phase.id)!;
      phaseState.error = String(err);
      this.recordEvent({ type: 'phase:failed', timestamp: Date.now(), phaseId: phase.id, error: String(err) });
    }
  }

  private async executeGate(phase: PhaseDefinition): Promise<void> {
    this.setPhaseStatus(phase.id, 'waiting_approval');
    this.recordEvent({
      type: 'gate:waiting', timestamp: Date.now(),
      phaseId: phase.id, message: phase.gateMessage || 'Approval required',
    });

    this.transition('paused');
    this.recordEvent({ type: 'pipeline:paused', timestamp: Date.now(), phaseId: phase.id });

    const approved = await new Promise<boolean>((resolve) => {
      this.gateResolvers.set(phase.id, (ok, reason) => {
        if (ok) {
          this.recordEvent({ type: 'gate:approved', timestamp: Date.now(), phaseId: phase.id });
        } else {
          this.recordEvent({ type: 'gate:rejected', timestamp: Date.now(), phaseId: phase.id, reason });
        }
        resolve(ok);
      });
      this.emit('gate', { phaseId: phase.id, message: phase.gateMessage });
    });

    if (approved) {
      this.setPhaseStatus(phase.id, 'completed');
      this.transition('running');
      this.recordEvent({ type: 'pipeline:resumed', timestamp: Date.now(), phaseId: phase.id });
    } else {
      this.setPhaseStatus(phase.id, 'failed');
      this.transition('failed');
    }
  }

  private gatherDependencyResults(phase: PhaseDefinition): Map<string, unknown> {
    const results = new Map<string, unknown>();
    for (const depId of phase.dependsOn) {
      const depState = this.state.phases.get(depId);
      if (depState?.result !== undefined) {
        results.set(depId, depState.result);
      }
    }
    return results;
  }

  private setPhaseStatus(phaseId: string, status: PhaseState['status']): void {
    const phase = this.state.phases.get(phaseId);
    if (phase) {
      phase.status = status;
      if (status === 'running') phase.startedAt = Date.now();
    }
    this.emit('phase:status', { phaseId, status });
  }

  private transition(status: PipelineState['status']): void {
    this.state.status = status;
    this.emit('status', status);
  }

  private recordEvent(event: PipelineEvent): void {
    this.state.events.push(event);
    this.emit('event', event);
  }

  private waitForCompletion(): Promise<void> {
    return new Promise((resolve) => {
      const handler = () => { resolve(); this.removeListener('phase:status', handler); };
      this.on('phase:status', handler);
    });
  }
}
