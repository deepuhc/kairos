import { describe, it, expect } from 'vitest';
import { ConnectionMonitor, CLOSE_BACKPRESSURE, type MonitoredSocket } from '../connection-monitor.js';

class FakeSocket implements MonitoredSocket {
  pings = 0;
  terminated = false;
  closedWith: { code?: number; reason?: string } | null = null;
  bufferedAmount = 0;

  ping(): void { this.pings++; }
  terminate(): void { this.terminated = true; }
  close(code?: number, reason?: string): void { this.closedWith = { code, reason }; }
}

// A controllable timer: start() registers a callback we fire manually via tick().
function fakeTimer() {
  let cb: (() => void) | null = null;
  return {
    setInterval: (fn: () => void) => { cb = fn; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearInterval: () => { cb = null; },
    tick: () => cb?.(),
    get armed() { return cb !== null; },
  };
}

function make(socket: FakeSocket, opts: Partial<{ backpressureLimitBytes: number }> = {}) {
  const timer = fakeTimer();
  const monitor = new ConnectionMonitor(socket, {
    intervalMs: 1000,
    backpressureLimitBytes: opts.backpressureLimitBytes ?? 1024,
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });
  return { monitor, timer };
}

describe('ConnectionMonitor — heartbeat', () => {
  it('pings on start and arms the interval', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket);
    monitor.start();
    expect(socket.pings).toBe(1);
    expect(timer.armed).toBe(true);
    expect(monitor.isRunning).toBe(true);
  });

  it('keeps the connection alive across ticks when pongs arrive', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket);
    monitor.start(); // ping #1

    for (let i = 0; i < 3; i++) {
      monitor.notifyPong();          // peer answered the previous ping
      expect(timer.tick()).toBe('ok'); // check pings again
    }
    expect(socket.terminated).toBe(false);
    expect(socket.pings).toBe(4); // 1 start + 3 ticks
  });

  it('terminates the socket when a pong is missed between ticks', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket);
    monitor.start();          // ping #1, alive=false after
    monitor.notifyPong();     // alive=true
    expect(timer.tick()).toBe('ok'); // ping #2, alive=false
    // No pong this cycle:
    expect(timer.tick()).toBe('terminated');
    expect(socket.terminated).toBe(true);
    expect(monitor.isRunning).toBe(false); // stopped itself
  });

  it('is a no-op after stop()', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket);
    monitor.start();
    monitor.stop();
    expect(timer.armed).toBe(false);
    expect(monitor.runCheck()).toBe('ok');
    expect(socket.terminated).toBe(false);
  });

  it('start() is idempotent', () => {
    const socket = new FakeSocket();
    const { monitor } = make(socket);
    monitor.start();
    monitor.start();
    expect(socket.pings).toBe(1);
  });
});

describe('ConnectionMonitor — backpressure', () => {
  it('closes with 1013 when the send buffer exceeds the limit', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket, { backpressureLimitBytes: 1024 });
    monitor.start();
    socket.bufferedAmount = 2048; // slow consumer
    expect(timer.tick()).toBe('backpressure');
    expect(socket.closedWith?.code).toBe(CLOSE_BACKPRESSURE);
    expect(socket.terminated).toBe(false); // graceful close, not terminate
    expect(monitor.isRunning).toBe(false);
  });

  it('prioritizes backpressure over a missed pong', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket, { backpressureLimitBytes: 512 });
    monitor.start();
    socket.bufferedAmount = 4096; // over limit AND no pong since start
    expect(timer.tick()).toBe('backpressure');
    expect(socket.closedWith?.code).toBe(CLOSE_BACKPRESSURE);
    expect(socket.terminated).toBe(false);
  });

  it('does not close while buffer stays under the limit', () => {
    const socket = new FakeSocket();
    const { monitor, timer } = make(socket, { backpressureLimitBytes: 1024 });
    monitor.start();
    socket.bufferedAmount = 512;
    monitor.notifyPong();
    expect(timer.tick()).toBe('ok');
    expect(socket.closedWith).toBeNull();
  });
});
