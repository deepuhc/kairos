import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ElicitationRequest } from '../services/acp.js';
import type {
  ElicitationContentValue,
  ElicitationProperty,
  ElicitationResponse,
} from '../services/acp-types.js';

// Inline card that asks the user a structured question authored by the agent.
// Renders directly into the timeline like the permission strip on a tool call.
// Form-mode only — URL elicitations are declined at the bridge.
@customElement('agents-elicitation')
export class AgentsElicitation extends LitElement {
  @property({ attribute: false }) request!: ElicitationRequest;
  @state() private values: Record<string, ElicitationContentValue> = {};

  // AskUserQuestion-style prompts arrive as two schema properties per question:
  // the option field (enum/oneOf radios) and a separate free-text "Other" field.
  // We link each Other field to its preceding option field so the two behave as
  // one mutually-exclusive answer. Recomputed each render from the schema.
  private otherToOption: Record<string, string> = {};
  private optionToOther: Record<string, string> = {};

  static styles = css`
    :host { display: block; }
    .card {
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a10);
      box-shadow: 0 0 0 1px var(--accent-a25), 0 0 18px -4px var(--accent-a25);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .icon {
      width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      border-radius: var(--radius-sm);
      background: var(--accent-a18);
      color: var(--purple-light);
      flex-shrink: 0;
    }
    .label {
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--purple-light);
    }
    .message {
      font-size: var(--font-size-md);
      color: var(--bright-white);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field-title {
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--bright-white);
    }
    .field-desc {
      font-size: var(--font-size-xs);
      color: var(--gray);
    }
    .options {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    label.opt {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w4);
      color: var(--white);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    label.opt:hover { border-color: var(--accent-a35); background: var(--w6); }
    label.opt.selected { border-color: var(--accent); background: var(--accent-a18); color: var(--bright-white); }
    input[type='radio'], input[type='checkbox'] {
      margin: 0;
      accent-color: var(--accent);
    }
    input[type='text'], input[type='number'] {
      padding: 8px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--w4);
      color: var(--white);
      font-family: var(--font);
      font-size: var(--font-size-sm);
      outline: none;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    input[type='text']:focus, input[type='number']:focus {
      border-color: var(--accent-a35);
      box-shadow: 0 0 0 3px var(--accent-a15);
    }
    .bool-row { display: flex; align-items: center; gap: 9px; color: var(--white); font-size: var(--font-size-sm); }
    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    button {
      padding: 7px 14px;
      border-radius: var(--radius);
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    button:hover { border-color: var(--accent-a35); background: var(--accent-a15); color: var(--bright-white); }
    button.submit { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    button.submit:hover { background: var(--purple); }
    button.cancel:hover { border-color: var(--red); background: var(--red-a15); color: var(--red); }
  `;

  render() {
    const schema = this.request.requestedSchema ?? {};
    const properties = schema.properties ?? {};
    const order = Object.keys(properties);
    this.linkOtherFields(order, properties);
    return html`
      <div class="card" role="dialog" aria-label="Agent needs input">
        <div class="head">
          <span class="icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 6a2 2 0 1 1 2.7 1.9c-.4.2-.7.5-.7 1V10"/>
              <circle cx="8" cy="13" r="0.6" fill="currentColor"/>
            </svg>
          </span>
          <span class="label">Agent question</span>
        </div>
        ${this.request.message ? html`<div class="message">${this.request.message}</div>` : nothing}
        ${order.map((key) => this.renderField(key, properties[key]))}
        <div class="actions">
          <button class="cancel" @click=${this.handleCancel}>Cancel</button>
          <button @click=${this.handleDecline}>Skip</button>
          <button class="submit" @click=${this.handleSubmit}>Submit</button>
        </div>
      </div>
    `;
  }

  // Pair each free-text "Other" field with the nearest preceding option field so
  // they act as one answer. A field is an "Other" companion when it's a plain
  // string (no enum/oneOf) titled "Other", and some earlier field has options.
  private linkOtherFields(order: string[], properties: Record<string, ElicitationProperty | undefined>) {
    this.otherToOption = {};
    this.optionToOther = {};
    let lastOptionKey: string | undefined;
    for (const key of order) {
      const prop = properties[key];
      if (!prop) continue;
      const hasOptions =
        (prop.type === 'string' && stringOptions(prop).length > 0) ||
        (prop.type === 'array' && arrayOptions(prop).length > 0);
      if (hasOptions) {
        lastOptionKey = key;
        continue;
      }
      if (
        prop.type === 'string' &&
        lastOptionKey &&
        (prop.title ?? '').trim().toLowerCase() === 'other'
      ) {
        this.otherToOption[key] = lastOptionKey;
        this.optionToOther[lastOptionKey] = key;
        lastOptionKey = undefined;
      }
    }
  }

  private renderField(key: string, prop: ElicitationProperty | undefined) {
    if (!prop) return nothing;
    const title = prop.title ?? key;
    const desc = prop.description;
    const titleBlock = html`
      <div>
        <div class="field-title">${title}</div>
        ${desc ? html`<div class="field-desc">${desc}</div>` : nothing}
      </div>
    `;

    if (prop.type === 'string') {
      const opts = stringOptions(prop);
      if (opts.length > 0) {
        const current = (this.values[key] as string | undefined) ?? '';
        return html`
          <div class="field" data-key=${key}>
            ${titleBlock}
            <div class="options">
              ${opts.map((o) => html`
                <label class="opt ${current === o.value ? 'selected' : ''}">
                  <input
                    type="radio"
                    name=${key}
                    .checked=${current === o.value}
                    @change=${() => this.setValue(key, o.value)}
                  />
                  <span>${o.label}</span>
                </label>
              `)}
            </div>
          </div>
        `;
      }
      const current = (this.values[key] as string | undefined) ?? '';
      const linkedOption = this.otherToOption[key];
      return html`
        <div class="field" data-key=${key}>
          ${titleBlock}
          <input
            type="text"
            .value=${current}
            @focus=${linkedOption ? () => this.clearValue(linkedOption) : nothing}
            @input=${(e: Event) => this.setValue(key, (e.target as HTMLInputElement).value)}
            @keydown=${this.handleKeydown}
          />
        </div>
      `;
    }

    if (prop.type === 'array') {
      const opts = arrayOptions(prop);
      const current = (this.values[key] as string[] | undefined) ?? [];
      return html`
        <div class="field" data-key=${key}>
          ${titleBlock}
          <div class="options">
            ${opts.map((o) => {
              const checked = current.includes(o.value);
              return html`
                <label class="opt ${checked ? 'selected' : ''}">
                  <input
                    type="checkbox"
                    .checked=${checked}
                    @change=${(e: Event) => this.toggleArrayValue(key, o.value, (e.target as HTMLInputElement).checked)}
                  />
                  <span>${o.label}</span>
                </label>
              `;
            })}
          </div>
        </div>
      `;
    }

    if (prop.type === 'boolean') {
      const current = !!this.values[key];
      return html`
        <div class="field" data-key=${key}>
          ${titleBlock}
          <label class="bool-row">
            <input
              type="checkbox"
              .checked=${current}
              @change=${(e: Event) => this.setValue(key, (e.target as HTMLInputElement).checked)}
            />
            <span>Yes</span>
          </label>
        </div>
      `;
    }

    if (prop.type === 'number' || prop.type === 'integer') {
      const current = this.values[key];
      return html`
        <div class="field" data-key=${key}>
          ${titleBlock}
          <input
            type="number"
            step=${prop.type === 'integer' ? '1' : 'any'}
            .value=${current === undefined ? '' : String(current)}
            @input=${(e: Event) => this.setNumber(key, (e.target as HTMLInputElement).value, prop.type === 'integer')}
            @keydown=${this.handleKeydown}
          />
        </div>
      `;
    }

    return nothing;
  }

  private setValue(key: string, value: ElicitationContentValue) {
    const next = { ...this.values, [key]: value };
    // Picking an option answers the question, so clear its linked "Other" text.
    const other = this.optionToOther[key];
    if (other) delete next[other];
    this.values = next;
  }

  private clearValue(key: string) {
    if (!(key in this.values)) return;
    const { [key]: _, ...rest } = this.values;
    this.values = rest;
  }

  private toggleArrayValue(key: string, value: string, on: boolean) {
    const current = (this.values[key] as string[] | undefined) ?? [];
    const nextList = on ? [...current, value] : current.filter((v) => v !== value);
    const next = { ...this.values, [key]: nextList };
    const other = this.optionToOther[key];
    if (on && other) delete next[other];
    this.values = next;
  }

  private setNumber(key: string, raw: string, integer: boolean) {
    if (raw === '') {
      const { [key]: _, ...rest } = this.values;
      this.values = rest;
      return;
    }
    const n = integer ? parseInt(raw, 10) : Number(raw);
    if (!Number.isFinite(n)) return;
    this.values = { ...this.values, [key]: n };
  }

  // Enter in a single-line field advances the form. If every question has an
  // answer it submits (same payload as the Submit button); otherwise it jumps
  // focus to the first unanswered question instead of submitting a partial form.
  // Ignore IME composition; let Shift+Enter fall through for future multiline use.
  private handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const unanswered = this.firstUnansweredKey();
    if (unanswered) {
      this.focusField(unanswered);
    } else {
      this.handleSubmit();
    }
  }

  // Key of the first logical question with no answer, or undefined if all are
  // answered. "Other" companion fields fold into their option question, so a
  // paired question counts as answered if either the option or its Other is set.
  private firstUnansweredKey(): string | undefined {
    const properties = this.request.requestedSchema?.properties ?? {};
    for (const key of Object.keys(properties)) {
      if (this.otherToOption[key]) continue; // folded into its option question
      const prop = properties[key];
      if (!prop || prop.type === 'boolean') continue; // unchecked is a valid answer
      const other = this.optionToOther[key];
      if (this.hasValue(key) || (other && this.hasValue(other))) continue;
      return key;
    }
    return undefined;
  }

  private hasValue(key: string): boolean {
    const v = this.values[key];
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    return v !== undefined && v !== null;
  }

  private focusField(key: string) {
    const field = this.renderRoot.querySelector(`.field[data-key="${key}"]`);
    const control = field?.querySelector<HTMLElement>('input, textarea, select');
    control?.focus();
  }

  private handleSubmit() {
    this.dispatch({ action: 'accept', content: this.values });
  }

  private handleDecline() {
    this.dispatch({ action: 'decline' });
  }

  private handleCancel() {
    this.dispatch({ action: 'cancel' });
  }

  private dispatch(response: ElicitationResponse) {
    this.dispatchEvent(new CustomEvent('elicitation-response', {
      detail: { requestId: this.request.requestId, response },
      bubbles: true,
      composed: true,
    }));
  }
}

// Pull a uniform { value, label } list out of a string property's enum/oneOf.
function stringOptions(prop: ElicitationProperty): Array<{ value: string; label: string }> {
  const p = prop as { enum?: string[]; oneOf?: Array<{ const: string; title?: string }> };
  if (p.oneOf?.length) return p.oneOf.map((o) => ({ value: o.const, label: o.title ?? o.const }));
  if (p.enum?.length) return p.enum.map((v) => ({ value: v, label: v }));
  return [];
}

// Same for array `items.enum` / `items.anyOf`.
function arrayOptions(prop: ElicitationProperty): Array<{ value: string; label: string }> {
  const items = (prop as { items?: { enum?: string[]; anyOf?: Array<{ const: string; title?: string }> } }).items;
  if (!items) return [];
  if (items.anyOf?.length) return items.anyOf.map((o) => ({ value: o.const, label: o.title ?? o.const }));
  if (items.enum?.length) return items.enum.map((v) => ({ value: v, label: v }));
  return [];
}
