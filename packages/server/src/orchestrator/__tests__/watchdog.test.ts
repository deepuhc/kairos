import { describe, it, expect } from 'vitest';
import { AgentWatchdog } from '../watchdog.js';

// A manual clock so runCheck() is driven deterministically (mirrors the
// ConnectionMonitor injectable-timer tests) rather than waiting on wall time.
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

const MIN = 60_000;

describe('AgentWatchdog', () => {
  it('is ok immediately after construction', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({ now: clock.now });
    expect(wd.runCheck()).toBe('ok');
    expect(wd.idleMs()).toBe(0);
  });

  it('stays ok while heartbeats keep arriving inside the gap', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({ heartbeatTimeoutMs: 3 * MIN, now: clock.now });
    for (let i = 0; i < 5; i++) {
      clock.advance(2 * MIN); // under the 3-min gap
      wd.heartbeat();
      expect(wd.runCheck()).toBe('ok');
    }
  });

  it('reports stalled once the heartbeat gap is exceeded', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({ heartbeatTimeoutMs: 3 * MIN, now: clock.now });
    clock.advance(3 * MIN - 1);
    expect(wd.runCheck()).toBe('ok');
    clock.advance(1); // now exactly at the gap
    expect(wd.runCheck()).toBe('stalled');
    expect(wd.idleMs()).toBe(3 * MIN);
  });

  it('a heartbeat clears a stall', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({ heartbeatTimeoutMs: 3 * MIN, now: clock.now });
    clock.advance(4 * MIN);
    expect(wd.runCheck()).toBe('stalled');
    wd.heartbeat();
    expect(wd.runCheck()).toBe('ok');
    expect(wd.idleMs()).toBe(0);
  });

  it('reports soft-stall when the fingerprint is unchanged for N sweeps', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 10 * MIN,
      softStallSweeps: 3,
      now: clock.now,
    });
    // First heartbeat sets the fingerprint; sweeps count on REPEATS of it.
    wd.heartbeat('fp-1');
    expect(wd.runCheck()).toBe('ok');
    wd.heartbeat('fp-1'); // sweep 1
    wd.heartbeat('fp-1'); // sweep 2
    expect(wd.runCheck()).toBe('ok');
    wd.heartbeat('fp-1'); // sweep 3 → soft stall
    expect(wd.runCheck()).toBe('soft-stall');
  });

  it('a changed fingerprint resets the soft-stall counter', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 10 * MIN,
      softStallSweeps: 2,
      now: clock.now,
    });
    wd.heartbeat('a');
    wd.heartbeat('a');
    wd.heartbeat('a'); // 2 repeats → soft-stall
    expect(wd.runCheck()).toBe('soft-stall');
    wd.heartbeat('b'); // real progress resets
    expect(wd.runCheck()).toBe('ok');
  });

  it('empty fingerprints are liveness-only and never soft-stall', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 10 * MIN,
      softStallSweeps: 2,
      now: clock.now,
    });
    for (let i = 0; i < 5; i++) wd.heartbeat();
    expect(wd.runCheck()).toBe('ok');
  });

  it('reports timeout when start-to-close is exceeded even with heartbeats', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 3 * MIN,
      startToCloseMs: 30 * MIN,
      now: clock.now,
    });
    // Keep it alive with regular heartbeats, but blow past the attempt cap.
    for (let i = 0; i < 20; i++) {
      clock.advance(2 * MIN);
      wd.heartbeat();
    }
    expect(clock.now()).toBeGreaterThanOrEqual(30 * MIN);
    expect(wd.runCheck()).toBe('timeout');
  });

  it('reports timeout when schedule-to-close is exceeded across retries', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 3 * MIN,
      startToCloseMs: 30 * MIN,
      scheduleToCloseMs: 120 * MIN,
      now: clock.now,
    });
    // Retry repeatedly (resets the per-attempt clock) so start-to-close never
    // fires, but the overall schedule-to-close still bounds the task. Five
    // 20-min attempts = 100 min, all under the 120-min schedule cap.
    for (let i = 0; i < 5; i++) {
      clock.advance(20 * MIN);
      wd.restartAttempt();
      expect(wd.runCheck()).not.toBe('timeout');
    }
    clock.advance(20 * MIN); // now at 120 min total
    wd.restartAttempt();
    expect(wd.runCheck()).toBe('timeout');
  });

  it('restartAttempt clears a stall and resets the per-attempt clock', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 3 * MIN,
      startToCloseMs: 30 * MIN,
      now: clock.now,
    });
    clock.advance(29 * MIN); // near the attempt cap, and stalled
    expect(wd.runCheck()).toBe('stalled');
    wd.restartAttempt();
    expect(wd.runCheck()).toBe('ok'); // fresh attempt clock + heartbeat
    clock.advance(2 * MIN);
    expect(wd.runCheck()).toBe('ok'); // would have been timeout without the reset
  });

  it('timeout wins over stalled (severity ordering)', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({
      heartbeatTimeoutMs: 3 * MIN,
      startToCloseMs: 30 * MIN,
      now: clock.now,
    });
    clock.advance(31 * MIN); // both the heartbeat gap AND start-to-close blown
    expect(wd.runCheck()).toBe('timeout');
  });

  it('is inert after finish()', () => {
    const clock = makeClock();
    const wd = new AgentWatchdog({ heartbeatTimeoutMs: 3 * MIN, now: clock.now });
    wd.finish();
    clock.advance(10 * MIN);
    expect(wd.runCheck()).toBe('ok');
  });
});
