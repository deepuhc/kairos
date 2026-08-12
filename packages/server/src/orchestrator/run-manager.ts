import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import type { SmartRouter } from '@kairos/providers';
import type { Message } from '@kairos/providers';
import { Coordinator, type CoordinatorEvent, type RoleRunContext } from './coordinator.js';
import { AgentWatchdog } from './watchdog.js';
import type { OrchestratorState } from './state.js';

// Production glue that turns the pure Coordinator into a live server run: it
// supplies the real side-effecting seams the coordinator abstracts over.
//
//   • executeRole — runs one persona as a router-backed completion, streaming the
//     reply and writing the role's artifact to disk. Each attempt is guarded by an
//     AgentWatchdog: stream chunks are heartbeats, and if the watchdog trips
//     (stalled/timeout) we abort so the coordinator retries or blocks — the
//     autonomy guarantee, mechanized. A per-chunk heartbeat carries a fingerprint
//     (running output length) so a looping agent is caught as a soft stall.
//   • readArtifact — reads the deliverable from the project dir for the gate.
//   • emit — republishes every coordinator lifecycle event on the /events bus as
//     `orchestrator:update`, so the activity view updates live. On a stall/timeout
//     it also emits an `_ext/stalled`-shaped signal the UI already understands.
//
// Only ONE run at a time (a single external coding agent); starting a new run
// while one is active is rejected by the caller (the REST route).

export interface OrchestratorEventSink {
  publish(event: string, data?: unknown): void;
}

export interface RunManagerOptions {
  router: SmartRouter;
  events: OrchestratorEventSink;
  /** Per-attempt + overall timeouts for the watchdog (defaults in AgentWatchdog). */
  watchdog?: {
    heartbeatTimeoutMs?: number;
    startToCloseMs?: number;
    scheduleToCloseMs?: number;
  };
}

export class RunManager {
  private active: Coordinator | null = null;

  constructor(private opts: RunManagerOptions) {}

  get isRunning(): boolean {
    return this.active !== null;
  }

  /** Start an autonomous run for `goal` in `projectDir`. Rejects if one is active.
   *  Resolves when the run reaches a terminal state (done/blocked). */
  async start(goal: string, projectDir: string): Promise<OrchestratorState> {
    if (this.active) throw new Error('An orchestrator run is already active');

    const coordinator = new Coordinator({
      goal,
      projectDir,
      executeRole: (ctx) => this.executeRole(ctx),
      readArtifact: (path) => this.readArtifact(projectDir, path),
      emit: (event) => this.onEvent(event),
    });
    this.active = coordinator;
    try {
      return await coordinator.run();
    } finally {
      this.active = null;
    }
  }

  // Run one persona to produce its artifact, guarded by a liveness watchdog. The
  // router streams the reply; each chunk is a heartbeat. If the watchdog trips we
  // abort the attempt (reject) so the coordinator retries from a clean attempt or
  // blocks after maxAttempts — we never hang on a silent agent.
  private async executeRole(ctx: RoleRunContext): Promise<void> {
    const watchdog = new AgentWatchdog({
      heartbeatTimeoutMs: this.opts.watchdog?.heartbeatTimeoutMs,
      startToCloseMs: this.opts.watchdog?.startToCloseMs,
      scheduleToCloseMs: this.opts.watchdog?.scheduleToCloseMs,
    });

    const upstream = await this.readUpstream(ctx.projectDir, ctx.upstreamArtifacts);
    const messages: Message[] = [
      { role: 'system', content: ctx.role.systemPrompt },
      {
        role: 'user',
        content:
          `Produce your deliverable for this goal and write it to ${ctx.role.artifact.path}.\n\n` +
          (upstream ? `Upstream artifacts:\n\n${upstream}\n\n` : '') +
          `Respond with the full Markdown contents of ${ctx.role.artifact.path}.`,
      },
    ];

    const controller = new AbortController();
    let output = '';
    const stream = this.opts.router.streamChunks(messages, { signal: controller.signal });

    for await (const chunk of stream) {
      // A watchdog trip mid-stream ends the attempt; the coordinator decides retry
      // vs. block. runCheck() is cheap and driven here on every chunk boundary.
      const verdict = watchdog.runCheck();
      if (verdict === 'stalled' || verdict === 'timeout') {
        controller.abort();
        this.emitStalled(ctx.role.id, watchdog.idleMs());
        throw new Error(`watchdog: ${verdict} (idle ${Math.round(watchdog.idleMs() / 1000)}s)`);
      }
      if (chunk.type === 'text') {
        output += chunk.text;
        // Fingerprint = running length; unchanged across sweeps ⇒ soft stall.
        watchdog.heartbeat(String(output.length));
        ctx.heartbeat(String(output.length));
      } else if (chunk.type === 'thinking' || chunk.type === 'usage') {
        watchdog.heartbeat();
        ctx.heartbeat();
      } else if (chunk.type === 'error') {
        throw new Error(chunk.message);
      }
    }
    watchdog.finish();

    await this.writeArtifact(ctx.projectDir, ctx.role.artifact.path, output);
  }

  private resolveInProject(projectDir: string, relPath: string): string {
    return isAbsolute(relPath) ? relPath : join(projectDir, relPath);
  }

  private async readArtifact(projectDir: string, relPath: string): Promise<string | null> {
    try {
      return await readFile(this.resolveInProject(projectDir, relPath), 'utf8');
    } catch {
      return null;
    }
  }

  private async writeArtifact(projectDir: string, relPath: string, contents: string): Promise<void> {
    const abs = this.resolveInProject(projectDir, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents, 'utf8');
  }

  private async readUpstream(projectDir: string, paths: string[]): Promise<string> {
    const parts: string[] = [];
    for (const p of paths) {
      const contents = await this.readArtifact(projectDir, p);
      if (contents) parts.push(`### ${p}\n\n${contents}`);
    }
    return parts.join('\n\n');
  }

  private onEvent(event: CoordinatorEvent): void {
    this.opts.events.publish('orchestrator:update', {
      type: event.type,
      role: event.role,
      detail: event.detail,
      state: event.state,
    });
  }

  // The `_ext/stalled`-shaped signal the UI's ACP layer already renders. Emitted
  // over the same one-way bus so the activity view can flag a stuck persona.
  private emitStalled(role: string, idleMs: number): void {
    this.opts.events.publish('orchestrator:stalled', {
      role,
      secondsIdle: Math.round(idleMs / 1000),
    });
  }
}
