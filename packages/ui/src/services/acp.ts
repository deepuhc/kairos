import { WsJsonRpc, errorDetails, RpcError, type RpcParams } from './acp-ws.js';
import { KAIROS_VERSION } from './app-version.js';
import { ensureBackendCookie, fetchWithAuth } from './backend-auth.js';
import type {
  ContentBlock,
  ElicitationResponse,
  ElicitationSchema,
  PermissionOption,
  SessionConfigOption,
  SessionUpdate,
  ToolCall,
  TurnUsage,
} from './acp-types.js';

// Pure ACP JSON-RPC 2.0 client. Each running agent lives on its own WebSocket
// at `/acp?agent=<id>&cwd=<path>` — no multiplexing, no custom event names.
// External clients on other localhost ports speak the same protocol.
//
// Public method + handler surface is unchanged from the previous Socket.io-based
// client: the Agents tab consumes this exactly as before. Internally we keep a
// pool of one WsJsonRpc per agent id and derive `onSession`/`onInitialized`/…
// events from the JSON-RPC responses so the higher-level view code doesn't
// need to know a transport swap happened.

// Custom WebSocket close codes coming from the Rust bridge.
const CLOSE_AGENT_EXIT = 4001;
const CLOSE_BAD_UPGRADE = 4400;

export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: PromptCapabilities;
  [k: string]: unknown;
}

export interface InitializedInfo {
  connectionId: string;
  agentId: string;
  protocolVersion: number;
  agentInfo?: { name?: string; title?: string; version?: string };
  agentCapabilities?: AgentCapabilities;
  authMethods: Array<{
    id: string;
    name: string;
    description?: string;
    _meta?: { 'terminal-auth'?: { command: string; args: string[]; label?: string } };
  }>;
}

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  cwd?: string;
  modes?: { currentModeId: string; availableModes: Array<{ id: string; name: string; description?: string }> };
  configOptions?: SessionConfigOption[];
}

export interface SessionLoaded {
  sessionId: string;
  agentId: string;
  cwd: string;
  modes?: SessionInfo['modes'];
  configOptions?: SessionConfigOption[];
}

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolCall: ToolCall;
  options: PermissionOption[];
}

export interface ElicitationRequest {
  requestId: string;
  sessionId: string;
  message: string;
  requestedSchema: ElicitationSchema;
  toolCallId?: string;
}

export interface AcpHandlers {
  onInitialized?: (info: InitializedInfo) => void;
  onSession?: (info: SessionInfo) => void;
  onSessionLoaded?: (info: SessionLoaded) => void;
  onUpdate?: (sessionId: string, update: SessionUpdate) => void;
  onConfigOptions?: (sessionId: string, configOptions: SessionConfigOption[]) => void;
  onPermissionRequest?: (req: PermissionRequest) => void;
  onElicitationRequest?: (req: ElicitationRequest) => void;
  onTerminalOutput?: (sessionId: string, terminalId: string, output: string) => void;
  onTerminalAuthOpened?: (success: boolean, error?: string) => void;
  onStop?: (sessionId: string, stopReason: string, usage?: TurnUsage) => void;
  onStalled?: (sessionId: string, secondsIdle: number) => void;
  onAgentRestarted?: (agentId: string) => void;
  onError?: (message: string, sessionId?: string, agentId?: string) => void;
  onLoadError?: (sessionId: string, message: string) => void;
  onExit?: (code: number | null, agentId?: string, detail?: string) => void;
  onLog?: (stream: string, text: string, agentId?: string) => void;
}

/** Answer to an inbound permission or elicitation request. */
type PermissionResolver = (outcome: unknown) => void;
type ElicitationResolver = (response: unknown) => void;

interface AgentConn {
  peer: WsJsonRpc;
  cwd: string;
  /** Sessions this connection owns (tracked so cancel/prompt can route by sid). */
  sessions: Set<string>;
  /** Client-owned requestId → resolver that answers the inbound JSON-RPC request. */
  pendingPermissions: Map<string, PermissionResolver>;
  pendingElicitations: Map<string, ElicitationResolver>;
  /** Marker: on next close, fire onAgentRestarted instead of onExit. */
  restartExpected: boolean;
  /** Whether initialize completed successfully. */
  initialized: boolean;
}

function wsUrlFor(agent: string, cwd: string): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ agent, cwd });
  return `${scheme}//${location.host}/acp?${params.toString()}`;
}

function newRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

// A request that rejected because the socket closed (not an agent error frame).
// These are reported once, authoritatively, by onSocketClose — which runs
// synchronously in the close event and knows the full context (exit code,
// whether init completed, restart-expected). Per-request `.catch` handlers skip
// them so a late-firing microtask can't clobber that message with a generic one.
function isSocketClose(err: unknown): boolean {
  return err instanceof RpcError && err.socketClosed;
}

// The bridge encodes an agent exit as `agent-exit code=N[: <stderr detail>]`.
// Strip that machine prefix so the human sees just the cause (or nothing).
function cleanCloseReason(reason: string): string {
  const m = /^agent-exit code=(?:-?\d+|null)(?::\s*([\s\S]*))?$/.exec(reason);
  return m ? (m[1] ?? '').trim() : reason;
}

export class AcpClient {
  private handlers: AcpHandlers = {};
  private pool = new Map<string, AgentConn>();
  private opening = new Set<string>();

  setHandlers(handlers: AcpHandlers): void {
    this.handlers = handlers;
  }

  connect(cwd: string, agent: string): void {
    // Idempotent: reuse a live connection to the same agent (previously the
    // server-side pool made repeat `acp:connect` calls no-ops).
    const existing = this.pool.get(agent);
    if (existing || this.opening.has(agent)) return;
    this.opening.add(agent);
    ensureBackendCookie()
      .then(() => this.openConnection(agent, cwd))
      .finally(() => this.opening.delete(agent));
  }

  authenticate(methodId: string, agent: string): void {
    const c = this.pool.get(agent);
    if (!c) return;
    c.peer.request('authenticate', { methodId }).catch((err) => {
      if (isSocketClose(err)) return; // onSocketClose reports it once.
      this.handlers.onError?.(errorDetails(err), undefined, agent);
    });
  }

  terminalAuth(command: string, args: string[]): void {
    // Not an ACP message — it's a request to the server to open a system
    // terminal window for an interactive login flow. Sent as REST so the ACP
    // wire stays vanilla for external clients.
    fetchWithAuth('/api/agents/terminal-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, args }),
    })
      .then((res) => res.json())
      .then((body: { success: boolean; error?: string }) => {
        this.handlers.onTerminalAuthOpened?.(body.success, body.error);
      })
      .catch((err) => {
        this.handlers.onTerminalAuthOpened?.(false, (err as Error).message);
      });
  }

  newSession(cwd: string, agent: string): void {
    const c = this.pool.get(agent);
    if (!c) return;
    c.peer
      .request<{ sessionId: string; modes?: SessionInfo['modes']; configOptions?: SessionConfigOption[] }>('session/new', {
        cwd,
        mcpServers: [],
      })
      .then((result) => {
        c.sessions.add(result.sessionId);
        this.handlers.onSession?.({
          sessionId: result.sessionId,
          agentId: agent,
          cwd,
          modes: result.modes,
          configOptions: result.configOptions,
        });
      })
      .catch((err) => {
        if (isSocketClose(err)) return; // onSocketClose reports it once.
        this.handlers.onError?.(errorDetails(err), undefined, agent);
      });
  }

  loadSession(sessionId: string, cwd: string, agent: string): void {
    const c = this.pool.get(agent);
    if (!c) return;
    // Pre-register the session so a `prompt` fired immediately after load can
    // route via connForSession.
    c.sessions.add(sessionId);
    c.peer
      .request<{ modes?: SessionInfo['modes']; configOptions?: SessionConfigOption[] } | null>('session/load', {
        sessionId,
        cwd,
        mcpServers: [],
      })
      .then((result) => {
        this.handlers.onSessionLoaded?.({
          sessionId,
          agentId: agent,
          cwd,
          modes: result?.modes,
          configOptions: result?.configOptions,
        });
      })
      .catch((err) => {
        c.sessions.delete(sessionId);
        if (isSocketClose(err)) return; // onSocketClose → onExit reports it once.
        this.handlers.onLoadError?.(sessionId, errorDetails(err));
      });
  }

  prompt(sessionId: string, prompt: ContentBlock[]): void {
    const c = this.connForSession(sessionId);
    if (!c) {
      this.handlers.onError?.('No connection for session', sessionId);
      this.handlers.onStop?.(sessionId, 'refusal');
      return;
    }
    c.peer
      .request<{ stopReason: string; usage?: TurnUsage }>('session/prompt', { sessionId, prompt })
      .then((result) => this.handlers.onStop?.(sessionId, result.stopReason, result.usage))
      .catch((err) => {
        // A socket close mid-turn is reported by onSocketClose → onExit, which
        // already drives every owned session to its error/stopped state; a
        // generic per-prompt error here would just clobber that with a vaguer one.
        if (isSocketClose(err)) return;
        // A failed prompt fires BOTH error and stop so the UI reaches its
        // "stopped" state — preserves the pre-refactor behavior.
        this.handlers.onError?.(errorDetails(err), sessionId);
        this.handlers.onStop?.(sessionId, 'refusal');
      });
  }

  setConfigOption(sessionId: string, configId: string, value: string): void {
    const c = this.connForSession(sessionId);
    if (!c) return;
    c.peer
      .request<{ configOptions?: SessionConfigOption[] }>('session/set_config_option', { sessionId, configId, value })
      .then((result) => {
        if (result?.configOptions) this.handlers.onConfigOptions?.(sessionId, result.configOptions);
      })
      .catch((err) => {
        if (isSocketClose(err)) return; // onSocketClose reports it once.
        this.handlers.onError?.(errorDetails(err), sessionId);
      });
  }

  cancel(sessionId: string): void {
    const c = this.connForSession(sessionId);
    if (!c) return;
    c.peer.sendNotification('session/cancel', { sessionId });
  }

  forceRestart(agent: string): void {
    const c = this.pool.get(agent);
    if (c) c.restartExpected = true;
    // Fire-and-forget REST call. The server SIGKILLs the agent; the WS closes
    // as a side effect and the close handler fires onAgentRestarted.
    fetchWithAuth(`/api/agents/${encodeURIComponent(agent)}/force-restart`, { method: 'POST' }).catch(() => {
      // Fallback if REST itself failed: still bounce the socket so the UI unwedges.
      c?.peer.close();
    });
  }

  resolvePermission(requestId: string, outcome: unknown): void {
    for (const [, c] of this.pool) {
      const resolver = c.pendingPermissions.get(requestId);
      if (!resolver) continue;
      c.pendingPermissions.delete(requestId);
      resolver(outcome);
      return;
    }
  }

  resolveElicitation(requestId: string, response: ElicitationResponse): void {
    for (const [, c] of this.pool) {
      const resolver = c.pendingElicitations.get(requestId);
      if (!resolver) continue;
      c.pendingElicitations.delete(requestId);
      resolver(response);
      return;
    }
  }

  disconnect(agent?: string): void {
    if (agent) {
      const c = this.pool.get(agent);
      if (!c) return;
      this.pool.delete(agent);
      c.peer.close();
    } else {
      for (const [, c] of this.pool) c.peer.close();
      this.pool.clear();
    }
  }

  dispose(): void {
    this.disconnect();
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private openConnection(agent: string, cwd: string): void {
    const peer = new WsJsonRpc(wsUrlFor(agent, cwd));
    const c: AgentConn = {
      peer,
      cwd,
      sessions: new Set(),
      pendingPermissions: new Map(),
      pendingElicitations: new Map(),
      restartExpected: false,
      initialized: false,
    };
    this.pool.set(agent, c);

    peer.notify('session/update', (params) => {
      const p = (params ?? {}) as { sessionId?: string; update?: SessionUpdate };
      if (p.sessionId && p.update) this.handlers.onUpdate?.(p.sessionId, p.update);
    });
    peer.handle('session/request_permission', (params) => this.onInboundPermission(c, params));
    peer.handle('elicitation/create', (params) => this.onInboundElicitation(c, params));

    // Extension notifications from server (log tail, stall detection, live terminal output).
    peer.notify('_ext/log', (params) => {
      const p = (params ?? {}) as { stream?: string; text?: string };
      this.handlers.onLog?.(p.stream ?? '', p.text ?? '', agent);
    });
    peer.notify('_ext/stalled', (params) => {
      const p = (params ?? {}) as { sessionId?: string; secondsIdle?: number };
      if (p.sessionId != null && p.secondsIdle != null) this.handlers.onStalled?.(p.sessionId, p.secondsIdle);
    });
    peer.notify('_ext/terminal_output', (params) => {
      const p = (params ?? {}) as { sessionId?: string; terminalId?: string; output?: string };
      if (p.terminalId && p.output != null) this.handlers.onTerminalOutput?.(p.sessionId ?? '', p.terminalId, p.output);
    });

    peer.onClose = ({ code, reason }) => this.onSocketClose(agent, c, code, reason);

    // WsJsonRpc queues messages sent while CONNECTING, so we can kick off the
    // handshake immediately without waiting for onOpen.
    peer
      .request<{
        protocolVersion: number;
        agentCapabilities?: AgentCapabilities;
        agentInfo?: InitializedInfo['agentInfo'];
        authMethods?: InitializedInfo['authMethods'];
      }>('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          elicitation: { form: {} },
        },
        clientInfo: { name: 'kairos', title: 'Kairos', version: KAIROS_VERSION },
      })
      .then((info) => {
        c.initialized = true;
        this.handlers.onInitialized?.({
          connectionId: '',
          agentId: agent,
          protocolVersion: info.protocolVersion,
          agentCapabilities: info.agentCapabilities,
          agentInfo: info.agentInfo,
          authMethods: info.authMethods ?? [],
        });
      })
      .catch((err: unknown) => {
        // If the socket died before initialize resolved, onSocketClose owns the
        // report (it has the close code + reason). Skip the generic message.
        if (isSocketClose(err)) return;
        this.handlers.onError?.(errorDetails(err), undefined, agent);
      });
  }

  private onSocketClose(agent: string, c: AgentConn, code: number, reason: string): void {
    // Drop from pool if we're still the owner. A fresh connect may have already
    // replaced us with a new AgentConn entry.
    if (this.pool.get(agent) === c) this.pool.delete(agent);

    if (code === CLOSE_BAD_UPGRADE) {
      this.handlers.onError?.(reason || `Cannot connect to ${agent}`, undefined, agent);
      return;
    }

    if (c.restartExpected) {
      this.handlers.onAgentRestarted?.(agent);
      return;
    }

    // The bridge encodes an agent exit as `agent-exit code=N[: <stderr detail>]`.
    // Peel the detail off once for both branches below.
    const detail = cleanCloseReason(reason);

    if (!c.initialized) {
      // Connect failed before the handshake completed — surface the real cause
      // (the agent's stderr tail, e.g. an expired-auth message) rather than the
      // generic "websocket closed" the pending initialize request would carry.
      // `cleanCloseReason` passes non-agent-exit reasons through verbatim, so a
      // bare `agent-exit code=N` with no stderr becomes '' → friendly fallback.
      this.handlers.onError?.(detail || 'Agent connection closed', undefined, agent);
      return;
    }

    // Post-initialize close → agent exit. Pull the exit code out of the reason.
    const codeFromReason = /code=(-?\d+|null)/.exec(reason)?.[1];
    const exitCode = codeFromReason && codeFromReason !== 'null' ? Number(codeFromReason) : null;
    this.handlers.onExit?.(code === CLOSE_AGENT_EXIT ? exitCode : null, agent, detail || undefined);
  }

  private onInboundPermission(c: AgentConn, params: RpcParams): Promise<unknown> {
    const p = (params ?? {}) as {
      sessionId?: string;
      toolCall?: ToolCall;
      options?: PermissionOption[];
    };
    const requestId = newRequestId();
    // The Promise stays pending until the UI answers via resolvePermission,
    // whose resolver is captured in the pool entry's map.
    return new Promise<unknown>((resolve) => {
      c.pendingPermissions.set(requestId, (outcome) => resolve({ outcome }));
      this.handlers.onPermissionRequest?.({
        requestId,
        sessionId: p.sessionId ?? '',
        toolCall: p.toolCall as ToolCall,
        options: p.options ?? [],
      });
    });
  }

  private onInboundElicitation(c: AgentConn, params: RpcParams): Promise<unknown> {
    const p = (params ?? {}) as {
      sessionId?: string;
      message?: string;
      requestedSchema?: ElicitationSchema;
      toolCallId?: string;
    };
    const requestId = newRequestId();
    return new Promise<unknown>((resolve) => {
      c.pendingElicitations.set(requestId, (response) => resolve(response));
      this.handlers.onElicitationRequest?.({
        requestId,
        sessionId: p.sessionId ?? '',
        message: p.message ?? '',
        requestedSchema: p.requestedSchema ?? ({} as ElicitationSchema),
        toolCallId: p.toolCallId,
      });
    });
  }

  private connForSession(sessionId: string): AgentConn | null {
    for (const [, c] of this.pool) if (c.sessions.has(sessionId)) return c;
    return null;
  }
}

export { errorDetails, RpcError };
