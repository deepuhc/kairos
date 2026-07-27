import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { store, type AgentState } from "./lib/store.js";
import { ACPClient, WebSocketTransport, type PermissionRequest, type PermissionResponse } from "./lib/acp/index.js";
import { analyzeTask, executeOrchestration } from "./lib/coordinator-bridge.js";
import "./components/sidebar/agent-sidebar.js";
import "./components/chat/chat-panel.js";
import "./components/permissions/permission-modal.js";
import "./components/shared/new-agent-dialog.js";

const ACP_PROXY_URL = "ws://localhost:9222";

@customElement("kairos-app")
export class KairosApp extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: var(--sidebar-width) 1fr;
      grid-template-rows: var(--header-height) 1fr;
      height: 100vh;
      width: 100vw;
    }

    header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      padding: 0 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      gap: 12px;
      -webkit-app-region: drag;
    }

    .logo {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--amber);
      -webkit-app-region: no-drag;
    }

    .logo span {
      color: var(--text-dim);
      font-weight: 400;
      font-size: 0.8rem;
      margin-left: 8px;
    }

    .status {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 6px;
      -webkit-app-region: no-drag;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-dot[data-connected] { background: var(--green); }
    .status-dot:not([data-connected]) { background: var(--red); }

    aside {
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 12px;
      overflow-y: auto;
    }

    main {
      display: flex;
      flex-direction: column;
      background: var(--bg);
      overflow: hidden;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-dim);
    }

    .empty-state h2 {
      font-size: 1.1rem;
      font-weight: 500;
      color: var(--text);
    }

    .empty-state p {
      font-size: 0.85rem;
      max-width: 320px;
      text-align: center;
      line-height: 1.5;
    }

    .shortcut {
      margin-top: 16px;
      padding: 6px 12px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-dim);
    }
  `;

  @state() private agents: AgentState[] = [];
  @state() private activeId: string | null = null;
  @state() private connected = false;
  @state() private permissionRequest: PermissionRequest | null = null;
  @state() private showNewAgentDialog = false;
  @state() private newAgentError = "";

  private client: ACPClient | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    store.subscribe(() => this.syncState());
    this.connectProxy();

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        if (!this.showNewAgentDialog) {
          this.handleNewAgent();
        }
      }
    });
  }

  private syncState(): void {
    this.agents = [...store.agents.values()];
    this.activeId = store.activeAgentId;
    const requests = store.permissionRequests;
    this.permissionRequest = requests.length > 0 ? requests[0] : null;
  }

  private async connectProxy(): Promise<void> {
    try {
      const transport = await WebSocketTransport.connect(ACP_PROXY_URL);
      this.client = new ACPClient(transport, {
        onUpdate: (sessionId, update) => store.handleUpdate(sessionId, update),
        onPermissionRequest: (req) => store.addPermissionRequest(req),
        onError: (err) => console.error("[acp]", err),
        onClose: () => {
          this.connected = false;
          this.client = null;
        },
      });
      await this.client.initialize();
      this.connected = true;
    } catch {
      this.connected = false;
      this.client = null;
    }
  }

  private handleNewAgent(): void {
    this.newAgentError = "";
    this.showNewAgentDialog = true;
  }

  private async handleCreateAgent(e: CustomEvent<{ name: string; workingDirectory: string; model: { id: string; command: string; args: string[]; streamJson?: boolean } }>): Promise<void> {
    const { name, workingDirectory, model } = e.detail;

    if (!this.client) {
      await this.connectProxy();
    }
    if (!this.client) {
      this.newAgentError = "Cannot connect to proxy. Is it running? (start with ./start.sh)";
      return;
    }

    const agentId = store.createAgent(name || undefined);

    try {
      const session = await this.client.newSession({
        working_directory: workingDirectory || undefined,
        // Pass model config so the proxy knows what to spawn
        command: model.command,
        args: model.args,
        stream_json: model.streamJson ?? false,
      } as Record<string, unknown>);
      store.setSession(agentId, session.id);
      this.showNewAgentDialog = false;
    } catch (err) {
      store.removeAgent(agentId);
      this.newAgentError = err instanceof Error ? err.message : "Failed to create session";
    }
  }

  private handleCancelDialog(): void {
    this.showNewAgentDialog = false;
    this.newAgentError = "";
  }

  private async handleSend(e: CustomEvent<string>): Promise<void> {
    const text = e.detail;
    if (!this.client) {
      await this.connectProxy();
    }
    if (!this.client) return;

    const agent = store.activeAgent;

    if (agent?.sessionId) {
      store.addUserMessage(agent.id, text);
      await this.client.prompt(agent.sessionId, text);
      return;
    }

    const analysis = analyzeTask(text);

    if (analysis.complexity === "simple") {
      const agentId = agent?.id ?? store.createAgent();
      const session = await this.client.newSession();
      store.setSession(agentId, session.id);
      store.addUserMessage(agentId, text);
      await this.client.prompt(session.id, text);
    } else {
      await executeOrchestration(text, this.client);
    }
  }

  private handlePermissionResponse(e: CustomEvent<PermissionResponse>): void {
    if (!this.client) return;
    this.client.respondPermission(e.detail);
    store.resolvePermission(e.detail.id);
  }

  private handleSelectAgent(e: CustomEvent<string>): void {
    store.setActive(e.detail);
  }

  private handleCloseAgent(e: CustomEvent<string>): void {
    const agent = store.agents.get(e.detail);
    if (agent?.sessionId && this.client) {
      this.client.cancel(agent.sessionId);
    }
    store.removeAgent(e.detail);
  }

  render() {
    const active = this.activeId ? store.agents.get(this.activeId) : undefined;

    return html`
      <header>
        <div class="logo">Kairos<span>Desktop</span></div>
        <div class="status">
          <div class="status-dot" ?data-connected=${this.connected}></div>
          ${this.connected ? "Connected" : "Disconnected"}
        </div>
      </header>

      <aside>
        <agent-sidebar
          .agents=${this.agents}
          .activeId=${this.activeId}
          @new-agent=${this.handleNewAgent}
          @select=${this.handleSelectAgent}
          @close-agent=${this.handleCloseAgent}
        ></agent-sidebar>
      </aside>

      <main>
        ${active ? html`
          <chat-panel
            .messages=${active.messages}
            ?streaming=${active.status === "streaming"}
            .costUsd=${active.costUsd}
            .durationMs=${active.durationMs}
            @send=${this.handleSend}
          ></chat-panel>
        ` : html`
          <div class="empty-state">
            <h2>No active agents</h2>
            <p>Start a new agent to begin a conversation. Kairos will automatically orchestrate multi-agent workflows when needed.</p>
            <div class="shortcut">Cmd + N</div>
          </div>
        `}
      </main>

      <permission-modal
        .request=${this.permissionRequest}
        @permission-response=${this.handlePermissionResponse}
      ></permission-modal>

      <new-agent-dialog
        ?open=${this.showNewAgentDialog}
        .defaultName=${"Agent " + (this.agents.length + 1)}
        .error=${this.newAgentError}
        @create-agent=${this.handleCreateAgent}
        @cancel=${this.handleCancelDialog}
      ></new-agent-dialog>
    `;
  }
}
