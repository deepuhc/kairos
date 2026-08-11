import {
  Methods,
  type InitializeResult,
  type SessionNewResult,
  type SessionPromptParams,
  type SessionPromptResult,
  type SessionUpdateParams,
} from '@kairos/protocol';
import type { SmartRouter } from '@kairos/providers';
import type { AcpAgent, Peer } from './peer.js';
import { SessionStore } from './session-store.js';

export interface ProviderAcpAgentOptions {
  /** The shared router that selects a provider/model and streams the reply. */
  router: SmartRouter;
  /** Enable extended/adaptive thinking, surfaced as agent_thought_chunk frames. */
  thinking?: boolean;
  /**
   * Session state shared across connections. AcpServer builds a fresh agent per
   * WebSocket, so this must be shared for session/load (resume) to work and for
   * session ids to stay unique process-wide. Defaults to a private store when
   * omitted (single-connection/test use).
   */
  sessions?: SessionStore;
}

// A real ACP agent backed by the provider layer. Where FakeAcpAgent just echoes,
// this drives every prompt through the shared SmartRouter — so with the mock
// provider enabled the whole registry → router → provider → session/update path
// runs end-to-end, and swapping in a real provider (Anthropic/Ollama/…) needs no
// change here. It implements the agent side of the ACP contract:
// initialize → session/new → session/prompt (streams the provider's chunks as
// session/update frames, honoring session/cancel) → returns a stopReason + usage.
export class ProviderAcpAgent implements AcpAgent {
  // Session history + id generation live in a store shared across connections,
  // so session/load resumes real context and ids stay unique process-wide.
  private readonly sessions: SessionStore;
  // Sessions with a pending cancel; the streaming loop checks and bails out.
  private cancelled = new Set<string>();

  constructor(private opts: ProviderAcpAgentOptions) {
    this.sessions = opts.sessions ?? new SessionStore();
  }

  async handleRequest(method: string, params: Record<string, unknown>, peer: Peer): Promise<unknown> {
    switch (method) {
      case Methods.INITIALIZE:
        return this.initialize();
      case Methods.AUTHENTICATE:
        return {};
      case Methods.SESSION_NEW:
        return this.sessionNew();
      case Methods.SESSION_LOAD:
        return this.sessionLoad(params as { sessionId?: string });
      case Methods.SESSION_PROMPT:
        return this.sessionPrompt(params as unknown as SessionPromptParams, peer);
      case Methods.SESSION_SET_CONFIG_OPTION:
        return { configOptions: [] };
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  handleNotification(method: string, params: Record<string, unknown>, _peer?: Peer): void {
    if (method === Methods.SESSION_CANCEL) {
      const sessionId = (params as { sessionId?: string }).sessionId;
      if (sessionId) this.cancelled.add(sessionId);
    }
  }

  // ─── handlers ─────────────────────────────────────────────────────────────

  private initialize(): InitializeResult {
    return {
      protocolVersion: 1,
      agentInfo: { name: 'kairos-provider-agent', title: 'Kairos Provider Agent', version: '1.0.0' },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
      authMethods: [],
    };
  }

  private sessionNew(): SessionNewResult {
    const { sessionId } = this.sessions.create();
    return { sessionId, configOptions: [] };
  }

  private sessionLoad(params: { sessionId?: string }): SessionNewResult | null {
    const sessionId = params.sessionId;
    if (!sessionId) return null;
    this.sessions.load(sessionId); // ensure it exists / resume its history
    return { sessionId, configOptions: [] };
  }

  private async sessionPrompt(params: SessionPromptParams, peer: Peer): Promise<SessionPromptResult> {
    const { sessionId, prompt } = params;
    this.cancelled.delete(sessionId);

    const text = prompt
      .map((b) => (b.type === 'text' ? (b as { text: string }).text : `[${b.type}]`))
      .join(' ')
      .trim();

    const messages = this.sessions.get(sessionId) ?? this.sessions.load(sessionId);
    messages.push({ role: 'user', content: text });

    const controller = new AbortController();
    let assistant = '';
    let usage: SessionPromptResult['usage'];

    try {
      const stream = this.opts.router.streamChunks(messages, {
        thinking: this.opts.thinking,
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        if (this.cancelled.has(sessionId)) {
          controller.abort();
          this.sessions.set(sessionId, messages); // keep the user turn
          return { stopReason: 'cancelled' };
        }
        switch (chunk.type) {
          case 'thinking':
            this.emit(peer, sessionId, 'agent_thought_chunk', chunk.text);
            break;
          case 'text':
            assistant += chunk.text;
            this.emit(peer, sessionId, 'agent_message_chunk', chunk.text);
            break;
          case 'usage':
            usage = {
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              totalTokens: chunk.inputTokens + chunk.outputTokens,
            };
            break;
          case 'error':
            this.emit(peer, sessionId, 'agent_message_chunk', `\n[error] ${chunk.message}`);
            messages.push({ role: 'assistant', content: assistant });
            this.sessions.set(sessionId, messages);
            return { stopReason: 'error' };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit(peer, sessionId, 'agent_message_chunk', `\n[error] ${message}`);
      return { stopReason: 'error' };
    }

    messages.push({ role: 'assistant', content: assistant });
    this.sessions.set(sessionId, messages);
    return { stopReason: 'end_turn', usage };
  }

  // (no adapter needed — SmartRouter.streamChunks always yields typed chunks)

  private emit(
    peer: Peer,
    sessionId: string,
    kind: 'agent_message_chunk' | 'agent_thought_chunk',
    text: string,
  ): void {
    const params: SessionUpdateParams = {
      sessionId,
      update: { sessionUpdate: kind, content: { type: 'text', text } },
    };
    peer.notify(Methods.SESSION_UPDATE, params as unknown as Record<string, unknown>);
  }
}
