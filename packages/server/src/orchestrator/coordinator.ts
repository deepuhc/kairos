import {
  AGENT_ROLES,
  DEFAULT_PIPELINE_ROLES,
  getAgentRole,
  nextEligibleRoles,
  validateArtifact,
  type AgentRole,
  type AgentRoleId,
} from '@kairos/personas';
import { logEvent, type OrchestratorState, type PhaseState } from './state.js';

// The autonomous delivery coordinator: a DAG-walking supervisor that drives the
// persona pipeline (product-marketing → … → docs-engineer) to completion with no
// human in the loop, per the orchestrator design. It ties together the four
// foundations already landed:
//   • the persona DAG (@kairos/personas) — what may run and in what order,
//   • artifact contracts — the gate that must pass before a phase counts done,
//   • the dual-write state store (state.ts) — machine state + PROGRESS.md ledger,
//   • (in the wiring layer) the AgentWatchdog — liveness/timeout while a phase runs.
//
// Everything the coordinator touches beyond pure logic is an INJECTED seam, so
// the whole run is unit-testable with no ACP session, no Claude Code process, and
// no real clock:
//   • executeRole — run one role's agent to produce its artifact (in production:
//       an ACP session against Claude Code; in tests: a fake that writes files).
//   • readArtifact — read an artifact's on-disk contents for gate validation.
//   • emit — publish a lifecycle event (wired to the /events bus + `_ext/stalled`).
//   • now — clock.
//
// The coordinator never asks a human: an artifact that won't validate after
// maxAttempts, or a role that keeps throwing, moves that phase to `blocked` with
// a concrete reason (surfaced in state + ledger + an `_ext/stalled`-style event)
// rather than stalling silently — the prime directive.

export interface RoleRunContext {
  role: AgentRole;
  /** Repo-relative artifact paths of completed upstream roles, for the agent to read. */
  upstreamArtifacts: string[];
  /** The workspace the agent operates in. */
  projectDir: string;
  /** Call on any sign of progress; `fingerprint` lets the watchdog detect loops. */
  heartbeat: (fingerprint?: string) => void;
}

/** Runs one role's agent to produce (write to disk) its artifact. Resolves when
 *  the agent reports done; rejects if the attempt fails/stalls/times out. */
export type RoleExecutor = (ctx: RoleRunContext) => Promise<void>;

export interface CoordinatorEvent {
  type:
    | 'run:started'
    | 'phase:running'
    | 'phase:done'
    | 'phase:retry'
    | 'phase:blocked'
    | 'run:done'
    | 'run:blocked';
  role?: AgentRoleId;
  detail?: string;
  /** The full state snapshot at this event (for the activity view). */
  state: OrchestratorState;
}

export interface CoordinatorOptions {
  goal: string;
  projectDir: string;
  executeRole: RoleExecutor;
  /** Read an artifact's contents; return null when the file is absent. */
  readArtifact: (path: string) => Promise<string | null>;
  /** Publish a lifecycle event (wired to the /events bus). */
  emit?: (event: CoordinatorEvent) => void;
  /** Max attempts per phase before it's marked blocked (default 3). */
  maxAttemptsPerPhase?: number;
  /** Ordered pipeline roles (default: the standard SOP pipeline). */
  roles?: AgentRoleId[];
  now?: () => number;
}

function initialPhases(roleIds: AgentRoleId[]): PhaseState[] {
  return roleIds.map((id) => {
    const role = getAgentRole(id)!;
    return {
      role: id,
      status: role.dependsOn.length === 0 ? 'ready' : 'pending',
      artifact: role.artifact.path,
      attempts: 0,
    };
  });
}

export class Coordinator {
  private readonly goal: string;
  private readonly projectDir: string;
  private readonly executeRole: RoleExecutor;
  private readonly readArtifact: (path: string) => Promise<string | null>;
  private readonly emit: (event: CoordinatorEvent) => void;
  private readonly maxAttempts: number;
  private readonly roleIds: AgentRoleId[];
  private readonly now: () => number;

  private state: OrchestratorState;

  constructor(options: CoordinatorOptions) {
    this.goal = options.goal;
    this.projectDir = options.projectDir;
    this.executeRole = options.executeRole;
    this.readArtifact = options.readArtifact;
    this.emit = options.emit ?? (() => {});
    this.maxAttempts = options.maxAttemptsPerPhase ?? 3;
    this.roleIds = options.roles ?? DEFAULT_PIPELINE_ROLES;
    this.now = options.now ?? (() => Date.now());

    const t = this.now();
    this.state = {
      runId: `run_${t}`,
      goal: this.goal,
      status: 'idle',
      phases: initialPhases(this.roleIds),
      startedAt: t,
      updatedAt: t,
      seq: 0,
    };
  }

  // A clone, so a caller reading mid-run can't observe in-place heartbeat mutations.
  getState(): Readonly<OrchestratorState> {
    return structuredClone(this.state);
  }

  /** Drive the pipeline to a terminal state (done or blocked). Never throws for a
   *  phase failure — a phase that can't be completed is recorded as blocked. */
  async run(): Promise<OrchestratorState> {
    await this.commit('run:started', undefined, `run started: ${this.goal}`, (s) => ({
      ...s,
      status: 'running',
    }));

    // Walk the DAG: run each newly-eligible role to its artifact gate. The SOP
    // pipeline is a chain, but nextEligibleRoles() supports fan-out too — we run
    // the eligible set sequentially here (a single external coding agent) and
    // re-derive eligibility after each, so a blocked phase stops its dependents.
    for (;;) {
      const completed = this.completedRoleIds();
      const eligible = nextEligibleRoles(completed).filter((id) => this.isRunnable(id));
      if (eligible.length === 0) break;

      const roleId = eligible[0];
      const ok = await this.runPhaseToGate(roleId);
      if (!ok) break; // phase blocked → its dependents can never become eligible
    }

    // The loop above breaks when no phase is eligible. Besides done/blocked that
    // can leave phases STRANDED at pending/ready with no path forward — a
    // misconfigured `roles` subset that omits a dependency, or a supervisor role
    // (never eligible via nextEligibleRoles). Rather than return a non-terminal
    // `running` run (a silent stall — the prime-directive violation), mark every
    // unresolved phase blocked with a deadlock reason so the run always ends.
    const stranded = this.state.phases.filter((p) => p.status !== 'done' && p.status !== 'blocked');
    for (const phase of stranded) {
      const role = getAgentRole(phase.role)!;
      const missing = role.dependsOn.filter((dep) => !this.completedRoleIds().has(dep));
      const reason = missing.length
        ? `deadlock: unsatisfiable dependency (${missing.join(', ')} never completed)`
        : 'deadlock: phase never became eligible';
      await this.commit('phase:blocked', phase.role, `${role.name} blocked — ${reason}`, (s) =>
        this.patchPhase(s, phase.role, { status: 'blocked', liveness: 'stalled', blockedReason: reason }),
      );
    }

    const anyBlocked = this.state.phases.some((p) => p.status === 'blocked');
    const allDone = this.state.phases.every((p) => p.status === 'done');
    if (anyBlocked) {
      const blocked = this.state.phases.filter((p) => p.status === 'blocked').map((p) => p.role);
      await this.commit('run:blocked', undefined, `run blocked: ${blocked.join(', ')} need a decision`, (s) => ({
        ...s,
        status: 'blocked',
      }));
    } else if (allDone) {
      await this.commit('run:done', undefined, 'run complete: all artifacts produced and validated', (s) => ({
        ...s,
        status: 'done',
      }));
    }
    return this.state;
  }

  // Run one role's agent, retrying on failure or a failed artifact gate, until it
  // validates or exhausts maxAttempts (→ blocked). Returns true iff it reached done.
  private async runPhaseToGate(roleId: AgentRoleId): Promise<boolean> {
    const role = getAgentRole(roleId)!;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.commit('phase:running', roleId, `${role.name} → running (attempt ${attempt})`, (s) =>
        this.patchPhase(s, roleId, { status: 'running', attempts: attempt, lastActivityAt: this.now(), liveness: 'ok' }),
      );

      let failure: string | null = null;
      try {
        await this.executeRole({
          role,
          upstreamArtifacts: this.upstreamArtifactPaths(role),
          projectDir: this.projectDir,
          heartbeat: (fingerprint) => this.onHeartbeat(roleId, fingerprint),
        });
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }

      if (!failure) {
        // Artifact gate: the deliverable must exist on disk and satisfy its contract.
        const contents = await this.readArtifact(role.artifact.path);
        const check = validateArtifact(role, contents);
        if (check.ok) {
          await this.commit('phase:done', roleId, `${role.name} → done (${role.artifact.path})`, (s) =>
            this.patchPhase(s, roleId, { status: 'done', lastActivityAt: this.now(), liveness: 'ok' }),
          );
          return true;
        }
        failure = check.reason ?? 'artifact failed validation';
      }

      if (attempt < this.maxAttempts) {
        await this.commit('phase:retry', roleId, `${role.name} attempt ${attempt} failed: ${failure} — retrying`, (s) =>
          this.patchPhase(s, roleId, { status: 'ready', liveness: 'soft-stall' }),
        );
      } else {
        await this.commit('phase:blocked', roleId, `${role.name} blocked after ${this.maxAttempts} attempts: ${failure}`, (s) =>
          this.patchPhase(s, roleId, { status: 'blocked', liveness: 'stalled', blockedReason: failure! }),
        );
        return false;
      }
    }
    return false;
  }

  private onHeartbeat(roleId: AgentRoleId, _fingerprint?: string): void {
    // Liveness only touches the in-memory snapshot on the hot path (heartbeats can
    // be frequent); the durable state advances on phase transitions via commit().
    const phase = this.state.phases.find((p) => p.role === roleId);
    if (phase) {
      phase.lastActivityAt = this.now();
      phase.liveness = 'ok';
    }
  }

  private completedRoleIds(): Set<AgentRoleId> {
    return new Set(this.state.phases.filter((p) => p.status === 'done').map((p) => p.role));
  }

  // A role is runnable if it's in this run and not already resolved (done/blocked).
  private isRunnable(roleId: AgentRoleId): boolean {
    const phase = this.state.phases.find((p) => p.role === roleId);
    return !!phase && phase.status !== 'done' && phase.status !== 'blocked';
  }

  private upstreamArtifactPaths(role: AgentRole): string[] {
    return role.dependsOn
      .map((dep) => AGENT_ROLES.find((r) => r.id === dep)?.artifact.path)
      .filter((p): p is string => !!p);
  }

  private patchPhase(
    s: OrchestratorState,
    roleId: AgentRoleId,
    patch: Partial<PhaseState>,
  ): OrchestratorState {
    return {
      ...s,
      phases: s.phases.map((p) => (p.role === roleId ? { ...p, ...patch } : p)),
    };
  }

  // Apply a state transition (dual-write to machine state + PROGRESS.md) and emit
  // the matching lifecycle event with the fresh snapshot.
  //
  // The coordinator is the SOLE authoritative writer of orchestrator-state.json
  // (the watchdog is pure/in-memory; the REST routes are read-only), so overlaying
  // the in-memory `this.state` over the disk read `s` is safe — it can't lose a
  // concurrent writer's content because there isn't one. mutateState still
  // re-derives seq/updatedAt from the disk read after fn, so those stay monotonic
  // even though `this.state` carries a stale seq. The emitted snapshot is a clone
  // so a retained event can't be retroactively mutated by a later heartbeat.
  private async commit(
    type: CoordinatorEvent['type'],
    role: AgentRoleId | undefined,
    ledgerMessage: string,
    fn: (s: OrchestratorState) => OrchestratorState,
  ): Promise<void> {
    this.state = await logEvent(this.projectDir, ledgerMessage, (s) => fn({ ...s, ...this.state }));
    this.emit({ type, role, detail: ledgerMessage, state: structuredClone(this.state) });
  }
}
