// Liveness watchdog for an autonomously-running agent phase.
//
// The key ACP insight (see the orchestrator design): DON'T poke the agent —
// WATCH FOR SILENCE. Any ACP session/update notification (agent_message_chunk,
// tool_call, tool_call_update, plan, usage_update) counts as a heartbeat. This
// mirrors ConnectionMonitor's injectable-timer shape (acp/connection-monitor.ts)
// so tests drive `runCheck()` deterministically instead of waiting on the clock.
//
// Layered timeouts (Temporal's activity model):
//   • heartbeat  — max gap between signs of progress; miss ⇒ presumed stalled.
//   • startToClose — caps a single attempt's wall-clock (silent-hang net).
//   • scheduleToClose — bounds the whole task across retries.
// Plus a progress FINGERPRINT: if the latest tool-call id / files-touched hash
// is unchanged across N sweeps, the agent is looping (SOFT stall) even though
// updates keep arriving.
//
// Escalation ladder returned by runCheck():
//   'ok'          — healthy, progressing.
//   'soft-stall'  — updates arrive but no real progress; steer with a nudge.
//   'stalled'     — heartbeat gap exceeded; cancel + retry from checkpoint.
//   'timeout'     — start-to-close or schedule-to-close exceeded; mark blocked.

export type WatchdogVerdict = 'ok' | 'soft-stall' | 'stalled' | 'timeout';

export interface WatchdogOptions {
  /** Max ms between heartbeats before 'stalled' (default 3 min — the brief's probe cadence). */
  heartbeatTimeoutMs?: number;
  /** Max ms for a single attempt before 'timeout' (default 30 min). */
  startToCloseMs?: number;
  /** Max ms for the whole task across retries before 'timeout' (default 2 h). */
  scheduleToCloseMs?: number;
  /** Consecutive unchanged-fingerprint sweeps that count as a soft stall (default 3). */
  softStallSweeps?: number;
  /** Injectable clock (defaults to Date.now) — tests advance it explicitly. */
  now?: () => number;
}

const MIN = 60_000;

export class AgentWatchdog {
  private readonly heartbeatTimeoutMs: number;
  private readonly startToCloseMs: number;
  private readonly scheduleToCloseMs: number;
  private readonly softStallSweeps: number;
  private readonly now: () => number;

  private readonly scheduledAt: number;
  private startedAt: number;
  private lastHeartbeat: number;
  private lastFingerprint = '';
  private unchangedSweeps = 0;
  private done = false;

  constructor(options: WatchdogOptions = {}) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 3 * MIN;
    this.startToCloseMs = options.startToCloseMs ?? 30 * MIN;
    this.scheduleToCloseMs = options.scheduleToCloseMs ?? 120 * MIN;
    this.softStallSweeps = options.softStallSweeps ?? 3;
    this.now = options.now ?? (() => Date.now());
    const t = this.now();
    this.scheduledAt = t;
    this.startedAt = t;
    this.lastHeartbeat = t;
  }

  /** Record any sign of progress. `fingerprint` is a hash of the latest tool-call
   *  ids / files touched — pass '' or omit if unavailable (liveness only). */
  heartbeat(fingerprint = ''): void {
    this.lastHeartbeat = this.now();
    if (fingerprint && fingerprint === this.lastFingerprint) {
      this.unchangedSweeps++;
    } else {
      this.unchangedSweeps = 0;
      this.lastFingerprint = fingerprint;
    }
  }

  /** Reset the per-attempt clock and heartbeat for a retry (keeps the overall
   *  schedule-to-close deadline running). */
  restartAttempt(): void {
    const t = this.now();
    this.startedAt = t;
    this.lastHeartbeat = t;
    this.lastFingerprint = '';
    this.unchangedSweeps = 0;
  }

  /** Mark the phase finished so further checks are inert. */
  finish(): void {
    this.done = true;
  }

  /** Ms since the last heartbeat — surfaced in `_ext/stalled` and the activity view. */
  idleMs(): number {
    return this.now() - this.lastHeartbeat;
  }

  get lastHeartbeatAt(): number {
    return this.lastHeartbeat;
  }

  /**
   * One watchdog tick. Ordering matters: hard timeouts (which end the task) are
   * checked before the heartbeat gap (retryable) before the soft stall (a
   * nudge), so the most severe applicable verdict wins.
   */
  runCheck(): WatchdogVerdict {
    if (this.done) return 'ok';
    const t = this.now();

    if (t - this.scheduledAt >= this.scheduleToCloseMs) return 'timeout';
    if (t - this.startedAt >= this.startToCloseMs) return 'timeout';
    if (t - this.lastHeartbeat >= this.heartbeatTimeoutMs) return 'stalled';
    if (this.unchangedSweeps >= this.softStallSweeps) return 'soft-stall';
    return 'ok';
  }
}
