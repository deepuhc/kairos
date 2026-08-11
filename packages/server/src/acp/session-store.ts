import type { Message } from '@kairos/providers';

// Session state for ACP agents, shared across connections.
//
// AcpServer builds a fresh agent per WebSocket connection (see server.ts), so if
// each agent kept its own history + session-id counter, two problems followed:
//   1. Reconnecting (a new socket) and calling `session/load` to resume would
//      land on an empty agent and silently lose all prior context.
//   2. Two connections would each mint `sess-1`, colliding process-wide.
// Lifting both the id counter and the history map into one store — created once
// in main.ts and shared by every ProviderAcpAgent — makes session/load actually
// resume, and keeps session ids unique across connections.
//
// This is an in-memory store (lifetime = server process). Durable persistence
// across restarts is a separate, later concern.
export class SessionStore {
  private seq = 0;
  private history = new Map<string, Message[]>();

  /** Create a new session with empty history and a process-unique id. */
  create(): { sessionId: string } {
    const sessionId = `sess-${++this.seq}`;
    this.history.set(sessionId, []);
    return { sessionId };
  }

  /** Whether a session exists. */
  has(sessionId: string): boolean {
    return this.history.has(sessionId);
  }

  /**
   * Resume a session: return its (possibly empty) history. Unknown sessions are
   * created empty rather than rejected, so a client resuming after a server
   * restart still gets a usable session instead of a hard failure.
   */
  load(sessionId: string): Message[] {
    let messages = this.history.get(sessionId);
    if (!messages) {
      messages = [];
      this.history.set(sessionId, messages);
    }
    return messages;
  }

  /** Get the live history array for a session (undefined if it never existed). */
  get(sessionId: string): Message[] | undefined {
    return this.history.get(sessionId);
  }

  /** Replace the history for a session. */
  set(sessionId: string, messages: Message[]): void {
    this.history.set(sessionId, messages);
  }
}
