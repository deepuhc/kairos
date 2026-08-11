// Liveness + backpressure guard for a long-lived ACP WebSocket.
//
// Two failure modes it protects against:
//  1. Half-open connections — a peer vanishes (network drop, laptop sleep)
//     without a TCP FIN, so the socket looks open forever and the agent leaks.
//     Fixed with a ping/pong heartbeat: each interval we ping; if no pong
//     arrived since the previous ping, the peer is dead → terminate.
//  2. Slow consumers — the client can't drain what we send (a runaway agent
//     streaming into a stalled browser tab), so the kernel/user send buffer
//     grows without bound. Fixed by closing when bufferedAmount crosses a limit.
//
// The check logic is a pure method (`runCheck`) driven by a timer in `start()`,
// so tests can call it deterministically instead of waiting on wall-clock.

/** The subset of a `ws` WebSocket this monitor needs. */
export interface MonitoredSocket {
  ping(): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount: number;
}

export interface ConnectionMonitorOptions {
  /** Heartbeat interval in ms (default 30_000). */
  intervalMs?: number;
  /** Close the socket when bufferedAmount exceeds this many bytes (default 16 MiB). */
  backpressureLimitBytes?: number;
  /** Timer factory (injectable for tests); defaults to setInterval/clearInterval. */
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

// Close code 1013 = "Try Again Later" (RFC 6455 registry) — the closest
// standard code for shedding an overloaded/backpressured connection.
export const CLOSE_BACKPRESSURE = 1013;

export class ConnectionMonitor {
  private alive = true;
  private started = false;
  private stopped = false;
  private handle: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly backpressureLimitBytes: number;
  private readonly _setInterval: NonNullable<ConnectionMonitorOptions['setInterval']>;
  private readonly _clearInterval: NonNullable<ConnectionMonitorOptions['clearInterval']>;

  constructor(private socket: MonitoredSocket, options: ConnectionMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.backpressureLimitBytes = options.backpressureLimitBytes ?? 16 * 1024 * 1024;
    this._setInterval = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this._clearInterval = options.clearInterval ?? ((h) => clearInterval(h));
  }

  /** Begin the heartbeat. Sends an initial ping so the first pong is expected. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.alive = true;
    this.socket.ping();
    this.handle = this._setInterval(() => this.runCheck(), this.intervalMs);
    if (typeof this.handle === 'object' && this.handle && 'unref' in this.handle) {
      (this.handle as { unref?: () => void }).unref?.();
    }
  }

  /** Record that the peer answered our ping (wire this to the socket's 'pong'). */
  notifyPong(): void {
    this.alive = true;
  }

  /**
   * One heartbeat tick. Backpressure is checked first (a wedged consumer is a
   * harder failure than a missed pong). Returns the action taken — handy for
   * tests and metrics.
   */
  runCheck(): 'ok' | 'terminated' | 'backpressure' {
    if (this.stopped) return 'ok';

    if (this.socket.bufferedAmount > this.backpressureLimitBytes) {
      this.stop();
      this.socket.close(CLOSE_BACKPRESSURE, 'Backpressure: send buffer exceeded limit');
      return 'backpressure';
    }

    if (!this.alive) {
      this.stop();
      this.socket.terminate();
      return 'terminated';
    }

    // Assume dead until the next pong flips it back.
    this.alive = false;
    this.socket.ping();
    return 'ok';
  }

  /** Stop the heartbeat and release the timer. Idempotent. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.handle !== null) {
      this._clearInterval(this.handle);
      this.handle = null;
    }
  }

  get isRunning(): boolean {
    return this.started && !this.stopped;
  }
}
