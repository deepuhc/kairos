import type { UpdatePayload, PermissionRequest, SessionStatus } from "./acp/types.js";

export interface AgentState {
  id: string;
  sessionId: string | null;
  name: string;
  status: "idle" | "streaming" | "waiting_permission" | "complete" | "error";
  messages: ChatMessage[];
  unread: number;
  costUsd: number;
  durationMs: number;
}

export type ChatMessage =
  | { type: "user"; text: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }
  | { type: "system"; text: string };

export type StoreListener = () => void;

class KairosStore {
  private _agents = new Map<string, AgentState>();
  private _activeAgentId: string | null = null;
  private _permissionRequests: PermissionRequest[] = [];
  private listeners = new Set<StoreListener>();

  get agents(): ReadonlyMap<string, AgentState> {
    return this._agents;
  }

  get activeAgentId(): string | null {
    return this._activeAgentId;
  }

  get activeAgent(): AgentState | undefined {
    return this._activeAgentId ? this._agents.get(this._activeAgentId) : undefined;
  }

  get permissionRequests(): readonly PermissionRequest[] {
    return this._permissionRequests;
  }

  createAgent(name?: string): string {
    const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this._agents.set(id, {
      id,
      sessionId: null,
      name: name || `Agent ${this._agents.size + 1}`,
      status: "idle",
      messages: [],
      unread: 0,
      costUsd: 0,
      durationMs: 0,
    });
    this._activeAgentId = id;
    this.notify();
    return id;
  }

  setSession(agentId: string, sessionId: string): void {
    const agent = this._agents.get(agentId);
    if (agent) {
      agent.sessionId = sessionId;
      this.notify();
    }
  }

  setActive(agentId: string): void {
    const agent = this._agents.get(agentId);
    if (agent) {
      agent.unread = 0;
      this._activeAgentId = agentId;
      this.notify();
    }
  }

  addUserMessage(agentId: string, text: string): void {
    const agent = this._agents.get(agentId);
    if (agent) {
      agent.messages.push({ type: "user", text });
      agent.status = "streaming";
      this.notify();
    }
  }

  handleUpdate(sessionId: string, update: UpdatePayload): void {
    const agent = this.findBySession(sessionId);
    if (!agent) return;

    switch (update.type) {
      case "thinking":
        agent.messages.push({ type: "thinking", text: update.thinking });
        break;
      case "text":
        agent.messages.push({ type: "text", text: update.text });
        break;
      case "tool_use":
        agent.messages.push({ type: "tool_use", id: update.id, name: update.name, input: update.input });
        break;
      case "tool_result": {
        const toolMsg = [...agent.messages].reverse().find(
          (m) => m.type === "tool_use" && m.id === update.tool_use_id
        );
        if (toolMsg && toolMsg.type === "tool_use") {
          toolMsg.result = update.content;
          toolMsg.isError = update.is_error;
        }
        break;
      }
      case "status":
        agent.status = this.mapStatus(update.status);
        break;
      case "cost":
        agent.costUsd = update.cost_usd;
        agent.durationMs = update.duration_ms;
        break;
    }

    if (agent.id !== this._activeAgentId) {
      agent.unread++;
    }
    this.notify();
  }

  addPermissionRequest(request: PermissionRequest): void {
    this._permissionRequests.push(request);
    const agent = this.findBySession(request.session_id);
    if (agent) {
      agent.status = "waiting_permission";
    }
    this.notify();
  }

  resolvePermission(requestId: string): void {
    this._permissionRequests = this._permissionRequests.filter((r) => r.id !== requestId);
    this.notify();
  }

  removeAgent(agentId: string): void {
    this._agents.delete(agentId);
    if (this._activeAgentId === agentId) {
      const first = this._agents.keys().next().value;
      this._activeAgentId = first ?? null;
    }
    this.notify();
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private findBySession(sessionId: string): AgentState | undefined {
    for (const agent of this._agents.values()) {
      if (agent.sessionId === sessionId) return agent;
    }
    return undefined;
  }

  private mapStatus(status: SessionStatus): AgentState["status"] {
    switch (status) {
      case "streaming": return "streaming";
      case "idle": return "idle";
      case "waiting_permission": return "waiting_permission";
      case "complete": return "complete";
      case "error": return "error";
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const store = new KairosStore();
