import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  getConfigList, getConfigStatus, explainConfigKey, setConfigKey, unsetConfigKey,
  type ConfigKey, type ConfigStatus, type ConfigExplain,
} from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';

@customElement('kairos-config')
export class DevaiConfig extends LitElement {
  @state() private items: ConfigKey[] = [];
  @state() private status: ConfigStatus | null = null;
  @state() private filter = '';
  @state() private showAll = false;
  @state() private loading = true;
  @state() private selectedKey: string | null = null;
  @state() private explain: ConfigExplain | null = null;
  @state() private explainLoading = false;
  @state() private editValue = '';
  @state() private projectScope = false;
  @state() private saving = false;
  @state() private error: string | null = null;

  static styles = css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: var(--font-size-base);
      color: var(--gray);
      margin: 4px 0 18px;
    }
    .meta strong { color: var(--white); }
    .header {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
    }
    input.search {
      flex: 1;
      padding: 8px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
    }
    input.search:focus { outline: none; border-color: var(--accent-a35); }
    .toggle {
      padding: 8px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-base);
      cursor: pointer;
    }
    .toggle.active {
      background: var(--accent-a25);
      color: var(--purple-light);
      border-color: var(--accent-a35);
    }
    .layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 900px) {
      .layout.with-drawer { grid-template-columns: minmax(0, 1fr) 380px; }
    }
    .table {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 2fr) 1fr 1fr 1fr;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--glass-border);
      cursor: pointer;
      align-items: center;
      transition: background var(--transition-fast);
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--glass-bg-hover); }
    .row.active { background: var(--accent-a15); }
    .row.head {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      color: var(--neutral-gray);
      letter-spacing: 0.5px;
      cursor: default;
    }
    .row.head:hover { background: transparent; }
    .key {
      font-family: var(--font-mono);
      color: var(--bright-white);
      font-size: var(--font-size-sm);
      word-break: break-all;
    }
    .desc {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      margin-top: 2px;
      line-height: 1.3;
    }
    .value {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      color: var(--white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .value.empty { color: var(--neutral-gray); font-style: italic; }
    .src-pill {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 99px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      background: var(--w8);
      color: var(--gray);
    }
    .src-pill.user, .src-pill.project, .src-pill.env { background: var(--accent-a15); color: var(--purple-light); }

    .drawer {
      position: sticky;
      top: 16px;
      align-self: start;
      padding: 16px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
    }
    .drawer h3 {
      font-family: var(--font-mono);
      font-size: var(--font-size-md);
      color: var(--bright-white);
      word-break: break-all;
      margin-bottom: 4px;
    }
    .drawer .type {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      margin-bottom: 12px;
    }
    .layers {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      margin-bottom: 14px;
    }
    .layers .layer { color: var(--gray); }
    .layers .val { color: var(--white); }
    .layers .source { font-size: var(--font-size-xs); color: var(--neutral-gray); grid-column: 2; margin-bottom: 4px; }
    .resolved {
      padding: 8px 10px;
      border-radius: var(--radius);
      background: var(--green-a15);
      color: var(--emerald);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      margin-bottom: 14px;
    }
    .editor {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .editor label {
      font-size: var(--font-size-sm);
      color: var(--gray);
    }
    .editor input, .editor select {
      padding: 6px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
      font-family: var(--font-mono);
    }
    .editor input:focus, .editor select:focus { outline: none; border-color: var(--accent-a35); }
    .scope-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-sm);
      color: var(--gray);
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .actions button {
      padding: 6px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    .actions button.primary {
      background: var(--accent-a25);
      border-color: var(--accent-a35);
      color: var(--purple-light);
    }
    .actions button.primary:hover { background: var(--accent-a35); color: var(--bright-white); }
    .actions button.danger { color: var(--red); border-color: var(--red-a25); background: var(--red-a15); }
    .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .err {
      color: var(--red);
      font-size: var(--font-size-sm);
      margin-top: 6px;
    }
    .loading, .empty {
      padding: 32px;
      text-align: center;
      color: var(--gray);
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  private async load() {
    this.loading = true;
    try {
      const [list, status] = await Promise.allSettled([
        getConfigList(this.showAll),
        getConfigStatus(),
      ]);
      this.items = list.status === 'fulfilled' ? list.value.items : [];
      this.status = status.status === 'fulfilled' ? status.value : null;
    } finally {
      this.loading = false;
    }
  }

  private async select(key: string) {
    this.selectedKey = key;
    this.explain = null;
    this.error = null;
    this.explainLoading = true;
    try {
      this.explain = await explainConfigKey(key);
      this.editValue = this.explain.resolved?.value ?? '';
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.explainLoading = false;
    }
  }

  private async save() {
    if (!this.selectedKey) return;
    this.saving = true;
    this.error = null;
    try {
      await setConfigKey(this.selectedKey, this.editValue, this.projectScope);
      await this.load();
      await this.select(this.selectedKey);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  private async unset() {
    if (!this.selectedKey) return;
    this.saving = true;
    this.error = null;
    try {
      await unsetConfigKey(this.selectedKey, this.projectScope);
      await this.load();
      await this.select(this.selectedKey);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.saving = false;
    }
  }

  render() {
    if (this.loading) return html`<div class="loading">Loading config...</div>`;
    const filter = this.filter.toLowerCase();
    const filtered = filter
      ? this.items.filter((i) =>
          i.key.toLowerCase().includes(filter) || i.description.toLowerCase().includes(filter))
      : this.items;

    return html`
      <h2>Config</h2>
      ${this.status ? html`
        <div class="meta">
          <span><strong>Config dir:</strong> ${this.status.configDir ?? '—'}</span>
          ${this.status.projectConfig ? html`<span><strong>Project:</strong> ${this.status.projectConfig}</span>` : ''}
          <span><strong>Profiles:</strong> ${this.status.profiles.length ? this.status.profiles.join(', ') : '(none)'}</span>
          <span><strong>Overrides:</strong> ${this.status.userOverrides} user, ${this.status.projectOverrides} project</span>
        </div>
      ` : ''}
      <div class="header">
        <input
          class="search"
          placeholder="Search keys..."
          .value=${this.filter}
          @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}
        />
        <button
          class="toggle ${this.showAll ? 'active' : ''}"
          ${tooltip('Include hidden config keys (config list --all)')}
          @click=${async () => { this.showAll = !this.showAll; await this.load(); }}
        >${this.showAll ? '✓ Show hidden' : 'Show hidden'}</button>
      </div>
      <div class="layout ${this.selectedKey ? 'with-drawer' : ''}">
        <div class="table">
          <div class="row head">
            <span>Key</span>
            <span>Type</span>
            <span>Value</span>
            <span>Source</span>
          </div>
          ${filtered.length === 0
            ? html`<div class="empty">No config keys match.</div>`
            : filtered.map((item) => html`
              <div
                class="row ${this.selectedKey === item.key ? 'active' : ''}"
                @click=${() => this.select(item.key)}
              >
                <div>
                  <div class="key">${item.key}</div>
                  ${item.description ? html`<div class="desc">${item.description}</div>` : ''}
                </div>
                <span class="value">${item.type || '—'}</span>
                <span class="value ${item.value ? '' : 'empty'}">${item.value || '(unset)'}</span>
                <span><span class="src-pill ${item.source}">${item.source}</span></span>
              </div>
            `)}
        </div>
        ${this.selectedKey ? this.renderDrawer() : nothing}
      </div>
    `;
  }

  private renderDrawer() {
    if (this.explainLoading) return html`<div class="drawer"><div class="loading">Loading…</div></div>`;
    if (!this.explain) return html`<div class="drawer"><div class="empty">No detail.</div></div>`;
    const { key, type, values, default: def, layers, resolved } = this.explain;
    return html`
      <div class="drawer">
        <h3>${key}</h3>
        <div class="type">${type}${values ? ` · values: ${values.join(' / ')}` : ''}${def ? ` · default: ${def}` : ''}</div>
        ${resolved ? html`<div class="resolved">Resolved: <strong>${resolved.value}</strong> (${resolved.source})</div>` : ''}
        <div class="layers">
          ${layers.map((l) => html`
            <span class="layer">${l.layer}</span>
            <span class="val">${l.value || '—'}</span>
            <span class="source">${l.source}</span>
          `)}
        </div>
        <div class="editor">
          <label>Set value</label>
          ${values && values.length > 0
            ? html`
                <select .value=${this.editValue} @change=${(e: Event) => { this.editValue = (e.target as HTMLSelectElement).value; }}>
                  ${values.map((v) => html`<option value=${v} ?selected=${v === this.editValue}>${v}</option>`)}
                </select>
              `
            : type === 'bool'
              ? html`
                  <select .value=${this.editValue} @change=${(e: Event) => { this.editValue = (e.target as HTMLSelectElement).value; }}>
                    ${['true', 'false'].map((v) => html`<option value=${v} ?selected=${v === this.editValue}>${v}</option>`)}
                  </select>
                `
              : html`
                  <input
                    .value=${this.editValue}
                    @input=${(e: Event) => { this.editValue = (e.target as HTMLInputElement).value; }}
                  />
                `}
          <label class="scope-row">
            <input
              type="checkbox"
              ?checked=${this.projectScope}
              @change=${(e: Event) => { this.projectScope = (e.target as HTMLInputElement).checked; }}
            />
            Set in project config (--project)
          </label>
          <div class="actions">
            <button class="primary" ?disabled=${this.saving} @click=${this.save}>
              ${this.saving ? 'Saving…' : 'Save'}
            </button>
            <button class="danger" ?disabled=${this.saving} @click=${this.unset} ${tooltip('devai config unset')}>
              Unset
            </button>
          </div>
          ${this.error ? html`<div class="err">${this.error}</div>` : ''}
        </div>
      </div>
    `;
  }
}
