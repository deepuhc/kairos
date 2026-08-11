import { spawn, type ChildProcess } from 'node:child_process';
import type { ChildIo } from './stdio-bridge.js';
import type { LaunchSpec } from './launch-spec.js';

// A ChildIo backed by a real spawned subprocess. Bridges the process's
// stdin/stdout/stderr to the StdioAcpAgent proxy. The child speaks newline-
// framed JSON-RPC on stdout; StdioAcpAgent's codec handles partial-line
// buffering, so raw chunks are forwarded as-is.
export class ChildProcessIo implements ChildIo {
  private proc: ChildProcess;
  private killed = false;

  constructor(spec: LaunchSpec, cwd: string) {
    this.proc = spawn(spec.command, spec.args, {
      cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  write(frame: string): void {
    // Frames from the codec are already newline-terminated.
    if (this.proc.stdin?.writable) this.proc.stdin.write(frame);
  }

  onStdout(cb: (chunk: string) => void): void {
    this.proc.stdout?.on('data', (d: Buffer) => cb(d.toString()));
  }

  onStderr(cb: (chunk: string) => void): void {
    this.proc.stderr?.on('data', (d: Buffer) => cb(d.toString()));
  }

  onExit(cb: (code: number | null) => void): void {
    // Surface spawn failure (e.g. command not found) as an exit so the proxy
    // tears down and the client sees the agent go away rather than hanging.
    this.proc.on('error', () => cb(null));
    this.proc.on('exit', (code) => cb(code));
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    if (!this.proc.killed) {
      this.proc.kill('SIGTERM');
      setTimeout(() => { if (!this.proc.killed) this.proc.kill('SIGKILL'); }, 5000).unref?.();
    }
  }
}
