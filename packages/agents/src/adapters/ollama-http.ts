import { EventEmitter } from 'node:events';
import type { AgentHandle, AgentStatus, AgentConfig } from '../types.js';

export class OllamaHttpAgent extends EventEmitter implements AgentHandle {
  readonly id: string;
  private _status: AgentStatus = 'ready';
  private baseUrl: string;
  private model: string;
  private outputHandlers: Array<(chunk: string) => void> = [];
  private statusHandlers: Array<(status: AgentStatus) => void> = [];
  private exitHandlers: Array<(code: number | null) => void> = [];
  private abortController?: AbortController;

  constructor(config: AgentConfig) {
    super();
    this.id = config.id;
    this.baseUrl = config.env?.OLLAMA_HOST || 'http://localhost:11434';
    this.model = config.model || 'mistral';
  }

  get status(): AgentStatus {
    return this._status;
  }

  send(text: string): void {
    this.setStatus('working');
    this.abortController = new AbortController();

    this.streamResponse(text).catch((err) => {
      for (const handler of this.outputHandlers) handler(`\nError: ${err.message}\n`);
      this.setStatus('error');
    });
  }

  kill(): void {
    this.abortController?.abort();
    this.setStatus('terminated');
    for (const handler of this.exitHandlers) handler(0);
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

  private async streamResponse(prompt: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: this.abortController?.signal,
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as { message?: { content: string }; done?: boolean };
          if (chunk.message?.content) {
            for (const handler of this.outputHandlers) handler(chunk.message.content);
          }
        } catch {
          // skip
        }
      }
    }

    this.setStatus('idle');
  }

  private setStatus(status: AgentStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const handler of this.statusHandlers) handler(status);
    this.emit('status', status);
  }
}
