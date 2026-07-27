import type { SessionStatus, Message } from "./types.js";

export type SessionState = "initialized" | "active" | "streaming" | "idle" | "waiting_permission" | "closed";

export class Session {
  readonly id: string;
  private _state: SessionState = "initialized";
  private _messages: Message[] = [];
  private listeners = new Set<(state: SessionState) => void>();

  constructor(id: string) {
    this.id = id;
  }

  get state(): SessionState {
    return this._state;
  }

  get messages(): ReadonlyArray<Message> {
    return this._messages;
  }

  transition(to: SessionState): void {
    const valid = this.validTransitions[this._state];
    if (!valid?.includes(to)) {
      throw new Error(`Invalid session transition: ${this._state} → ${to}`);
    }
    this._state = to;
    for (const listener of this.listeners) {
      listener(to);
    }
  }

  addMessage(message: Message): void {
    this._messages.push(message);
  }

  onStateChange(handler: (state: SessionState) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  mapStatus(status: SessionStatus): SessionState {
    switch (status) {
      case "streaming": return "streaming";
      case "idle": return "idle";
      case "waiting_permission": return "waiting_permission";
      case "complete": return "closed";
      case "error": return "closed";
    }
  }

  private validTransitions: Record<SessionState, SessionState[]> = {
    initialized: ["active"],
    active: ["streaming", "closed"],
    streaming: ["idle", "waiting_permission", "closed"],
    idle: ["streaming", "active", "closed"],
    waiting_permission: ["streaming", "idle", "closed"],
    closed: [],
  };
}
