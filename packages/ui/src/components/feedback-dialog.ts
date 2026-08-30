import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fetchWithAuth } from '../services/backend-auth.js';
import { collectFeedbackContext, formatFeedbackReport } from '../services/feedback-report.js';

// A dialog that turns a tester's note into one paste-ready report — their words
// plus version, mode, provider diagnostics, and recent errors. The primary
// action is "Copy report" (works everywhere, needs no connection back to the
// dev). It also tries to save a durable copy server-side via POST /api/feedback,
// but never blocks on it. This is the tester-facing half of the feedback loop:
// copy → paste back to the developer → fix from the other machine.

@customElement('kairos-feedback-dialog')
export class KairosFeedbackDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  /** Current app mode + view, injected so the report captures where they were. */
  @property({ type: String }) mode = 'default';
  @property({ type: String }) view = 'agents';

  @state() private message = '';
  @state() private report = '';
  @state() private building = false;
  @state() private copied = false;
  @state() private savedNote = '';

  static styles = css`
    :host { display: contents; }
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 24px;
    }
    .panel {
      width: min(640px, 100%);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: var(--surface-raised, #1b1b1f);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--glass-border);
    }
    .head h2 { margin: 0; font-size: var(--font-size-lg); color: var(--bright-white); }
    .close {
      border: none; background: none; color: var(--gray); cursor: pointer;
      padding: 4px; border-radius: var(--radius); display: inline-flex; font-size: 18px;
    }
    .close:hover { color: var(--bright-white); background: var(--w6); }
    .body { padding: 16px 20px; overflow: auto; }
    label { display: block; font-size: var(--font-size-sm); color: var(--gray); margin-bottom: 6px; }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 96px;
      resize: vertical;
      padding: 10px 12px;
      border-radius: var(--radius);
      border: 1px solid var(--glass-border);
      background: var(--w5);
      color: var(--bright-white);
      font-family: inherit;
      font-size: var(--font-size-sm);
    }
    textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .hint { font-size: var(--font-size-xs); color: var(--gray); margin: 8px 0 0; line-height: 1.5; }
    pre.preview {
      margin: 12px 0 0;
      padding: 12px;
      max-height: 220px;
      overflow: auto;
      background: var(--w6);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      font-family: var(--font-mono, monospace);
      font-size: var(--font-size-xs);
      line-height: 1.5;
      color: var(--bright-white);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 20px;
      border-top: 1px solid var(--glass-border);
    }
    .foot .spacer { flex: 1; }
    .status { font-size: var(--font-size-xs); color: var(--success, #22c55e); }
    button.action {
      padding: 8px 14px;
      border-radius: var(--radius);
      border: 1px solid var(--glass-border);
      background: var(--w5);
      color: var(--bright-white);
      cursor: pointer;
      font-size: var(--font-size-sm);
    }
    button.action:hover { background: var(--w6); }
    button.action.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.action.primary:hover { filter: brightness(1.05); }
    button.action:disabled { opacity: 0.5; cursor: default; }
  `;

  // Rebuild the report whenever the dialog opens or the message changes, so the
  // preview and the clipboard always reflect the latest note + fresh diagnostics.
  updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this.copied = false;
      this.savedNote = '';
      void this.rebuild();
    }
  }

  private async rebuild() {
    this.building = true;
    try {
      const ctx = await collectFeedbackContext({ mode: this.mode, view: this.view });
      this.report = formatFeedbackReport(this.message, ctx);
    } finally {
      this.building = false;
    }
  }

  private onInput(e: Event) {
    this.message = (e.target as HTMLTextAreaElement).value;
    void this.rebuild();
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(this.report);
      this.copied = true;
      // Also persist a durable copy, best-effort — don't block the copy UX.
      void this.save();
    } catch {
      // Clipboard blocked (rare); the textarea/preview is still selectable.
      this.copied = false;
    }
  }

  private async save() {
    try {
      const res = await fetchWithAuth('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: this.report, message: this.message }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; savedTo?: string };
      this.savedNote = data.ok && data.savedTo ? 'Saved a copy on the host too.' : '';
    } catch {
      this.savedNote = '';
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="panel" role="dialog" aria-modal="true" aria-label="Send feedback">
          <div class="head">
            <h2>Send feedback</h2>
            <button class="close" @click=${this.close} aria-label="Close">×</button>
          </div>
          <div class="body">
            <label for="fb">What happened? What did you expect?</label>
            <textarea id="fb" .value=${this.message} @input=${this.onInput}
              placeholder="Describe the bug or idea. Steps to reproduce help a lot."></textarea>
            <p class="hint">
              This builds one report with your note plus version, provider status, and
              recent errors — no secrets. Copy it and paste it back to the developer.
            </p>
            ${this.report ? html`<pre class="preview">${this.report}</pre>` : nothing}
          </div>
          <div class="foot">
            ${this.copied ? html`<span class="status">Copied${this.savedNote ? ` — ${this.savedNote}` : ''}</span>` : nothing}
            <span class="spacer"></span>
            <button class="action" @click=${this.close}>Cancel</button>
            <button class="action primary" @click=${this.copy} ?disabled=${this.building || !this.report}>
              ${this.building ? 'Preparing…' : this.copied ? 'Copied ✓' : 'Copy report'}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kairos-feedback-dialog': KairosFeedbackDialog;
  }
}
