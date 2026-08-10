import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AgentConfig, AgentHandle, AgentStatus } from './types.js';

export class AgentProcess extends EventEmitter implements AgentHandle {
  readonly id: string;
  private proc: ChildProcess | null = null;
  private _status: AgentStatus = 'spawning';
  private outputHandlers: Array<(chunk: string) => void> = [];
  private statusHandlers: Array<(status: AgentStatus) => void> = [];
  private exitHandlers: Array<(code: number | null) => void> = [];

  constructor(private config: AgentConfig) {
    super();
    this.id = config.id;
  }

  get status(): AgentStatus {
    return this._status;
  }

  start(): void {
    const env = { ...process.env, ...this.config.env };

    this.proc = spawn(this.config.command, this.config.args, {
      cwd: this.config.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      for (const handler of this.outputHandlers) handler(text);
      this.emit('output', text);
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      for (const handler of this.outputHandlers) handler(text);
      this.emit('output', text);
    });

    this.proc.on('error', (err) => {
      this.setStatus('error');
      this.emit('error', err);
    });

    this.proc.on('exit', (code) => {
      this.setStatus('terminated');
      for (const handler of this.exitHandlers) handler(code);
      this.emit('exit', code);
    });

    this.setStatus('ready');
  }

  send(text: string): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error(`Agent ${this.id} stdin not writable`);
    }
    this.proc.stdin.write(text + '\n');
    this.setStatus('working');
  }

  kill(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL');
      }, 5000);
    }
    this.setStatus('terminated');
  }

  onOutput(handler: (chunk: string) => void): void {
    this.outputHandlers.push(handler);
  }

  onStatus(handler: (status: AgentStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  private setStatus(status: AgentStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const handler of this.statusHandlers) handler(status);
    this.emit('status', status);
  }
}
