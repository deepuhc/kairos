import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  getFeaturesList, explainFeature, setFeature, unsetFeature,
  type FeatureFlag, type FeatureExplain,
} from '../services/api.js';
import { tooltip } from '../directives/tooltip.js';

// Map of flag → which navigable view it gates, so users can jump there
// once they've enabled the flag. Empty string means no UI view exists yet.
const GATED_VIEW: Record<string, string> = {
  // none currently — review/scaffold/devcontainers have no UI yet
};

@customElement('kairos-features')
export class DevaiFeatures extends LitElement {
  @state() private items: FeatureFlag[] = [];
  @state() private filter = '';
  @state() private showAll = false;
  @state() private loading = true;
  @state() private explanations: Record<string, FeatureExplain | null> = {};
  @state() private toggling: Record<string, boolean> = {};
  @state() private error: string | null = null;

  static styles = css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0 16px;
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
    .group { margin-bottom: 18px; }
    .group-title {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 6px 0;
      border-bottom: 1px solid var(--glass-border);
      margin-bottom: 6px;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) auto auto;
      gap: 12px;
      align-items: center;
      padding: 10px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      margin-bottom: 6px;
      background: var(--glass-bg);
    }
    .row:hover { background: var(--glass-bg-hover); }
    .flag-name {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      color: var(--bright-white);
      word-break: break-all;
    }
    .flag-desc {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      margin-top: 2px;
      line-height: 1.3;
    }
    .pills { display: flex; gap: 4px; }
    .pill {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 99px;
      font-size: var(--font-size-xs);
      font-weight: 600;
    }
    .pill.alpha { background: var(--amber-a25); color: var(--amber); }
    .pill.beta { background: var(--accent-a15); color: var(--purple-light); }
    .pill.ga { background: var(--green-a15); color: var(--emerald); }
    .pill.src { background: var(--w8); color: var(--gray); }
    .pill.src.user, .pill.src.env, .pill.src.project { background: var(--accent-a15); color: var(--purple-light); }
    /* Switch — pure CSS toggle */
    .switch {
      position: relative;
      width: 38px;
      height: 22px;
      border-radius: 99px;
      background: var(--w8);
      cursor: pointer;
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--white);
      transition: left var(--transition-fast);
    }
    .switch.on { background: var(--emerald); }
    .switch.on::after { left: 18px; }
    .switch.disabled { opacity: 0.4; cursor: not-allowed; }
    .why {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      margin-top: 6px;
      grid-column: 1 / -1;
      padding: 8px 10px;
      background: var(--w4);
      border-radius: var(--radius);
      font-family: var(--font-mono);
      line-height: 1.4;
    }
    .why .layers { display: grid; grid-template-columns: max-content auto auto; gap: 2px 12px; }
    .why .resolved { color: var(--emerald); margin-top: 4px; }
    .why-toggle {
      background: none;
      border: none;
      padding: 0;
      font-size: var(--font-size-xs);
      color: var(--purple-light);
      cursor: pointer;
      grid-column: 1 / -1;
      margin-top: 4px;
      text-align: left;
    }
    .why-toggle:hover { color: var(--bright-white); }
    .gated-link {
      grid-column: 1 / -1;
      margin-top: 4px;
      font-size: var(--font-size-xs);
      color: var(--purple-light);
      cursor: pointer;
    }
    .gated-link:hover { color: var(--bright-white); }
    .err {
      color: var(--red);
      font-size: var(--font-size-sm);
      margin-bottom: 8px;
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
      const res = await getFeaturesList(this.showAll);
      this.items = res.items;
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  private async toggleFlag(flag: FeatureFlag) {
    if (flag.source === 'env') return; // env-overridden — disabled
    this.toggling = { ...this.toggling, [flag.flag]: true };
    this.error = null;
    try {
      const next = flag.value === 'true' ? false : true;
      await setFeature(flag.flag, next);
      await this.load();
      // Refresh explain if open
      if (this.explanations[flag.flag] !== undefined) {
        this.explanations = {
          ...this.explanations,
          [flag.flag]: await explainFeature(flag.flag),
        };
      }
    } catch (err: any) {
      this.error = err.message;
    } finally {
      const { [flag.flag]: _, ...rest } = this.toggling;
      this.toggling = rest;
    }
  }

  private async unset(flag: string) {
    this.toggling = { ...this.toggling, [flag]: true };
    try {
      await unsetFeature(flag);
      await this.load();
    } catch (err: any) {
      this.error = err.message;
    } finally {
      const { [flag]: _, ...rest } = this.toggling;
      this.toggling = rest;
    }
  }

  private async toggleWhy(flag: string) {
    if (this.explanations[flag] !== undefined) {
      // collapse
      const { [flag]: _, ...rest } = this.explanations;
      this.explanations = rest;
      return;
    }
    this.explanations = { ...this.explanations, [flag]: null };
    try {
      const explain = await explainFeature(flag);
      this.explanations = { ...this.explanations, [flag]: explain };
    } catch (err: any) {
      this.error = err.message;
    }
  }

  private nav(view: string) {
    this.dispatchEvent(new CustomEvent('navigate', { detail: view, bubbles: true, composed: true }));
  }

  // Memoize the filter+group+sort work keyed on (items, filter): render also
  // fires on toggle/explanation state changes, which don't affect grouping.
  private groupsCache: { items: FeatureFlag[]; filter: string; value: Array<[string, FeatureFlag[]]> } | null = null;

  private groupedFlags(): Array<[string, FeatureFlag[]]> {
    const cache = this.groupsCache;
    if (cache && cache.items === this.items && cache.filter === this.filter) return cache.value;
    const filter = this.filter.toLowerCase();
    const filtered = filter
      ? this.items.filter((i) =>
          i.flag.toLowerCase().includes(filter) ||
          i.description.toLowerCase().includes(filter))
      : this.items;

    // Group by namespace prefix (apps., exec., review., ...)
    const groups = new Map<string, FeatureFlag[]>();
    for (const item of filtered) {
      const prefix = item.flag.includes('.') ? item.flag.split('.')[0] : 'other';
      const arr = groups.get(prefix) ?? [];
      arr.push(item);
      groups.set(prefix, arr);
    }
    const value = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    this.groupsCache = { items: this.items, filter: this.filter, value };
    return value;
  }

  render() {
    if (this.loading) return html`<div class="loading">Loading feature flags...</div>`;
    const groups = this.groupedFlags();

    return html`
      <h2>Feature flags</h2>
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}
      <div class="header">
        <input
          class="search"
          placeholder="Search flags..."
          .value=${this.filter}
          @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}
        />
        <button
          class="toggle ${this.showAll ? 'active' : ''}"
          ${tooltip('Include hidden / internal flags')}
          @click=${async () => { this.showAll = !this.showAll; await this.load(); }}
        >${this.showAll ? '✓ Show hidden' : 'Show hidden'}</button>
      </div>
      ${groups.map(([group, flags]) => html`
        <div class="group">
          <div class="group-title">${group}</div>
          ${flags.map((f) => this.renderRow(f))}
        </div>
      `)}
    `;
  }

  private renderRow(f: FeatureFlag) {
    const enabled = f.value === 'true';
    const envOverride = f.source === 'env';
    const stabilityClass = (f.stability || '').toLowerCase().replace(/[^a-z]/g, '');
    const explainOpen = this.explanations[f.flag] !== undefined;
    const explain = this.explanations[f.flag];
    const gatedView = GATED_VIEW[f.flag];

    return html`
      <div class="row">
        <div>
          <div class="flag-name">${f.flag}</div>
          ${f.description ? html`<div class="flag-desc">${f.description}</div>` : ''}
        </div>
        <div class="pills">
          ${f.stability ? html`<span class="pill ${stabilityClass}">${f.stability}</span>` : ''}
          <span class="pill src ${f.source}" ${tooltip('resolved source')}>${f.source}</span>
        </div>
        <div
          class="switch ${enabled ? 'on' : ''} ${envOverride || this.toggling[f.flag] ? 'disabled' : ''}"
          ${tooltip(envOverride ? `Overridden by env var (DEVAI_FLAG_${f.flag.toUpperCase().replace(/[.-]/g, '_')})` : `Toggle (currently ${f.value})`)}
          @click=${() => this.toggleFlag(f)}
        ></div>
        <button class="why-toggle" @click=${() => this.toggleWhy(f.flag)}>
          ${explainOpen ? '▾ Hide details' : '▸ Why?'}
        </button>
        ${enabled && f.source !== 'default' ? html`
          <button class="why-toggle" style="color: var(--red);" @click=${() => this.unset(f.flag)}>
            Unset override
          </button>
        ` : ''}
        ${explainOpen ? this.renderWhy(explain) : nothing}
        ${enabled && gatedView ? html`
          <span class="gated-link" @click=${() => this.nav(gatedView)}>
            Open ${gatedView} →
          </span>
        ` : ''}
      </div>
    `;
  }

  private renderWhy(explain: FeatureExplain | null) {
    if (!explain) return html`<div class="why">Loading…</div>`;
    return html`
      <div class="why">
        <div class="layers">
          ${explain.layers.map((l) => html`
            <span>${l.layer}</span>
            <span>${l.value || '—'}</span>
            <span style="color: var(--neutral-gray);">${l.source}</span>
          `)}
        </div>
        ${explain.resolved
          ? html`<div class="resolved">→ Resolved: ${explain.resolved.value} (${explain.resolved.source})</div>`
          : ''}
      </div>
    `;
  }
}
