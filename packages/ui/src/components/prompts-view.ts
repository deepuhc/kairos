import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { focusRing } from '../styles/focus.js';
import { renderDeleteButton, confirmDeleteStyles } from './confirm-delete.js';
import {
  getPrompts, createPrompt, updatePrompt, deletePrompt,
  type PromptInput,
} from '../services/api.js';
import { promptId } from '../services/prompt-util.js';

// Prompt library manager — create and edit reusable prompt snippets that show
// up in the Agents composer's `/` menu. The left rail lists saved prompts; the
// right pane edits the selected one (name, optional description, body). This is
// the management surface; insertion happens in the Agents tab. Prompts are
// engine-agnostic and stored server-side in ~/.kairos/config.json.

@customElement('kairos-prompts')
export class DevaiPrompts extends LitElement {
  @state() private prompts: PromptInput[] = [];
  @state() private selected: string | null = null;
  @state() private nameDraft = '';
  @state() private descDraft = '';
  @state() private bodyDraft = '';
  @state() private savedFlash = false;
  @state() private creating = false;
  @state() private loading = true;
  @state() private saving = false;
  @state() private error: string | null = null;
  @state() private confirmingDelete = false;

  static styles = [focusRing, confirmDeleteStyles, css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
      margin: 0 0 4px;
    }
    .subtitle { color: var(--gray); font-size: var(--font-size-sm); margin-bottom: 16px; }
    .subtitle code { font-family: var(--font-mono); color: var(--purple-light); }
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
    .prompt-item {
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
    .prompt-item:hover { background: var(--glass-bg-hover); }
    .prompt-item.active { border-color: var(--accent-a35); background: var(--accent-a15); }
    .prompt-trigger { font-family: var(--font-mono); font-size: var(--font-size-sm); color: var(--bright-white); }
    .prompt-sub { font-size: var(--font-size-xs); color: var(--neutral-gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .editor { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    label { font-size: var(--font-size-xs); color: var(--gray); text-transform: uppercase; letter-spacing: 0.5px; }
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
    textarea {
      min-height: 320px;
      resize: vertical;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
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
    .hint { font-size: var(--font-size-xs); color: var(--neutral-gray); line-height: 1.4; }
    .empty { padding: 32px; text-align: center; color: var(--gray); }
    .err { color: var(--red); font-size: var(--font-size-sm); margin-bottom: 8px; }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  private async load() {
    this.loading = true;
    this.error = null;
    try {
      this.prompts = (await getPrompts()).prompts;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  private get active(): PromptInput | undefined {
    return this.prompts.find((p) => p.id === this.selected);
  }

  private select(id: string) {
    const p = this.prompts.find((x) => x.id === id);
    if (!p) return;
    this.creating = false;
    this.confirmingDelete = false;
    this.selected = id;
    this.nameDraft = p.name;
    this.descDraft = p.description ?? '';
    this.bodyDraft = p.body;
    this.error = null;
  }

  private startNew() {
    this.creating = true;
    this.selected = null;
    this.nameDraft = '';
    this.descDraft = '';
    this.bodyDraft = '';
    this.error = null;
  }

  private async save() {
    const name = this.nameDraft.trim();
    if (!name || !this.bodyDraft.trim()) return;
    const body = {
      name,
      description: this.descDraft.trim() || undefined,
      body: this.bodyDraft,
    };
    this.saving = true;
    this.error = null;
    try {
      if (this.creating) {
        const id = promptId(name, this.prompts);
        const res = await createPrompt({ id, ...body });
        this.prompts = [...this.prompts, res.prompt];
        this.creating = false;
        this.selected = id;
      } else if (this.selected) {
        const res = await updatePrompt(this.selected, body);
        this.prompts = this.prompts.map((p) => (p.id === this.selected ? res.prompt : p));
      }
      this.savedFlash = true;
      setTimeout(() => { this.savedFlash = false; }, 1800);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  private async deletePromptEntry() {
    const p = this.active;
    if (!p) return;
    this.saving = true;
    this.error = null;
    try {
      await deletePrompt(p.id);
      this.prompts = this.prompts.filter((x) => x.id !== p.id);
      this.selected = null;
      this.creating = false;
      this.confirmingDelete = false;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  render() {
    if (this.loading) return html`<h2>Prompts</h2><div class="empty">Loading…</div>`;
    const editing = this.creating || !!this.active;
    return html`
      <h2>Prompts</h2>
      <div class="subtitle">
        Reusable prompt snippets. Saved prompts appear in the Agents composer's
        <code>/</code> menu — type <code>/</code> and pick one to drop its text into your message.
        They're engine-agnostic and work with any agent.
      </div>
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}
      <div class="layout">
        <div class="rail">
          <button class="new-btn" @click=${this.startNew}>+ New prompt</button>
          ${this.prompts.map((p) => html`
            <div class="prompt-item ${p.id === this.selected ? 'active' : ''}" @click=${() => this.select(p.id)}>
              <span class="prompt-trigger">/${p.name}</span>
              ${p.description ? html`<span class="prompt-sub">${p.description}</span>` : nothing}
            </div>
          `)}
        </div>
        <div class="editor">
          ${editing ? this.renderEditor() : html`<div class="empty">Select a prompt, or create a new one.</div>`}
        </div>
      </div>
    `;
  }

  private renderEditor() {
    return html`
      <label>Trigger name</label>
      <input
        placeholder="review"
        .value=${this.nameDraft}
        @input=${(e: Event) => { this.nameDraft = (e.target as HTMLInputElement).value; }}
      />
      <label>Description (optional)</label>
      <input
        placeholder="Ask for a focused code review"
        .value=${this.descDraft}
        @input=${(e: Event) => { this.descDraft = (e.target as HTMLInputElement).value; }}
      />
      <label>Prompt body</label>
      <textarea
        placeholder="Review the current diff. Flag correctness bugs first, then style…"
        .value=${this.bodyDraft}
        @input=${(e: Event) => { this.bodyDraft = (e.target as HTMLTextAreaElement).value; }}
      ></textarea>
      <div class="actions">
        <button class="btn primary" ?disabled=${this.saving || !this.nameDraft.trim() || !this.bodyDraft.trim()} @click=${this.save}>
          ${this.saving ? 'Saving…' : this.creating ? 'Create' : 'Save'}
        </button>
        ${!this.creating && this.active ? renderDeleteButton({
          confirming: this.confirmingDelete,
          saving: this.saving,
          onArm: () => { this.confirmingDelete = true; },
          onConfirm: () => this.deletePromptEntry(),
          onCancel: () => { this.confirmingDelete = false; },
        }) : nothing}
        ${this.savedFlash ? html`<span class="saved">✓ Saved</span>` : nothing}
      </div>
      <div class="hint">The trigger is what you type after <code>/</code>; the body is inserted into the composer.</div>
    `;
  }
}
