import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { focusRing } from '../styles/focus.js';
import { renderDeleteButton, confirmDeleteStyles } from './confirm-delete.js';
import {
  getRules, saveRuleFile, deleteRuleFile,
  getGlobalRules, saveGlobalRules,
  type RuleFile, type RuleScope,
} from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';

// Memory editor. Two scopes, owned by the parent customization shell and passed
// in as `scope`:
//   global  — standing instructions for every session, config-backed and
//             injected into the first prompt turn (no cross-agent user-level
//             rules file exists, so this is stored like Cursor's "user rules"
//             rather than written to a vendor dotfile). A single textarea.
//   project — the repo's cross-agent AGENTS.md file, edited on disk. Saving an
//             empty file removes it.

@customElement('kairos-rules')
export class DevaiRules extends LitElement {
  // Controlled by the parent shell.
  @property({ type: String }) scope: RuleScope = 'global';
  @property({ type: String }) cwd: string | null = null;

  // Project-scope state.
  @state() private files: RuleFile[] = [];
  @state() private selected: string | null = null;
  // Global-scope state.
  @state() private globalContent = '';
  // Shared.
  @state() private draft = '';
  @state() private loading = true;
  @state() private saving = false;
  @state() private error: string | null = null;
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
    .subtitle {
      color: var(--gray);
      font-size: var(--font-size-sm);
      margin-bottom: 16px;
    }
    .subtitle code {
      font-family: var(--font-mono);
      color: var(--accent);
    }
    .layout {
      display: grid;
      grid-template-columns: var(--rail-width) 1fr;
      gap: 16px;
      align-items: start;
    }
    .rail { display: flex; flex-direction: column; gap: 6px; }
    .file-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .file-item:hover { background: var(--glass-bg-hover); }
    .file-item.active { border-color: var(--accent-a35); background: var(--accent-a15); }
    .file-name {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      color: var(--bright-white);
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--emerald);
      flex-shrink: 0;
    }
    .dot.empty { background: var(--w8); }
    .editor { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .editor-path {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      word-break: break-all;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 420px;
      resize: vertical;
      padding: 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      tab-size: 2;
    }
    textarea:focus { outline: none; border-color: var(--accent-a35); }
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
    .btn.primary {
      background: var(--accent-a25);
      color: var(--accent);
      border-color: var(--accent-a35);
    }
    .btn.danger { color: var(--red); }
    .btn.danger:hover:not(:disabled) { background: var(--red-a15, rgba(239,68,68,0.12)); border-color: var(--red); }
    .saved { color: var(--emerald); font-size: var(--font-size-sm); }
    .hint {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      line-height: 1.4;
    }
    .err { color: var(--red); font-size: var(--font-size-sm); margin-bottom: 8px; }
    .loading, .empty { padding: 32px; text-align: center; color: var(--gray); }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('scope') || changed.has('cwd')) {
      this.selected = null;
      this.load();
    }
  }

  private get activeFile(): RuleFile | undefined {
    return this.files.find((f) => f.name === this.selected);
  }

  private get dirty(): boolean {
    if (this.scope === 'global') return this.draft !== this.globalContent;
    return this.activeFile ? this.draft !== this.activeFile.content : false;
  }

  private async load() {
    this.loading = true;
    this.error = null;
    try {
      if (this.scope === 'global') {
        const res = await getGlobalRules();
        this.globalContent = res.rules;
        this.draft = res.rules;
        return;
      }
      if (!this.cwd) {
        this.files = [];
        return;
      }
      const res = await getRules(this.cwd);
      this.files = res.files;
      // Keep selection if still present, else pick first existing, else first.
      const keep = this.files.find((f) => f.name === this.selected);
      const target = keep ?? this.files.find((f) => f.exists) ?? this.files[0];
      this.selectFile(target?.name ?? null);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  private selectFile(name: string | null) {
    if (this.dirty && !confirm('Discard unsaved changes?')) return;
    this.selected = name;
    this.confirmingDelete = false;
    this.draft = this.files.find((f) => f.name === name)?.content ?? '';
  }

  private async save() {
    this.saving = true;
    this.error = null;
    try {
      if (this.scope === 'global') {
        const res = await saveGlobalRules(this.draft);
        this.globalContent = res.rules;
        this.draft = res.rules;
      } else {
        const file = this.activeFile;
        if (!file) return;
        const res = await saveRuleFile(file.name, this.draft, file.cwd);
        this.files = this.files.map((f) => (f.name === file.name ? res.file : f));
        this.draft = res.file.content;
      }
      this.savedFlash = true;
      setTimeout(() => { this.savedFlash = false; }, 1800);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  private async deleteFile() {
    const file = this.activeFile;
    if (!file || !file.exists) return;
    this.saving = true;
    this.error = null;
    try {
      await deleteRuleFile(file.name, file.cwd);
      this.confirmingDelete = false;
      await this.load();
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  render() {
    return html`
      <div class="subtitle">
        ${this.scope === 'global'
          ? html`Standing instructions applied to <em>every</em> session, on any engine
              (Claude, Codex, Gemini, or a custom agent). Injected at the start of each
              session — the cross-agent equivalent of a tool's "user rules".`
          : html`The repo's cross-agent <code>AGENTS.md</code> file — instructions any agent
              that supports it picks up automatically, scoped to this workspace.`}
      </div>
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}

      ${this.loading
        ? html`<div class="loading">Loading memory…</div>`
        : this.scope === 'global'
          ? this.renderGlobal()
          : !this.cwd
            ? html`<div class="empty">No workspace selected. Add a workspace to edit project memory.</div>`
            : this.renderProject()}
    `;
  }

  private renderGlobal() {
    return html`
      <div class="editor">
        <textarea
          .value=${this.draft}
          placeholder="Write instructions every agent should always follow…"
          @input=${(e: Event) => { this.draft = (e.target as HTMLTextAreaElement).value; }}
        ></textarea>
        <div class="actions">
          <button class="btn primary" ?disabled=${this.saving || !this.dirty} @click=${this.save}>
            ${this.saving ? 'Saving…' : 'Save'}
          </button>
          ${this.savedFlash ? html`<span class="saved">✓ Saved</span>` : ''}
          ${this.dirty ? html`<span class="hint">Unsaved changes</span>` : ''}
        </div>
        <div class="hint">Markdown. Applies to sessions started from this app; standalone terminal runs are unaffected.</div>
      </div>
    `;
  }

  private renderProject() {
    const file = this.activeFile;
    return html`
      <div class="layout">
        <div class="rail">
          ${this.files.map((f) => html`
            <div class="file-item ${f.name === this.selected ? 'active' : ''}" @click=${() => this.selectFile(f.name)}>
              <span class="file-name">${f.name}</span>
              <span class="dot ${f.exists ? '' : 'empty'}" ${tooltip(f.exists ? 'Has content' : 'Not created yet')}></span>
            </div>
          `)}
        </div>
        <div class="editor">
          ${file ? html`
            <div class="editor-path">${file.path}${file.exists ? '' : ' (new)'}</div>
            <textarea
              .value=${this.draft}
              placeholder="# ${file.name}\n\nWrite instructions the agent should always follow…"
              @input=${(e: Event) => { this.draft = (e.target as HTMLTextAreaElement).value; }}
            ></textarea>
            <div class="actions">
              <button class="btn primary" ?disabled=${this.saving || !this.dirty} @click=${this.save}>
                ${this.saving ? 'Saving…' : 'Save'}
              </button>
              ${file.exists
                ? renderDeleteButton({
                    confirming: this.confirmingDelete,
                    saving: this.saving,
                    onArm: () => { this.confirmingDelete = true; },
                    onConfirm: () => this.deleteFile(),
                    onCancel: () => { this.confirmingDelete = false; },
                  })
                : html`<button class="btn danger" disabled>Delete</button>`}
              ${this.savedFlash ? html`<span class="saved">✓ Saved</span>` : ''}
              ${this.dirty ? html`<span class="hint">Unsaved changes</span>` : ''}
            </div>
            <div class="hint">Markdown. Saving an empty file deletes it.</div>
          ` : html`<div class="empty">Select a file to edit.</div>`}
        </div>
      </div>
    `;
  }
}
