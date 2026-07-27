import type { JsonRpcMessage, JsonRpcRequest, JsonRpcNotification } from "./types.js";

export class JsonRpcCodec {
  private nextId = 1;
  private buffer = "";
  private pendingRequests = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  encode(method: string, params?: Record<string, unknown>): { id: number; payload: string } {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return { id, payload: JSON.stringify(request) + "\n" };
  }

  encodeNotification(method: string, params?: Record<string, unknown>): string {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    return JSON.stringify(notification) + "\n";
  }

  registerPending(id: number | string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  decode(chunk: string): JsonRpcMessage[] {
    this.buffer += chunk;
    const messages: JsonRpcMessage[] = [];
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        messages.push(msg);

        if ("id" in msg && msg.id !== null && !("method" in msg)) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            this.pendingRequests.delete(msg.id);
            if ("error" in msg && msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch {
        // skip non-JSON lines
      }
    }
    return messages;
  }

  hasPending(id: number | string): boolean {
    return this.pendingRequests.has(id);
  }

  reset(): void {
    this.buffer = "";
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error("Connection reset"));
    }
    this.pendingRequests.clear();
  }
}
