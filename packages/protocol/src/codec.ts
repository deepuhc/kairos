import type { JsonRpcRequest, JsonRpcNotification, JsonRpcResponse, JsonRpcMessage } from './types.js';

export class JsonRpcCodec {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  encode(method: string, params?: Record<string, unknown>): { id: number; payload: string } {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return { id, payload: JSON.stringify(request) + '\n' };
  }

  encodeNotification(method: string, params?: Record<string, unknown>): string {
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    return JSON.stringify(notification) + '\n';
  }

  encodeResponse(id: number | string, result?: unknown, error?: { code: number; message: string }): string {
    const response: JsonRpcResponse = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result };
    return JSON.stringify(response) + '\n';
  }

  registerPending(id: number | string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  decode(chunk: string): JsonRpcMessage[] {
    this.buffer += chunk;
    const messages: JsonRpcMessage[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        messages.push(msg);
        this.settlePending(msg);
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  }

  reset(): void {
    this.buffer = '';
    for (const [, { reject }] of this.pending) {
      reject(new Error('Connection reset'));
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private settlePending(msg: JsonRpcMessage): void {
    if (!('id' in msg) || msg.id === undefined || msg.id === null) return;
    if ('method' in msg) return; // requests have method — not responses

    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);

    if ('error' in msg && msg.error) {
      entry.reject(new Error(msg.error.message));
    } else {
      entry.resolve((msg as JsonRpcResponse).result);
    }
  }
}
