import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getTestimonials, postTestimonial, type Testimonial } from '../services/api.js';
import { avatarStyle, initials, avatarImg, avatarStyles } from './avatar.js';
import { icon } from './icons.js';
import { SHARE_URL } from './presence-pill.js';
import './copy-button.js';

const MAX_LEN = 280;

// Public testimonial wall: short notes from people who enjoy Kairos, shown to
// everyone. Reuses the shared backdrop/dialog pattern. Reachable from the
// presence popover and the Feedback control. Notes refresh on every open; the
// author is stamped server-side from os.userInfo().
@customElement('kairos-testimonials')
export class DevaiTestimonials extends LitElement {
  @property({ type: Boolean }) open = false;
  @state() private items: Testimonial[] = [];
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private draft = '';
  @state() private submitting = false;
  private loadSeq = 0;

  static styles = [avatarStyles, css`
    :host { display: contents; }
    .backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      animation: fade-in 0.15s ease-out;
    }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    .dialog {
      width: min(1040px, 98vw);
      height: min(920px, 96vh);
      display: flex;
      flex-direction: column;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }
    .header {
      padding: 16px 20px 12px;
      border-bottom: 1px solid var(--w8);
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .heading { min-width: 0; flex: 1; }
    .title { font-size: var(--font-size-lg); font-weight: 600; color: var(--bright-white); }
    .subtitle { font-size: var(--font-size-sm); color: var(--gray); margin-top: 4px; }
    .icon-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm, 5px);
      transition: all var(--transition-fast);
    }
    .icon-btn:hover { color: var(--bright-white); background: var(--w8); }

    .composer { padding: 14px 20px; border-bottom: 1px solid var(--w8); }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 68px;
      resize: vertical;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-family: var(--font);
      font-size: var(--font-size-base);
      line-height: 1.5;
    }
    textarea:focus { outline: none; border-color: var(--accent-a35); }
    .composer-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
    }
    .count { font-size: var(--font-size-xs); color: var(--neutral-gray); }
    .count.over { color: var(--danger, #f87171); }
    .submit {
      height: 32px;
      padding: 0 16px;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a15);
      color: var(--bright-white);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .submit:hover:not(:disabled) { background: var(--accent-a25); }
    .submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .err { color: var(--danger, #f87171); font-size: var(--font-size-xs); margin-top: 6px; }

    .body { flex: 1; overflow-y: auto; min-height: 0; padding: 8px 0; }
    .body::-webkit-scrollbar { width: 10px; }
    .body::-webkit-scrollbar-thumb {
      background: var(--w8);
      border-radius: 99px;
      border: 3px solid transparent;
      background-clip: padding-box;
    }
    .item { display: flex; gap: 12px; padding: 12px 20px; }
    .item .avatar { --avatar-size: 34px; --avatar-font: 13px; }
    .item-main { min-width: 0; flex: 1; }
    .item-name { font-size: var(--font-size-sm); font-weight: 600; color: var(--bright-white); }
    .item-when { font-size: var(--font-size-xs); color: var(--neutral-gray); margin-left: 8px; font-weight: 400; }
    .item-note {
      font-size: var(--font-size-base);
      color: var(--white);
      line-height: 1.5;
      margin-top: 3px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .state { padding: 40px 20px; text-align: center; color: var(--gray); font-size: var(--font-size-base); }
    .state.error { color: var(--danger, #f87171); }

    .share-foot {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 20px;
      border-top: 1px solid var(--w8);
    }
    .share-msg { font-size: var(--font-size-sm); color: var(--gray); }
  `];

  updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) this.load();
    if (changed.has('open')) {
      if (this.open) document.addEventListener('keydown', this.handleKeydown);
      else document.removeEventListener('keydown', this.handleKeydown);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private async load() {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.error = null;
    try {
      const { testimonials } = await getTestimonials();
      if (seq !== this.loadSeq) return;
      this.items = testimonials;
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error = err instanceof Error ? err.message : 'Failed to load notes';
    } finally {
      if (seq === this.loadSeq) this.loading = false;
    }
  }

  private async submit() {
    const note = this.draft.trim();
    if (!note || note.length > MAX_LEN || this.submitting) return;
    this.submitting = true;
    this.error = null;
    try {
      await postTestimonial(note);
      this.draft = '';
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to post note';
    } finally {
      this.submitting = false;
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this.close();
  }

  private timeAgo(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  render() {
    if (!this.open) return html``;
    const len = this.draft.trim().length;
    const over = len > MAX_LEN;
    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Testimonials">
          <div class="header">
            <div class="heading">
              <div class="title">What people are saying 💜</div>
              <div class="subtitle">Leave a note if Kairos is working for you — everyone sees the wall.</div>
            </div>
            <button class="icon-btn" aria-label="Close" @click=${() => this.close()}>
              ${icon.close(18)}
            </button>
          </div>

          <div class="composer">
            <textarea
              placeholder="What do you like about Kairos?"
              .value=${this.draft}
              maxlength=${MAX_LEN + 40}
              @input=${(e: Event) => { this.draft = (e.target as HTMLTextAreaElement).value; }}
            ></textarea>
            <div class="composer-foot">
              <span class="count ${over ? 'over' : ''}">${len} / ${MAX_LEN}</span>
              <button
                class="submit"
                ?disabled=${!len || over || this.submitting}
                @click=${() => this.submit()}
              >${this.submitting ? 'Posting…' : 'Post note'}</button>
            </div>
            ${this.error ? html`<div class="err">${this.error}</div>` : nothing}
          </div>

          <div class="body">${this.renderBody()}</div>

          <div class="share-foot">
            <span class="share-msg">Enjoying Kairos? Share it with a teammate</span>
            <copy-button .text=${SHARE_URL} .label=${'Copy link'} title="Copy link to share"></copy-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderBody() {
    if (this.loading && !this.items.length) return html`<div class="state">Loading notes…</div>`;
    if (!this.items.length) return html`<div class="state">No notes yet — be the first to leave one! ✨</div>`;
    return this.items.map(
      (t) => html`
        <div class="item">
          <span class="avatar" style=${avatarStyle(t.username)}>
            ${initials(t.username)}${avatarImg(t.username)}
          </span>
          <div class="item-main">
            <div class="item-name">
              ${t.username}<span class="item-when">${this.timeAgo(t.created_at)}</span>
            </div>
            <div class="item-note">${t.note}</div>
          </div>
        </div>
      `,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kairos-testimonials': DevaiTestimonials;
  }
}
