import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { focusRing } from '../styles/focus.js';
import { renderDeleteButton, confirmDeleteStyles } from './confirm-delete.js';
import {
  getHooks, createHook, updateHook, deleteHook, importClaudeHooks,
  type HookInput, type HookEvent, type HookEventInfo, type ExternalHookSource, type ClaudeHookImportResult,
} from '../services/api.js';

// Hooks manager — user-defined shell commands fired on agent lifecycle events.
// Stored in ~/.kairos/config.json; the server runs them fire-and-forget when
// the matching event occurs in the Agents tab. Two-pane: left rail lists saved
// hooks, right pane edits the selected one (label, event, command).

const DEFAULT_EVENT: HookEvent = 'prompt-end';

const FALLBACK_EVENT_DETAILS: HookEventInfo[] = [
  { id: 'session-start', label: 'sessionStart', aliases: ['sessionStart'], description: 'A new agent session was created.' },
  { id: 'session-loaded', label: 'sessionLoaded', aliases: ['sessionLoaded'], description: 'A past session was resumed and finished replaying history.' },
  { id: 'prompt-start', label: 'preRun', aliases: ['preRun'], description: 'You sent a message; the agent is about to run.' },
  { id: 'prompt-end', label: 'postRun', aliases: ['postRun'], description: 'The agent finished its turn, was cancelled, or refused.' },
  { id: 'permission-request', label: 'permissionRequest', aliases: ['permissionRequest'], description: 'The agent paused to ask you to allow or deny a tool.' },
  { id: 'stalled', label: 'stalled', aliases: [], description: 'A turn has gone quiet for about 2 minutes.' },
  { id: 'agent-exit', label: 'agentExit', aliases: ['agentExit'], description: 'The agent subprocess exited.' },
];

function slug(label: string, existing: HookInput[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hook';
  let id = base;
  let n = 2;
  while (existing.some((h) => h.id === id)) id = `${base}-${n++}`;
  return id;
}

@customElement('kairos-hooks')
export class DevaiHooks extends LitElement {
  @state() private hooks: HookInput[] = [];
  @state() private events: HookEvent[] = [];
  @state() private eventDetails: HookEventInfo[] = FALLBACK_EVENT_DETAILS;
  @state() private externalHooks: ExternalHookSource[] = [];
  @state() private selected: string | null = null;
  @state() private labelDraft = '';
  @state() private eventDraft: HookEvent = DEFAULT_EVENT;
  @state() private commandDraft = '';
  @state() private creating = false;
  @state() private loading = true;
  @state() private saving = false;
  @state() private importingClaudeHooks = false;
  @state() private error: string | null = null;
  @state() private importMessage: string | null = null;
  @state() private savedFlash = false;
  @state() private confirmingDelete = false;

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
    .external-events { margin-top: 4px; color: var(--neutral-gray); }
    .external-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .import-result { color: var(--emerald); }
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
    .hook-item {
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
    .hook-item:hover { background: var(--glass-bg-hover); }
    .hook-item.active { border-color: var(--accent-a35); background: var(--accent-a15); }
    .hook-label { font-size: var(--font-size-sm); color: var(--bright-white); font-weight: 500; }
    .hook-event { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--neutral-gray); }
    .editor { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    label { font-size: var(--font-size-xs); color: var(--gray); text-transform: uppercase; letter-spacing: 0.5px; }
    input, textarea, select {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
    }
    input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent-a35); }
    textarea {
      min-height: 120px;
      resize: vertical;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.5;
    }
    .event-hint { font-size: var(--font-size-xs); color: var(--neutral-gray); margin-top: -4px; }
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
      const res = await getHooks();
      this.hooks = res.hooks;
      this.events = res.events;
      this.eventDetails = res.eventDetails?.length
        ? res.eventDetails
        : FALLBACK_EVENT_DETAILS.filter((event) => res.events.includes(event.id));
      this.externalHooks = res.externalHooks ?? [];
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  private eventInfo(event: HookEvent): HookEventInfo | undefined {
    return this.eventDetails.find((info) => info.id === event || info.aliases.includes(event));
  }

  private eventLabel(event: HookEvent): string {
    return this.eventInfo(event)?.label ?? event;
  }

  private eventDescription(event: HookEvent): string {
    return this.eventInfo(event)?.description ?? '';
  }

  private get importableClaudeHookCount(): number {
    return this.externalHooks.reduce((sum, source) => sum + (source.importableCount ?? 0), 0);
  }

  private get active(): HookInput | undefined {
    return this.hooks.find((h) => h.id === this.selected);
  }

  private select(id: string) {
    const h = this.hooks.find((x) => x.id === id);
    if (!h) return;
    this.creating = false;
    this.confirmingDelete = false;
    this.selected = id;
    this.labelDraft = h.label;
    this.eventDraft = h.event;
    this.commandDraft = h.command;
  }

  private startNew() {
    this.creating = true;
    this.selected = null;
    this.labelDraft = '';
    this.eventDraft = DEFAULT_EVENT;
    this.commandDraft = '';
  }

  private async save() {
    const label = this.labelDraft.trim();
    const command = this.commandDraft.trim();
    if (!label || !command) return;
    this.saving = true;
    this.error = null;
    try {
      if (this.creating) {
        const id = slug(label, this.hooks);
        const res = await createHook({ id, label, event: this.eventDraft, command });
        this.hooks = [...this.hooks, res.hook];
        this.creating = false;
        this.selected = id;
      } else if (this.selected) {
        const res = await updateHook(this.selected, { label, event: this.eventDraft, command });
        this.hooks = this.hooks.map((h) => (h.id === this.selected ? res.hook : h));
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
    const h = this.active;
    if (!h) return;
    this.saving = true;
    this.error = null;
    try {
      await deleteHook(h.id);
      this.hooks = this.hooks.filter((x) => x.id !== h.id);
      this.selected = null;
      this.confirmingDelete = false;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  private async importFromClaude() {
    this.importingClaudeHooks = true;
    this.error = null;
    this.importMessage = null;
    try {
      const result = await importClaudeHooks();
      await this.load();
      this.importMessage = this.importSummary(result);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.importingClaudeHooks = false;
    }
  }

  private importSummary(result: ClaudeHookImportResult): string {
    const parts: string[] = [];
    if (result.importedCount > 0) {
      parts.push(
        `Imported ${result.importedCount} ${result.importedCount === 1 ? 'hook' : 'hooks'} into Kairos. They are now agent-agnostic and will run for Claude, Codex, Gemini, and custom agents launched from Kairos.`,
      );
    } else if (result.duplicateCount > 0) {
      parts.push('Compatible Claude hooks were already imported into Kairos.');
    } else {
      parts.push('No compatible Claude lifecycle hooks were found to import.');
    }
    if (result.duplicateCount > 0 && result.importedCount > 0) {
      parts.push(`${result.duplicateCount} already ${result.duplicateCount === 1 ? 'exists' : 'exist'} and were not duplicated.`);
    }
    if (result.skippedCount > 0) {
      parts.push(`${result.skippedCount} Claude-only ${result.skippedCount === 1 ? 'hook was' : 'hooks were'} skipped because tool interception and notification semantics are not portable.`);
    }
    return parts.join(' ');
  }

  render() {
    if (this.loading) return html`<h2>Hooks</h2><div class="loading">Loading…</div>`;
    const editing = this.creating || !!this.active;
    return html`
      <h2>Hooks</h2>
      <div class="subtitle">
        Run a shell command when a Kairos agent lifecycle event fires — for example, post a
        desktop notification when a turn ends, log permission prompts to a file, or play a sound
        when the agent stalls. Hooks run fire-and-forget; exit codes and output are ignored.
        The event payload is piped to <code>stdin</code> as JSON and also exposed as
        <code>DEVAI_HOOK_*</code> environment variables.
      </div>
      ${this.renderExternalHooks()}
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}
      <div class="layout">
        <div class="rail">
          <button class="new-btn" @click=${this.startNew}>+ New hook</button>
          ${this.hooks.length === 0 && !this.creating
            ? html`<div class="hint" style="padding: 8px 4px;">No Kairos hooks yet.</div>`
            : nothing}
          ${this.hooks.map((h) => html`
            <div class="hook-item ${h.id === this.selected ? 'active' : ''}" @click=${() => this.select(h.id)}>
              <span class="hook-label">${h.label}</span>
              <span class="hook-event">on ${this.eventLabel(h.event)}</span>
            </div>
          `)}
        </div>
        <div class="editor">
          ${editing ? this.renderEditor() : html`<div class="empty">Select a hook, or create a new one.</div>`}
        </div>
      </div>
    `;
  }

  private renderExternalHooks() {
    if (this.externalHooks.length === 0) return nothing;
    const total = this.externalHooks.reduce((sum, source) => sum + source.count, 0);
    const importable = this.importableClaudeHookCount;
    const sourceText = this.externalHooks
      .map((source) => `${source.count} in ${source.scope} ${source.source}`)
      .join(', ');
    return html`
      <div class="external">
        <strong>Found ${total} Claude Code ${total === 1 ? 'hook' : 'hooks'}.</strong>
        These are agent-native hooks from ${sourceText}. Import compatible lifecycle hooks to copy
        them into Kairos as agent-agnostic hooks, so the same automation runs for Claude, Codex,
        Gemini, and custom agents launched from Kairos.
        ${importable > 0
          ? html`<div>${importable} ${importable === 1 ? 'hook can' : 'hooks can'} be imported. Claude tool-interception hooks stay Claude-only because Kairos cannot preserve their matchers or blocking behavior.</div>`
          : html`<div>No compatible lifecycle hooks were found to import. Claude tool-interception hooks remain Claude-only.</div>`}
        ${this.externalHooks.map((source) => html`
          <div class="external-events">
            <code>${source.path}</code>: ${source.eventCounts.map((entry) => `${entry.event} ${entry.count}`).join(', ')}
            ${source.importableCount ? html`(${source.importableCount} importable)` : nothing}
          </div>
        `)}
        <div class="external-actions">
          <button
            class="btn primary"
            ?disabled=${this.importingClaudeHooks || importable === 0}
            @click=${this.importFromClaude}
          >
            ${this.importingClaudeHooks ? 'Importing…' : 'Import compatible hooks'}
          </button>
          ${this.importMessage ? html`<span class="import-result">${this.importMessage}</span>` : nothing}
        </div>
      </div>
    `;
  }

  private renderEditor() {
    return html`
      <label>Label</label>
      <input
        placeholder="Ping when turn finishes"
        .value=${this.labelDraft}
        @input=${(e: Event) => { this.labelDraft = (e.target as HTMLInputElement).value; }}
      />
      <label>Event</label>
      <select
        .value=${this.eventDraft}
        @change=${(e: Event) => { this.eventDraft = (e.target as HTMLSelectElement).value as HookEvent; }}
      >
        ${this.events.map((ev) => html`
          <option value=${ev} ?selected=${ev === this.eventDraft}>${this.eventLabel(ev)}</option>
        `)}
      </select>
      <div class="event-hint">${this.eventDescription(this.eventDraft)}</div>
      <label>Shell command</label>
      <textarea
        placeholder=${'osascript -e \'display notification "Turn done" with title "kairos"\''}
        .value=${this.commandDraft}
        @input=${(e: Event) => { this.commandDraft = (e.target as HTMLTextAreaElement).value; }}
      ></textarea>
      <div class="hint">
        Runs through your shell — pipes, redirects, and <code>&amp;&amp;</code> work. The event JSON is on
        <code>stdin</code>; common fields are also on env vars (<code>DEVAI_HOOK_EVENT</code>,
        <code>DEVAI_HOOK_EVENT_LABEL</code>, <code>DEVAI_HOOK_AGENTID</code>, <code>DEVAI_HOOK_SESSIONID</code>, …).
      </div>
      <div class="actions">
        <button class="btn primary" ?disabled=${this.saving || !this.labelDraft.trim() || !this.commandDraft.trim()} @click=${this.save}>
          ${this.saving ? 'Saving…' : this.creating ? 'Create' : 'Save'}
        </button>
        ${!this.creating && this.active ? renderDeleteButton({
          confirming: this.confirmingDelete,
          saving: this.saving,
          onArm: () => { this.confirmingDelete = true; },
          onConfirm: () => this.deleteEntry(),
          onCancel: () => { this.confirmingDelete = false; },
        }) : nothing}
        ${this.savedFlash ? html`<span class="saved">✓ Saved</span>` : nothing}
      </div>
    `;
  }
}
