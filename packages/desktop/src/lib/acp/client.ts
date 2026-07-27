import { JsonRpcCodec } from "./codec.js";
import { Session } from "./session.js";
import type { Transport } from "./transport.js";
import type {
  InitializeResult,
  SessionNewParams,
  SessionNewResult,
  SessionUpdate,
  PermissionRequest,
  PermissionResponse,
  JsonRpcMessage,
  UpdatePayload,
} from "./types.js";

export type ACPEventHandler = {
  onUpdate?: (sessionId: string, update: UpdatePayload) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
};

export class ACPClient {
  private codec = new JsonRpcCodec();
  private transport: Transport;
  private sessions = new Map<string, Session>();
  private handlers: ACPEventHandler;
  private capabilities?: InitializeResult;

  constructor(transport: Transport, handlers: ACPEventHandler = {}) {
    this.transport = transport;
    this.handlers = handlers;

    this.transport.onMessage((data) => this.handleIncoming(data));
    this.transport.onClose(() => this.handlers.onClose?.());
    this.transport.onError((err) => this.handlers.onError?.(err));
  }

  async initialize(): Promise<InitializeResult> {
    const { id, payload } = this.codec.encode("initialize", {
      client_info: { name: "kairos-desktop", version: "0.1.0" },
      capabilities: {
        streaming: true,
        permissions: true,
      },
    });

    const promise = this.codec.registerPending(id) as Promise<InitializeResult>;
    this.transport.send(payload);
    this.capabilities = await promise;
    return this.capabilities;
  }

  async newSession(params?: Record<string, unknown>): Promise<Session> {
    const { id, payload } = this.codec.encode("session/new", params as Record<string, unknown> | undefined);

    const promise = this.codec.registerPending(id) as Promise<SessionNewResult>;
    this.transport.send(payload);
    const result = await promise;

    const session = new Session(result.session_id);
    session.transition("active");
    this.sessions.set(result.session_id, session);
    return session;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    session.addMessage({ role: "user", content: [{ type: "text", text }] });

    const { id, payload } = this.codec.encode("session/prompt", {
      session_id: sessionId,
      messages: [{ role: "user", content: [{ type: "text", text }] }],
    });

    this.codec.registerPending(id);
    this.transport.send(payload);
    session.transition("streaming");
  }

  respondPermission(response: PermissionResponse): void {
    const payload = this.codec.encodeNotification("session/permission_response", {
      id: response.id,
      decision: response.decision,
    });
    this.transport.send(payload);
  }

  cancel(sessionId: string): void {
    const { id, payload } = this.codec.encode("session/cancel", {
      session_id: sessionId,
    });
    this.codec.registerPending(id);
    this.transport.send(payload);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  get allSessions(): ReadonlyMap<string, Session> {
    return this.sessions;
  }

  close(): void {
    this.codec.reset();
    this.transport.close();
  }

  private handleIncoming(data: string): void {
    const messages = this.codec.decode(data);
    for (const msg of messages) {
      this.routeMessage(msg);
    }
  }

  private routeMessage(msg: JsonRpcMessage): void {
    if (!("method" in msg)) return;

    switch (msg.method) {
      case "session/update": {
        const params = msg.params as unknown as SessionUpdate;
        const session = this.sessions.get(params.session_id);
        if (session && params.update.type === "status") {
          const newState = session.mapStatus(params.update.status);
          session.transition(newState);
        }
        this.handlers.onUpdate?.(params.session_id, params.update);
        break;
      }

      case "session/request_permission": {
        const request = msg.params as unknown as PermissionRequest;
        this.handlers.onPermissionRequest?.(request);
        break;
      }

      default:
        break;
    }
  }
}
