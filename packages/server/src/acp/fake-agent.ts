import {
  Methods,
  type InitializeResult,
  type SessionNewResult,
  type SessionPromptParams,
  type SessionPromptResult,
  type SessionUpdateParams,
  type RequestPermissionResult,
} from '@kairos/protocol';
import type { AcpAgent, Peer } from './peer.js';

export interface FakeAcpAgentOptions {
  /** Delay between streamed message chunks, ms (default 0). */
  chunkDelayMs?: number;
  /**
   * When true, the agent originates a session/request_permission back to the
   * client before answering the prompt, exercising the bidirectional path.
   */
  requestPermission?: boolean;
}

// A deterministic, network-free ACP agent for standing up and testing the /acp
// transport end-to-end without a real agent binary (transport-integration-spec
// §4, §5 Phase B/D). It implements the agent side of the ACP contract:
// initialize → session/new → session/prompt (streams session/update chunks,
// optionally requests permission) → returns a stopReason.
export class FakeAcpAgent implements AcpAgent {
  private sessions = new Set<string>();
  private seq = 0;
  private cancelled = new Set<string>();

  constructor(private opts: FakeAcpAgentOptions = {}) {}

  async handleRequest(method: string, params: Record<string, unknown>, peer: Peer): Promise<unknown> {
    switch (method) {
      case Methods.INITIALIZE:
        return this.initialize();
      case Methods.AUTHENTICATE:
        return {};
      case Methods.SESSION_NEW:
        return this.sessionNew();
      case Methods.SESSION_LOAD:
        return { modes: undefined, configOptions: [] };
      case Methods.SESSION_PROMPT:
        return this.sessionPrompt(params as unknown as SessionPromptParams, peer);
      case Methods.SESSION_SET_CONFIG_OPTION:
        return { configOptions: [] };
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === Methods.SESSION_CANCEL) {
      const sessionId = (params as { sessionId?: string }).sessionId;
      if (sessionId) this.cancelled.add(sessionId);
    }
  }

  // ─── handlers ─────────────────────────────────────────────────────────────

  private initialize(): InitializeResult {
    return {
      protocolVersion: 1,
      agentInfo: { name: 'fake-acp-agent', title: 'Fake ACP Agent', version: '1.0.0' },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
      authMethods: [],
    };
  }

  private sessionNew(): SessionNewResult {
    const sessionId = `fake-sess-${++this.seq}`;
    this.sessions.add(sessionId);
    return { sessionId, configOptions: [] };
  }

  private async sessionPrompt(params: SessionPromptParams, peer: Peer): Promise<SessionPromptResult> {
    const { sessionId, prompt } = params;
    this.cancelled.delete(sessionId);

    const text = prompt
      .map((b) => (b.type === 'text' ? (b as { text: string }).text : `[${b.type}]`))
      .join(' ')
      .trim();

    if (this.opts.requestPermission) {
      const outcome = await peer.request<RequestPermissionResult>(Methods.SESSION_REQUEST_PERMISSION, {
        sessionId,
        toolCall: { toolCallId: `tc-${this.seq}`, title: 'run tool', kind: 'execute' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });
      const answer = extractOptionId(outcome);
      if (answer === 'reject') {
        this.emitMessage(peer, sessionId, 'Permission denied — stopping.');
        return { stopReason: 'refusal' };
      }
    }

    const reply = `[fake] You said: "${text || '(empty)'}"`;
    const words = reply.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (this.cancelled.has(sessionId)) {
        return { stopReason: 'cancelled' };
      }
      if (this.opts.chunkDelayMs) await delay(this.opts.chunkDelayMs);
      this.emitChunk(peer, sessionId, i === 0 ? words[i] : ` ${words[i]}`);
    }

    return {
      stopReason: 'end_turn',
      usage: { inputTokens: roughTokens(text), outputTokens: roughTokens(reply), totalTokens: roughTokens(text) + roughTokens(reply) },
    };
  }

  private emitChunk(peer: Peer, sessionId: string, text: string): void {
    const params: SessionUpdateParams = {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    };
    peer.notify(Methods.SESSION_UPDATE, params as unknown as Record<string, unknown>);
  }

  private emitMessage(peer: Peer, sessionId: string, text: string): void {
    this.emitChunk(peer, sessionId, text);
  }
}

function extractOptionId(outcome: unknown): string | undefined {
  if (outcome && typeof outcome === 'object') {
    const o = outcome as { outcome?: { optionId?: string }; optionId?: string };
    return o.outcome?.optionId ?? o.optionId;
  }
  return undefined;
}

function roughTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
