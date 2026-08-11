// The transport-agnostic seam between an ACP agent and its client.
//
// An agent implementation (real or fake) never touches a WebSocket — it talks
// to a `Peer`, which can send client-bound notifications and originate
// client-bound requests (e.g. session/request_permission) and await the answer.
// This lets the whole agent lifecycle be unit-tested with an in-memory peer.
export interface Peer {
  /** Fire a server → client notification (no response expected). */
  notify(method: string, params?: Record<string, unknown>): void;
  /** Send a server → client request and resolve with the client's result. */
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

// What the connection layer dispatches inbound client frames to. An agent
// answers requests (returns a result) and observes notifications.
export interface AcpAgent {
  /** Handle a client → server request; the resolved value becomes the result. */
  handleRequest(method: string, params: Record<string, unknown>, peer: Peer): Promise<unknown>;
  /** Observe a client → server notification (session/cancel, etc.). */
  handleNotification(method: string, params: Record<string, unknown>, peer: Peer): void;
  /**
   * Release any resources when the client connection drops (e.g. kill a spawned
   * subprocess). Optional — in-process agents need no teardown.
   */
  close?(): void;
}
