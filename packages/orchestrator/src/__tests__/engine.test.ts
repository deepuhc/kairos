import { describe, it, expect, vi } from 'vitest';
import { PipelineEngine } from '../engine.js';
import type {
  PipelineDefinition, PhaseDefinition, PhaseExecutor, ExecutionContext,
} from '../types.js';

function phase(id: string, dependsOn: string[] = [], extra: Partial<PhaseDefinition> = {}): PhaseDefinition {
  return { id, type: 'agent', dependsOn, ...extra };
}

function pipeline(phases: PhaseDefinition[]): PipelineDefinition {
  return { id: 'def', name: 'test', phases };
}

// An executor that echoes a per-phase result and records call order + the
// dependency results it was handed, so we can assert data flow through the DAG.
class RecordingExecutor implements PhaseExecutor {
  calls: Array<{ id: string; deps: Record<string, unknown> }> = [];
  constructor(private results: Record<string, unknown> = {}) {}
  async execute(phase: PhaseDefinition, ctx: ExecutionContext): Promise<unknown> {
    this.calls.push({ id: phase.id, deps: Object.fromEntries(ctx.dependencyResults) });
    return this.results[phase.id] ?? `result:${phase.id}`;
  }
}

describe('PipelineEngine — happy path', () => {
  it('runs a linear pipeline to completion with all phases completed', async () => {
    const engine = new PipelineEngine(
      pipeline([phase('a'), phase('b', ['a']), phase('c', ['b'])]),
      new RecordingExecutor(),
    );
    const state = await engine.run();
    expect(state.status).toBe('completed');
    expect([...state.phases.values()].map((p) => p.status)).toEqual(['completed', 'completed', 'completed']);
  });

  it('emits pipeline:started then pipeline:completed', async () => {
    const engine = new PipelineEngine(pipeline([phase('a')]), new RecordingExecutor());
    const state = await engine.run();
    const types = state.events.map((e) => e.type);
    expect(types[0]).toBe('pipeline:started');
    expect(types).toContain('phase:completed');
    expect(types[types.length - 1]).toBe('pipeline:completed');
  });

  it('passes completed dependency results into the dependent phase executor', async () => {
    const exec = new RecordingExecutor({ a: 'A-OUT' });
    const engine = new PipelineEngine(pipeline([phase('a'), phase('b', ['a'])]), exec);
    await engine.run();
    const bCall = exec.calls.find((c) => c.id === 'b')!;
    expect(bCall.deps).toEqual({ a: 'A-OUT' });
  });

  it('rejects an invalid pipeline (cycle) before running', async () => {
    const engine = new PipelineEngine(
      pipeline([phase('a', ['b']), phase('b', ['a'])]),
      new RecordingExecutor(),
    );
    await expect(engine.run()).rejects.toThrow(/Invalid pipeline/);
  });
});

describe('PipelineEngine — gates', () => {
  it('pauses at a gate and resumes to completion when approved', async () => {
    const engine = new PipelineEngine(
      pipeline([phase('g', [], { type: 'gate', gateMessage: 'ok?' }), phase('after', ['g'])]),
      new RecordingExecutor(),
    );
    const gateSeen = vi.fn();
    engine.on('gate', gateSeen);

    const runPromise = engine.run();
    // Let the engine reach the gate and pause.
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.getState().status).toBe('paused');
    expect(gateSeen).toHaveBeenCalledWith(expect.objectContaining({ phaseId: 'g' }));

    engine.approveGate('g', true);
    const state = await runPromise;
    expect(state.status).toBe('completed');
    expect(state.phases.get('g')!.status).toBe('completed');
    expect(state.phases.get('after')!.status).toBe('completed');
  });

  it('fails the pipeline when a gate is rejected', async () => {
    const engine = new PipelineEngine(
      pipeline([phase('g', [], { type: 'gate' })]),
      new RecordingExecutor(),
    );
    const runPromise = engine.run();
    await new Promise((r) => setTimeout(r, 10));
    engine.approveGate('g', false, 'nope');
    const state = await runPromise;
    expect(state.status).toBe('failed');
    expect(state.phases.get('g')!.status).toBe('failed');
    const rejected = state.events.find((e) => e.type === 'gate:rejected');
    expect(rejected).toMatchObject({ phaseId: 'g', reason: 'nope' });
  });
});

describe('PipelineEngine — cancel', () => {
  it('ends in the cancelled state when cancelled at a gate', async () => {
    const engine = new PipelineEngine(
      pipeline([phase('g', [], { type: 'gate' })]),
      new RecordingExecutor(),
    );
    const runPromise = engine.run();
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.getState().status).toBe('paused');

    engine.cancel();
    const state = await runPromise;

    // Regression: cancel() resolves the pending gate with false, but the gate's
    // rejection branch must NOT clobber the terminal 'cancelled' state with
    // 'failed'. The gate phase itself is marked failed; the pipeline is cancelled.
    expect(state.status).toBe('cancelled');
    expect(state.phases.get('g')!.status).toBe('failed');
    expect(state.events.some((e) => e.type === 'pipeline:cancelled')).toBe(true);
  });

  it('cancels a purely idle/running pipeline to the cancelled state', async () => {
    // With no gate to reach, cancel() before any terminal transition leaves the
    // status at 'cancelled' (no rejection branch to clobber it).
    const engine = new PipelineEngine(pipeline([phase('a', [], { type: 'gate' })]), new RecordingExecutor());
    engine.cancel();
    expect(engine.getState().status).toBe('cancelled');
    expect(engine.getState().events.some((e) => e.type === 'pipeline:cancelled')).toBe(true);
  });
});

describe('PipelineEngine — failure handling', () => {
  // Regression for arch review #8: when a phase fails, executePhase catches the
  // error internally and the loop drains (dependents can never become ready).
  // run() must then terminate the pipeline as 'failed' rather than leaving it
  // stuck at 'running'.
  it('terminates the pipeline as failed when a phase throws', async () => {
    const exec: PhaseExecutor = {
      execute: async (p) => { if (p.id === 'a') throw new Error('boom'); return 'ok'; },
    };
    const engine = new PipelineEngine(pipeline([phase('a'), phase('b', ['a'])]), exec);
    const state = await engine.run();

    expect(state.phases.get('a')!.status).toBe('failed');
    // b never runs — its dependency didn't complete.
    expect(state.phases.get('b')!.status).toBe('pending');
    // Fixed: the pipeline reaches a terminal 'failed' state and records it.
    expect(state.status).toBe('failed');
    expect(state.events.some((e) => e.type === 'phase:failed')).toBe(true);
    const pipelineFailed = state.events.find((e) => e.type === 'pipeline:failed');
    expect(pipelineFailed).toMatchObject({ type: 'pipeline:failed' });
    expect((pipelineFailed as { error: string }).error).toMatch(/a/);
  });

  it('still completes normally when no phase fails', async () => {
    const engine = new PipelineEngine(pipeline([phase('a'), phase('b', ['a'])]), new RecordingExecutor());
    const state = await engine.run();
    expect(state.status).toBe('completed');
  });
});
