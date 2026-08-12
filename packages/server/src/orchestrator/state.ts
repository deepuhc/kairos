import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRoleId } from '@kairos/personas';
import { kairosPath, atomicWrite, createSerializedMutator } from '../kairos-home.js';

// The orchestrator's durable, machine-readable run state — the "blackboard" the
// autonomous coordinator reads/writes and the activity view (Item 5) renders.
// It lives next to session-overrides.json in the one Kairos home so there's a
// single state directory (KAIROS_HOME-overridable), written atomically through
// the same serialized mutate queue.
//
// DUAL-WRITE logging (the Program Manager's discipline, mechanized): every state
// transition updates BOTH
//   • .kairos/orchestrator-state.json  — the machine state (this file), and
//   • <project>/PROGRESS.md            — a human-readable, append-only ledger.
// The machine file is the source of truth the code reads back; PROGRESS.md is
// the auditable narrative a human (or the Program Manager persona) reviews.
//
// logEvent() writes the LEDGER FIRST, then commits the state transition. These
// are two files, not one transaction, so they can't be made truly atomic — but
// ordering ledger-before-state makes the failure modes safe:
//   • If the ledger append fails, state never advances (fn didn't run), so a full
//     logEvent() retry re-runs fn exactly once — no double-applied transition.
//   • If the process dies between the two writes, the worst case is a ledger line
//     with no matching state advance (an over-log), never a silent state advance
//     with a missing audit line. The source of truth is never ahead of the audit.

export type PhaseStatus =
  | 'pending' // upstream deps not yet satisfied
  | 'ready' // eligible to start
  | 'running' // agent is actively working
  | 'blocked' // stalled/timed-out or a gate failed; needs a decision
  | 'done'; // artifact produced and validated

export type RunStatus = 'idle' | 'running' | 'blocked' | 'done' | 'failed';

/** Liveness verdict mirrored from the watchdog for the activity view. */
export type Liveness = 'ok' | 'soft-stall' | 'stalled' | 'timeout';

export interface PhaseState {
  role: AgentRoleId;
  status: PhaseStatus;
  /** ACP session id backing this phase's agent, when running. */
  sessionId?: string;
  /** Repo-relative artifact path this phase owns. */
  artifact: string;
  /** Epoch ms of the last observed sign of progress (heartbeat). */
  lastActivityAt?: number;
  /** Latest watchdog verdict; absent until the phase runs. */
  liveness?: Liveness;
  /** How many attempts have been started (retries from a stall). */
  attempts: number;
  /** Populated on 'blocked' — the reason + the decision the human/PM needs. */
  blockedReason?: string;
}

export interface OrchestratorState {
  /** Stable id for this run (also the state file is per-run-overwritable). */
  runId: string;
  /** The project goal the team is building toward. */
  goal: string;
  status: RunStatus;
  /** Ordered phases (pipeline order); the DAG lives in @kairos/personas. */
  phases: PhaseState[];
  startedAt: number;
  updatedAt: number;
  /** Monotonic sequence so the UI can detect it missed an update. */
  seq: number;
}

const STATE_FILE = 'orchestrator-state.json';

function statePath(): string {
  return kairosPath(STATE_FILE);
}

function emptyState(): OrchestratorState {
  const t = Date.now();
  return { runId: '', goal: '', status: 'idle', phases: [], startedAt: t, updatedAt: t, seq: 0 };
}

/** Read the machine state, tolerating a missing/malformed file. */
export async function readState(): Promise<OrchestratorState> {
  try {
    const raw = await readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<OrchestratorState>;
    return {
      ...emptyState(),
      ...parsed,
      phases: Array.isArray(parsed.phases) ? (parsed.phases as PhaseState[]) : [],
    };
  } catch {
    return emptyState();
  }
}

export async function writeState(next: OrchestratorState): Promise<void> {
  await atomicWrite(statePath(), JSON.stringify(next, null, 2));
}

const mutate = createSerializedMutator<OrchestratorState>(readState, writeState);

/** Serialized read-modify-write over the machine state. Bumps seq + updatedAt. */
export function mutateState(
  fn: (s: OrchestratorState) => OrchestratorState,
): Promise<OrchestratorState> {
  return mutate((s) => {
    const next = fn(s);
    return { ...next, seq: s.seq + 1, updatedAt: Date.now() };
  });
}

// --- PROGRESS.md ledger (the human-readable half of the dual write) ---

/** Format one ledger line. Exported so it's unit-testable without touching disk. */
export function formatLedgerLine(now: Date, message: string): string {
  // ISO minute precision keeps the ledger scannable without second-level noise.
  const ts = now.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z').replace('T', ' ');
  return `- ${ts} ${message}`;
}

const LEDGER_HEADER = '## Orchestrator run log';

/**
 * Append a line to the project's PROGRESS.md under the run-log section, creating
 * the file/section if absent. Serialized through its own queue so concurrent
 * appends can't interleave. `projectDir` is the workspace root the run targets.
 */
const ledgerQueues = new Map<string, Promise<unknown>>();
export function appendLedger(projectDir: string, message: string, now: Date = new Date()): Promise<void> {
  const path = join(projectDir, 'PROGRESS.md');
  const run = async (): Promise<void> => {
    let existing = '';
    try {
      existing = await readFile(path, 'utf8');
    } catch {
      existing = '';
    }
    const line = formatLedgerLine(now, message);
    let next: string;
    if (!existing.includes(LEDGER_HEADER)) {
      const prefix = existing ? existing.replace(/\n*$/, '\n\n') : '';
      next = `${prefix}${LEDGER_HEADER}\n\n${line}\n`;
    } else {
      next = existing.replace(/\n*$/, '\n') + `${line}\n`;
    }
    await atomicWrite(path, next);
  };
  const prev = ledgerQueues.get(path) ?? Promise.resolve();
  const result = prev.then(run, run);
  ledgerQueues.set(path, result.catch(() => undefined));
  return result;
}

/**
 * The dual write: append the human ledger line, THEN commit the state transition.
 * Ledger-first ordering (see the module header) keeps the source-of-truth state
 * from ever running ahead of the audit narrative, and makes a retry after a
 * ledger failure safe (fn hasn't run yet). Returns the new state.
 */
export async function logEvent(
  projectDir: string,
  message: string,
  fn: (s: OrchestratorState) => OrchestratorState,
): Promise<OrchestratorState> {
  await appendLedger(projectDir, message);
  return mutateState(fn);
}
