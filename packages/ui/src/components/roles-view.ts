import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { focusRing } from '../styles/focus.js';
import { renderDeleteButton, confirmDeleteStyles } from './confirm-delete.js';
import {
  getRoles, createRole, updateRole, deleteRole,
  type CustomRoleInput,
} from '../services/api.js';

// Roles manager — agent-agnostic personas the Agents tab can apply to any engine
// at launch. A role bundles instructions (+ optional output format) that get
// prepended to a new session's first prompt turn, so the same "Code Reviewer"
// role works across Claude, Gemini, Codex, or a custom agent. Stored globally in
// ~/.kairos/config.json. Two-pane: left rail lists saved roles, right pane
// edits the selected one.

function slug(label: string, existing: CustomRoleInput[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'role';
  let id = base;
  let n = 2;
  while (existing.some((r) => r.id === id)) id = `${base}-${n++}`;
  return id;
}

@customElement('kairos-roles')
export class DevaiRoles extends LitElement {
  @state() private roles: CustomRoleInput[] = [];
  @state() private selected: string | null = null;
  @state() private creating = false;
  @state() private labelDraft = '';
  @state() private idDraft = '';
  @state() private instructionsDraft = '';
  @state() private outputFormatDraft = '';
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
    .subtitle { color: var(--gray); font-size: var(--font-size-sm); margin-bottom: 16px; max-width: 760px; line-height: 1.5; }
    .subtitle code { font-family: var(--font-mono); color: var(--purple-light); }
    .err { color: var(--red); font-size: var(--font-size-sm); margin-bottom: 8px; }
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
    .role-item {
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
    .role-item:hover { background: var(--glass-bg-hover); }
    .role-item.active { border-color: var(--accent-a35); background: var(--accent-a15); }
    .role-label { font-size: var(--font-size-sm); color: var(--bright-white); font-weight: 500; }
    .role-snippet { font-size: var(--font-size-xs); color: var(--neutral-gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
    input.mono { font-family: var(--font-mono); font-size: var(--font-size-sm); }
    textarea {
      resize: vertical;
      line-height: 1.5;
      font-size: var(--font-size-sm);
    }
    textarea.instructions { min-height: 180px; }
    textarea.output-format { min-height: 90px; }
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
      this.roles = (await getRoles()).roles;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  private get active(): CustomRoleInput | undefined {
    return this.roles.find((r) => r.id === this.selected);
  }

  private select(id: string) {
    const r = this.roles.find((x) => x.id === id);
    if (!r) return;
    this.creating = false;
    this.confirmingDelete = false;
    this.selected = id;
    this.idDraft = r.id;
    this.labelDraft = r.label;
    this.instructionsDraft = r.instructions;
    this.outputFormatDraft = r.outputFormat ?? '';
    this.error = null;
  }

  private startNew() {
    this.creating = true;
    this.selected = null;
    this.idDraft = '';
    this.labelDraft = '';
    this.instructionsDraft = '';
    this.outputFormatDraft = '';
    this.error = null;
  }

  private async save() {
    const label = this.labelDraft.trim();
    const instructions = this.instructionsDraft.trim();
    const outputFormat = this.outputFormatDraft.trim();
    if (!label) { this.error = 'Display name is required.'; return; }
    if (!instructions) { this.error = 'Instructions are required.'; return; }
    const body = { label, instructions, outputFormat: outputFormat || undefined };

    this.saving = true;
    this.error = null;
    try {
      if (this.creating) {
        const id = slug(label, this.roles);
        const res = await createRole({ id, ...body });
        this.roles = [...this.roles, res.role];
        this.creating = false;
        this.selected = id;
        this.idDraft = id;
      } else if (this.selected) {
        const res = await updateRole(this.selected, body);
        this.roles = this.roles.map((r) => (r.id === this.selected ? res.role : r));
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
    const r = this.active;
    if (!r) return;
    this.saving = true;
    this.error = null;
    try {
      await deleteRole(r.id);
      this.roles = this.roles.filter((x) => x.id !== r.id);
      this.selected = null;
      this.confirmingDelete = false;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  render() {
    if (this.loading) return html`<h2>Roles</h2><div class="loading">Loading…</div>`;
    const editing = this.creating || !!this.active;
    return html`
      <h2>Roles</h2>
      <div class="subtitle">
        Reusable personas you can apply to any agent at launch. A role bundles standing
        instructions — how to behave, what to focus on, what format to answer in — that get
        prepended to a session's first message. Because they ride on the prompt, roles are
        <strong>engine-agnostic</strong>: start from the shipped roles like
        <code>Code Reviewer</code>, edit them, or add your own. Pick a role in the Agents tab when
        you start a session.
      </div>
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}
      <div class="layout">
        <div class="rail">
          <button class="new-btn" @click=${this.startNew}>+ New role</button>
          ${this.roles.length === 0 && !this.creating
            ? html`<div class="hint" style="padding: 8px 4px;">No roles yet.</div>`
            : nothing}
          ${this.roles.map((r) => html`
            <div class="role-item ${r.id === this.selected ? 'active' : ''}" @click=${() => this.select(r.id)}>
              <span class="role-label">${r.label}</span>
              <span class="role-snippet">${r.instructions}</span>
            </div>
          `)}
        </div>
        <div class="editor">
          ${editing ? this.renderEditor() : html`<div class="empty">Select a role, or create a new one.</div>`}
        </div>
      </div>
    `;
  }

  private renderEditor() {
    return html`
      <label>Display name</label>
      <input
        placeholder="Code Reviewer"
        .value=${this.labelDraft}
        @input=${(e: Event) => { this.labelDraft = (e.target as HTMLInputElement).value; }}
      />
      ${!this.creating ? html`
        <label>ID</label>
        <input class="mono" .value=${this.idDraft} disabled />
      ` : nothing}
      <label>Instructions</label>
      <textarea
        class="instructions"
        placeholder="You are a meticulous code reviewer. Focus on correctness, edge cases, and security. Point out the highest-severity issues first, and be direct — no praise padding."
        .value=${this.instructionsDraft}
        @input=${(e: Event) => { this.instructionsDraft = (e.target as HTMLTextAreaElement).value; }}
      ></textarea>
      <label>Output format <span class="hint-inline">(optional)</span></label>
      <textarea
        class="output-format"
        placeholder="Return a markdown table: Severity | File:line | Issue | Suggested fix."
        .value=${this.outputFormatDraft}
        @input=${(e: Event) => { this.outputFormatDraft = (e.target as HTMLTextAreaElement).value; }}
      ></textarea>
      <div class="hint">
        Instructions (and the output format, if set) are sent ahead of your first message when a
        session starts under this role. Later turns aren't re-primed. Changes apply to sessions
        started after you save.
      </div>
      <div class="actions">
        <button class="btn primary" ?disabled=${this.saving || !this.labelDraft.trim() || !this.instructionsDraft.trim()} @click=${this.save}>
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
