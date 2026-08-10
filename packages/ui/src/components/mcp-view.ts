import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { focusRing } from '../styles/focus.js';
import { renderDeleteButton, confirmDeleteStyles } from './confirm-delete.js';
import {
  getMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, installMcpPreset,
  importClaudeMcpServers,
  type McpServerInput, type ExternalMcpServerSource,
} from '../services/api.js';

// MCP servers manager — stdio Model Context Protocol servers that expose extra
// tools to agents. Stored globally in ~/.kairos/config.json and injected into
// every agent session server-side (session/new & session/load). Two-pane: left
// rail lists saved servers, right pane edits the selected one.

// Known MCP servers, surfaced as one-click "Quick add" chips. Clicking a chip
// asks the backend to download the server binary for this platform and save the
// config entry automatically. If auto-install can't run (unsupported platform,
// no network), we fall back to pre-filling the create form with these defaults
// plus a setup note so the user can finish manually.
interface McpPreset {
  /** Matches the backend preset key. */
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  note: string;
  docUrl?: string;
}

const PRESETS: McpPreset[] = [
  {
    id: 'matlab',
    label: 'MATLAB',
    command: 'matlab-mcp-server',
    args: ['--matlab-session-mode=existing'],
    note:
      'Gives agents a live MATLAB session — run code, read the workspace, generate plots. ' +
      'After install, run this once in a terminal to enable session sharing:\n' +
      '  matlab-mcp-server --setup-matlab --matlab-root=/path/to/MATLAB\n' +
      'Then in your MATLAB Command Window run shareMATLABSession() (or add it to startup.m). ' +
      'Keep --matlab-root in the setup command only; the saved runtime args should attach ' +
      'to that desktop instead of launching a duplicate.',
    docUrl: 'https://github.com/matlab/matlab-mcp-server',
  },
];

function slug(label: string, existing: McpServerInput[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp';
  let id = base;
  let n = 2;
  while (existing.some((m) => m.id === id)) id = `${base}-${n++}`;
  return id;
}

@customElement('kairos-mcp')
export class DevaiMcp extends LitElement {
  @state() private servers: McpServerInput[] = [];
  @state() private externalServers: ExternalMcpServerSource[] = [];
  @state() private selected: string | null = null;
  @state() private creating = false;
  @state() private labelDraft = '';
  @state() private idDraft = '';
  @state() private commandDraft = '';
  @state() private argsDraft = '';
  @state() private envDraft = '';
  @state() private loading = true;
  @state() private saving = false;
  @state() private error: string | null = null;
  @state() private savedFlash = false;
  @state() private confirmingDelete = false;
  @state() private presetNote: { note: string; docUrl?: string } | null = null;
  @state() private installingPreset: string | null = null;
  @state() private importingClaude = false;
  @state() private importStatus: string | null = null;

  static styles = [focusRing, confirmDeleteStyles, css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
      margin: 0 0 4px;
    }
    .subtitle { color: var(--gray); font-size: var(--font-size-sm); margin-bottom: 16px; max-width: 760px; line-height: 1.5; }
    .subtitle code { font-family: var(--font-mono); color: var(--purple-light); }
    .err { color: var(--red); font-size: var(--font-size-sm); margin-bottom: 8px; }
    .external {
      max-width: 760px;
      margin: 0 0 16px;
      padding: 12px 14px;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a15);
      color: var(--gray);
      font-size: var(--font-size-sm);
      line-height: 1.5;
    }
    .external strong { color: var(--bright-white); font-weight: 600; }
    .external code { font-family: var(--font-mono); color: var(--accent); }
    .external-source { margin-top: 4px; color: var(--neutral-gray); }
    .external-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
    .import-status { color: var(--emerald); font-size: var(--font-size-xs); }
    .layout { display: grid; grid-template-columns: var(--rail-width) 1fr; gap: 16px; align-items: start; }
    .rail { display: flex; flex-direction: column; gap: 6px; }
    .new-btn {
      padding: 10px 12px;
      border: 1px dashed var(--glass-border);
      border-radius: var(--radius);
      background: transparent;
      color: var(--purple-light);
      font-size: var(--font-size-md);
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .new-btn:hover { border-color: var(--accent-a35); background: var(--accent-a15); }
    .quick-add { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 2px 0 4px; }
    .quick-add-label { font-size: var(--font-size-xs); color: var(--neutral-gray); text-transform: uppercase; letter-spacing: 0.5px; width: 100%; }
    .preset-chip {
      padding: 4px 10px;
      border: 1px solid var(--glass-border);
      border-radius: 999px;
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-xs);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .preset-chip:hover:not(:disabled) { border-color: var(--accent-a35); background: var(--accent-a15); color: var(--purple-light); }
    .preset-chip:disabled { cursor: default; opacity: 0.7; }
    .preset-chip.installed { color: var(--emerald); border-color: var(--emerald); opacity: 1; }
    .preset-note {
      padding: 10px 12px;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a15);
      font-size: var(--font-size-sm);
      color: var(--gray);
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .preset-note a { color: var(--purple-light); text-decoration: none; font-size: var(--font-size-xs); }
    .preset-note a:hover { text-decoration: underline; }
    .server-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .server-item:hover { background: var(--glass-bg-hover); }
    .server-item.active { border-color: var(--accent-a35); background: var(--accent-a15); }
    .server-label { font-size: var(--font-size-sm); color: var(--bright-white); font-weight: 500; }
    .server-cmd { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--neutral-gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .editor { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    label { font-size: var(--font-size-xs); color: var(--gray); text-transform: uppercase; letter-spacing: 0.5px; }
    label .hint-inline { text-transform: none; letter-spacing: 0; color: var(--neutral-gray); }
    input, textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
    }
    input:focus, textarea:focus { outline: none; border-color: var(--accent-a35); }
    input.mono, textarea { font-family: var(--font-mono); font-size: var(--font-size-sm); }
    textarea {
      min-height: 60px;
      resize: vertical;
      line-height: 1.5;
    }
    .actions { display: flex; align-items: center; gap: 10px; }
    .btn {
      padding: 8px 16px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .btn:hover:not(:disabled) { border-color: var(--accent-a35); background: var(--accent-a15); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.primary { background: var(--accent-a25); color: var(--purple-light); border-color: var(--accent-a35); }
    .btn.danger { color: var(--red); }
    .btn.danger:hover:not(:disabled) { background: var(--red-a15, rgba(239,68,68,0.12)); border-color: var(--red); }
    .saved { color: var(--emerald); font-size: var(--font-size-sm); }
    .hint { font-size: var(--font-size-xs); color: var(--neutral-gray); line-height: 1.5; }
    .hint code { font-family: var(--font-mono); color: var(--purple-light); }
    .empty { padding: 32px; text-align: center; color: var(--gray); }
    .loading { padding: 32px; text-align: center; color: var(--gray); }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  private async load() {
    this.loading = true;
    this.error = null;
    try {
      const res = await getMcpServers();
      this.servers = res.servers;
      this.externalServers = res.externalServers ?? [];
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  private get active(): McpServerInput | undefined {
    return this.servers.find((m) => m.id === this.selected);
  }

  private select(id: string) {
    const m = this.servers.find((x) => x.id === id);
    if (!m) return;
    this.creating = false;
    this.confirmingDelete = false;
    this.selected = id;
    this.idDraft = m.id;
    this.labelDraft = m.label;
    this.commandDraft = m.command;
    this.argsDraft = m.args.join(' ');
    this.envDraft = Object.entries(m.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
    this.presetNote = null;
    this.error = null;
  }

  private startNew() {
    this.creating = true;
    this.selected = null;
    this.idDraft = '';
    this.labelDraft = '';
    this.commandDraft = '';
    this.argsDraft = '';
    this.envDraft = '';
    this.presetNote = null;
    this.error = null;
  }

  // One-click install: ask the backend to download the binary and save the
  // entry. If it's already configured, just select it. If auto-install isn't
  // possible (unsupported platform / offline), drop into the manual pre-fill.
  private async addPreset(p: McpPreset) {
    const existing = this.servers.find((m) => m.id === p.id);
    if (existing) { this.select(existing.id); return; }

    this.installingPreset = p.id;
    this.error = null;
    try {
      const res = await installMcpPreset(p.id);
      if (res.ok) {
        this.servers = [...this.servers, res.server];
        this.creating = false;
        this.presetNote = null;
        this.select(res.server.id);
        this.savedFlash = true;
        setTimeout(() => { this.savedFlash = false; }, 1800);
      } else if (res.fallbackToManual) {
        this.prefillPreset(p);
        this.error = `${res.error} — fill in the command below to finish.`;
      } else {
        this.error = res.error;
      }
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.installingPreset = null;
    }
  }

  private prefillPreset(p: McpPreset) {
    this.creating = true;
    this.selected = null;
    this.idDraft = '';
    this.labelDraft = p.label;
    this.commandDraft = p.command;
    this.argsDraft = p.args.join(' ');
    this.envDraft = Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
    this.presetNote = { note: p.note, docUrl: p.docUrl };
  }

  private async save() {
    const label = this.labelDraft.trim();
    const command = this.commandDraft.trim();
    const args = this.argsDraft.trim().split(/\s+/).filter(Boolean);
    if (!label) { this.error = 'Display name is required.'; return; }
    if (!command) { this.error = 'Command is required.'; return; }

    const env: Record<string, string> = {};
    for (const line of this.envDraft.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const eq = line.indexOf('=');
      if (eq < 1) { this.error = `Bad env line (need KEY=VALUE): ${line}`; return; }
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const body = { label, command, args, env: Object.keys(env).length ? env : undefined };

    this.saving = true;
    this.error = null;
    try {
      if (this.creating) {
        const id = slug(label, this.servers);
        const res = await createMcpServer({ id, ...body });
        this.servers = [...this.servers, res.server];
        this.creating = false;
        this.selected = id;
        this.idDraft = id;
      } else if (this.selected) {
        const res = await updateMcpServer(this.selected, body);
        this.servers = this.servers.map((m) => (m.id === this.selected ? res.server : m));
      }
      this.savedFlash = true;
      setTimeout(() => { this.savedFlash = false; }, 1800);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  private async deleteEntry() {
    const m = this.active;
    if (!m) return;
    this.saving = true;
    this.error = null;
    try {
      await deleteMcpServer(m.id);
      this.servers = this.servers.filter((x) => x.id !== m.id);
      this.selected = null;
      this.confirmingDelete = false;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  private async importClaudeMcp() {
    this.importingClaude = true;
    this.error = null;
    this.importStatus = null;
    try {
      const res = await importClaudeMcpServers();
      this.servers = res.servers;
      this.externalServers = res.externalServers ?? this.externalServers;
      if (res.imported.length > 0) {
        this.importStatus =
          `Imported ${res.imported.length} ${res.imported.length === 1 ? 'server' : 'servers'} into Kairos. ` +
          'They are now agent-agnostic for new Claude, Codex, Gemini, and custom-agent sessions.';
        this.savedFlash = true;
        setTimeout(() => { this.savedFlash = false; }, 1800);
      } else if (res.skipped.length > 0) {
        this.importStatus = 'No new servers imported; detected Claude MCP servers already exist in Kairos.';
      } else {
        this.importStatus = 'No importable Claude MCP servers were found.';
      }
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.importingClaude = false;
    }
  }

  render() {
    if (this.loading) return html`<h2>MCP Servers</h2><div class="loading">Loading…</div>`;
    const editing = this.creating || !!this.active;
    return html`
      <h2>MCP Servers</h2>
      <div class="subtitle">
        Connect external tools to your agents via the Model Context Protocol. Each server is a
        local command (e.g. <code>npx -y @modelcontextprotocol/server-filesystem</code>) that
        exposes extra tools — filesystem access, web search, a database client. Use
        <strong>Quick add</strong> to install a known server in one click, or add your own.
        Configured servers are global: they're injected into every agent session automatically.
      </div>
      ${this.renderExternalServers()}
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}
      <div class="layout">
        <div class="rail">
          <button class="new-btn" @click=${this.startNew}>+ New server</button>
          <div class="quick-add">
            <span class="quick-add-label">Quick add</span>
            ${PRESETS.map((p) => {
              const installed = this.servers.some((m) => m.id === p.id);
              const installing = this.installingPreset === p.id;
              return html`
                <button
                  class="preset-chip ${installed ? 'installed' : ''}"
                  ?disabled=${installing || this.installingPreset !== null}
                  title=${installed ? `${p.label} is configured` : `Install ${p.label}`}
                  @click=${() => this.addPreset(p)}
                >
                  ${installing ? 'Installing…' : installed ? `✓ ${p.label}` : `+ ${p.label}`}
                </button>
              `;
            })}
          </div>
          ${this.servers.length === 0 && !this.creating
            ? html`<div class="hint" style="padding: 8px 4px;">No Kairos MCP servers yet.</div>`
            : nothing}
          ${this.servers.map((m) => html`
            <div class="server-item ${m.id === this.selected ? 'active' : ''}" @click=${() => this.select(m.id)}>
              <span class="server-label">${m.label}</span>
              <span class="server-cmd">${m.command}${m.args.length ? ' ' + m.args.join(' ') : ''}</span>
            </div>
          `)}
        </div>
        <div class="editor">
          ${editing ? this.renderEditor() : html`<div class="empty">Select a server, or create a new one.</div>`}
        </div>
      </div>
    `;
  }

  private renderExternalServers() {
    if (this.externalServers.length === 0) return nothing;
    const total = this.externalServers.reduce((sum, source) => sum + source.count, 0);
    const sourceText = this.externalServers
      .map((source) => `${source.count} in ${source.scope} ${source.source}`)
      .join(', ');
    return html`
      <div class="external">
        <strong>Found ${total} Claude-native MCP ${total === 1 ? 'server' : 'servers'}.</strong>
        These are configured outside Kairos from ${sourceText}. Importing copies supported
        Claude stdio MCP definitions into Kairos's global config, which makes them agent-agnostic:
        future Claude, Codex, Gemini, and custom-agent sessions can all use them without separate
        per-agent setup.
        ${this.externalServers.map((source) => html`
          <div class="external-source">
            <code>${source.path}</code>: ${source.serverNames.join(', ')}
          </div>
        `)}
        <div class="external-actions">
          <button class="btn primary" ?disabled=${this.importingClaude} @click=${this.importClaudeMcp}>
            ${this.importingClaude ? 'Importing…' : 'Import Claude MCP into Kairos'}
          </button>
          ${this.importStatus ? html`<span class="import-status">${this.importStatus}</span>` : nothing}
        </div>
      </div>
    `;
  }

  private renderEditor() {
    return html`
      ${this.presetNote ? html`
        <div class="preset-note">
          <div>${this.presetNote.note}</div>
          ${this.presetNote.docUrl ? html`
            <a href=${this.presetNote.docUrl} target="_blank" rel="noopener">Setup instructions ↗</a>
          ` : nothing}
        </div>
      ` : nothing}
      <label>Display name</label>
      <input
        placeholder="Filesystem"
        .value=${this.labelDraft}
        @input=${(e: Event) => { this.labelDraft = (e.target as HTMLInputElement).value; }}
      />
      ${!this.creating ? html`
        <label>ID</label>
        <input class="mono" .value=${this.idDraft} disabled />
      ` : nothing}
      <label>Command</label>
      <input
        class="mono"
        placeholder="npx"
        .value=${this.commandDraft}
        @input=${(e: Event) => { this.commandDraft = (e.target as HTMLInputElement).value; }}
      />
      <label>Arguments <span class="hint-inline">(space-separated)</span></label>
      <input
        class="mono"
        placeholder="-y @modelcontextprotocol/server-filesystem /path"
        .value=${this.argsDraft}
        @input=${(e: Event) => { this.argsDraft = (e.target as HTMLInputElement).value; }}
      />
      <label>Environment <span class="hint-inline">(KEY=VALUE per line, optional)</span></label>
      <textarea
        placeholder="API_KEY=..."
        .value=${this.envDraft}
        @input=${(e: Event) => { this.envDraft = (e.target as HTMLTextAreaElement).value; }}
      ></textarea>
      <div class="hint">
        The server is launched on demand for each session and its tools become available to the
        agent. Changes apply to sessions started after you save.
      </div>
      <div class="actions">
        <button class="btn primary" ?disabled=${this.saving || !this.labelDraft.trim() || !this.commandDraft.trim()} @click=${this.save}>
          ${this.saving ? 'Saving…' : this.creating ? 'Create' : 'Save'}
        </button>
        ${!this.creating && this.active ? renderDeleteButton({
          confirming: this.confirmingDelete,
          saving: this.saving,
          label: 'Remove',
          onArm: () => { this.confirmingDelete = true; },
          onConfirm: () => this.deleteEntry(),
          onCancel: () => { this.confirmingDelete = false; },
        }) : nothing}
        ${this.savedFlash ? html`<span class="saved">✓ Saved</span>` : nothing}
      </div>
    `;
  }
}
