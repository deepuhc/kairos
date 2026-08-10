import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tooltip } from '../directives/tooltip.js';
import { focusRing } from '../styles/focus.js';
import { icon } from './icons.js';
import './agent-logo.js';

interface ChildSkill {
  name: string;
  description?: string;
}

interface CatalogItem {
  name: string;
  description?: string;
  category?: string;
  source?: string;
  url?: string;
  installRepo?: string;
  claudeOnly?: boolean;
  installed?: string;
  latest?: string;
  updateAvailable?: boolean;
  parentPlugin?: string;
  childSkills?: ChildSkill[];
  kind?: 'plugin' | 'skill';
}

export type ItemActionDetail = {
  action: string;
  name: string;
  repoUrl?: string;
  backend?: string;
  versionPin?: string;
  repoVersion?: string;
  force?: boolean;
};

@customElement('kairos-item-card')
export class DevaiItemCard extends LitElement {
  @property({ type: Object }) item!: CatalogItem;
  @property({ type: Boolean }) launchable = false;
  /** apps catalog only — agent id this app can run as in the Agents tab, if any.
   * When set, "Start session" becomes the primary action and terminal launch a
   * secondary one; when empty the card shows the plain terminal Launch button. */
  @property() agentId = '';
  @property({ type: Boolean }) showRepoInput = false;
  @property({ type: Boolean }) showBackendSelector = false;
  @property({ type: Boolean }) showSkillExpando = false;
  /** apps catalog only — enables a per-card --version input. */
  @property({ type: Boolean }) showVersionInput = false;
  /** plugin/skill — enables an optional --repo-version input. */
  @property({ type: Boolean }) showRepoVersionInput = false;
  /** plugin/skill — enables a Reinstall (--force) button when installed. */
  @property({ type: Boolean }) supportsForceReinstall = false;
  /** plugins-and-skills — enables the pin/favorite star. */
  @property({ type: Boolean }) favoritable = false;
  @property({ type: Boolean }) favorited = false;
  @state() private repoUrl = '';
  @state() private versionPin = '';
  @state() private repoVersion = '';
  @state() private selectedBackend: 'all' | 'claude' = 'all';
  @state() private showAdvanced = false;

  static styles = [focusRing, css`
    :host {
      display: block;
      /* --enter-delay is set per-card by the catalog to stagger the grid. */
      animation: card-fade-in 0.24s cubic-bezier(0.2, 0, 0, 1) both;
      animation-delay: var(--enter-delay, 0s);
    }
    @keyframes card-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      :host { animation: none; }
    }
    .card {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 16px;
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      box-shadow: var(--widget-shadow);
      transition: all var(--transition-base);
    }
    .card:hover {
      border-color: var(--glass-border-hover);
      background: var(--glass-bg-hover);
      box-shadow: var(--widget-shadow-hover);
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .name {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--bright-white);
    }
    .status-badge {
      font-size: var(--font-size-xs);
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 99px;
    }
    .installed { background: var(--green-a15); color: var(--emerald); }
    .available { background: var(--w8); color: var(--gray); }
    .update { background: var(--amber-a15); color: var(--amber); }
    .claude-only-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 99px;
      background: var(--w8);
      color: var(--gray);
      letter-spacing: 0.01em;
    }
    .badges {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .fav-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }
    .fav-btn:hover { color: var(--gray); }
    .fav-btn.on { color: var(--amber); }
    .fav-btn.on svg { fill: var(--amber); }
    .meta {
      font-size: var(--font-size-base);
      color: var(--gray);
      margin-bottom: 4px;
    }
    .description {
      font-size: var(--font-size-base);
      color: var(--gray);
      line-height: 1.4;
      margin-bottom: 12px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .versions {
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      color: var(--neutral-gray);
      margin-bottom: 12px;
    }
    .repo-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-size-sm);
      color: var(--purple-light);
      text-decoration: none;
      margin-bottom: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color var(--transition-fast);
    }
    .repo-link:hover { color: var(--bright-white); }
    .repo-link svg { flex-shrink: 0; }
    .actions {
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 14px;
      border-radius: var(--radius);
      font-size: var(--font-size-base);
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--glass-border);
      background: var(--w4);
      color: var(--white);
      transition: all var(--transition-fast);
    }
    button:hover { background: var(--w10); border-color: var(--glass-border-hover); }
    button.primary {
      background: var(--accent-a25);
      border-color: var(--accent-a35);
      color: var(--purple-light);
    }
    button.primary:hover { background: var(--accent-a35); color: var(--bright-white); }
    button.danger {
      color: var(--red);
      border-color: var(--red-a25);
      background: var(--red-a15);
    }
    button.danger:hover { background: var(--red-a25); }
    button.launch {
      background: var(--green-a15);
      border-color: var(--green-a30);
      color: var(--emerald);
      font-weight: 600;
    }
    button.launch:hover { background: var(--green-a30); color: var(--bright-white); }
    button.launch-secondary {
      background: var(--w4);
      border-color: var(--glass-border);
      color: var(--gray);
    }
    button.launch-secondary:hover { background: var(--w10); border-color: var(--glass-border-hover); color: var(--white); }
    .plugin-tag {
      display: inline-flex;
      align-items: center;
      font-size: var(--font-size-sm);
      padding: 2px 8px;
      border-radius: 99px;
      background: var(--accent-a15);
      color: var(--purple-light);
      cursor: pointer;
      transition: all var(--transition-fast);
      margin-bottom: 8px;
    }
    .plugin-tag:hover {
      background: var(--accent-a25);
      color: var(--bright-white);
    }
    .child-skills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .skill-chip {
      font-size: var(--font-size-sm);
      padding: 1px 8px;
      border-radius: 99px;
      background: var(--w8);
      color: var(--gray);
    }
    .skill-chip.overflow {
      background: var(--w8);
      color: var(--gray);
    }
    .repo-input-row {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    .repo-input-row input {
      flex: 1;
      padding: 5px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
    }
    .repo-input-row input::placeholder { color: var(--neutral-gray); }
    .repo-input-row input:focus { outline: none; border-color: var(--accent-a35); }
    .options {
      margin-bottom: 12px;
    }
    .options-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      border: none;
      background: none;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: color var(--transition-fast);
    }
    .options-toggle:hover { background: none; color: var(--gray); }
    .options-toggle .chevron {
      display: inline-flex;
      transition: transform var(--transition-fast);
    }
    .options-toggle .chevron svg { display: block; }
    .options.open .options-toggle .chevron { transform: rotate(90deg); }
    .options-body { margin-top: 8px; }
    .backend-row {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .backend-btn {
      padding: 3px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .backend-btn:hover { background: var(--w10); border-color: var(--glass-border-hover); color: var(--white); }
    .backend-btn.active { background: var(--accent-a25); border-color: var(--accent-a35); color: var(--purple-light); }
    .skill-expando {
      margin-bottom: 12px;
      border-top: 1px solid var(--glass-border);
      padding-top: 8px;
    }
    .skill-expando summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-size-sm);
      color: var(--gray);
      padding: 4px 0;
      user-select: none;
      transition: color var(--transition-fast);
    }
    .skill-expando summary::-webkit-details-marker { display: none; }
    .skill-expando summary:hover { color: var(--bright-white); }
    .skill-expando summary .chevron {
      display: inline-flex;
      transition: transform var(--transition-fast);
      color: var(--neutral-gray);
    }
    .skill-expando summary .chevron svg { display: block; }
    .skill-expando[open] summary .chevron { transform: rotate(90deg); }
    .skill-expando summary .count {
      font-weight: 600;
      color: var(--gray);
    }
    .skill-list {
      list-style: none;
      padding: 8px 0 4px 18px;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .skill-list li {
      font-size: var(--font-size-sm);
    }
    .skill-list .skill-name {
      font-weight: 600;
      color: var(--bright-white);
    }
    .skill-list .skill-desc {
      color: var(--gray);
      line-height: 1.4;
      margin-top: 2px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `];

  private fireNavigatePlugin() {
    this.dispatchEvent(new CustomEvent('navigate-plugin', {
      detail: this.item.parentPlugin,
      bubbles: true,
      composed: true,
    }));
  }

  private fireToggleFavorite() {
    this.dispatchEvent(new CustomEvent('toggle-favorite', {
      detail: { name: this.item.name, kind: this.item.kind },
      bubbles: true,
      composed: true,
    }));
  }

  private fire(action: string, opts: { force?: boolean } = {}) {
    // Claude-only public-toolkit plugins: pin backend so install args are explicit
    // and matches the badge the user sees. Otherwise honor the per-card selector.
    const backend = this.item.claudeOnly
      ? 'claude'
      : (this.showBackendSelector ? this.selectedBackend : undefined);
    const detail: ItemActionDetail = {
      action,
      name: this.item.name,
      repoUrl: this.repoUrl || undefined,
      backend,
      versionPin: action === 'install' ? (this.versionPin || undefined) : undefined,
      repoVersion: action === 'install' ? (this.repoVersion || undefined) : undefined,
      force: opts.force,
    };
    this.dispatchEvent(new CustomEvent('item-action', {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  /** Convert a .git clone URL to a browsable web URL. */
  private browseUrl(gitUrl: string): string {
    return gitUrl.replace(/\.git$/, '');
  }

  /**
   * Public-toolkit skills can only be installed via their parent plugin
   * (the toolkit repos don't expose a top-level `skills/` directory).
   */
  private installsViaPlugin(): boolean {
    return !!this.item.parentPlugin && !!this.item.installRepo;
  }

  /** Whether any advanced install control would render for this card. */
  private hasInstallOptions(): boolean {
    return (this.showBackendSelector && !this.item.claudeOnly)
      || (this.showRepoInput && !this.item.installRepo)
      || this.showVersionInput
      || this.showRepoVersionInput;
  }

  private installButtonLabel(): string {
    if (this.installsViaPlugin()) return `Install plugin: ${this.item.parentPlugin}`;
    return 'Install';
  }

  private installButtonTitle(): string {
    if (this.installsViaPlugin()) {
      return `Installs the "${this.item.parentPlugin}" plugin, which includes this skill and its siblings.`;
    }
    return '';
  }

  render() {
    const { name, description, category, source, url, installed, latest, updateAvailable } = this.item;
    const isInstalled = !!installed;

    return html`
      <div class="card">
        <div class="top">
          <span class="name">${name}</span>
          <div class="badges">
            ${this.item.claudeOnly && !isInstalled
              ? html`<span class="claude-only-badge" ${tooltip("This plugin is only published for Claude Code in the upstream toolkit. Other backends (Codex, Gemini, Copilot) won't receive it.")}><agent-logo .agent=${'claude'} .size=${12}></agent-logo>Claude only</span>`
              : ''}
            ${updateAvailable
              ? html`<span class="status-badge update">Update</span>`
              : isInstalled
                ? html`<span class="status-badge installed">Installed</span>`
                : html`<span class="status-badge available">Available</span>`
            }
            ${this.favoritable ? html`
              <button
                class="fav-btn ${this.favorited ? 'on' : ''}"
                ${tooltip(this.favorited ? 'Unpin' : 'Pin to top')}
                aria-label=${this.favorited ? 'Unpin' : 'Pin to top'}
                aria-pressed=${this.favorited ? 'true' : 'false'}
                @click=${() => this.fireToggleFavorite()}
              >${icon.star(15)}</button>
            ` : ''}
          </div>
        </div>
        ${description ? html`<div class="description" ${tooltip(description)}>${description}</div>` : ''}
        ${category || source ? html`<div class="meta">${[category, source].filter(Boolean).join(' · ')}</div>` : ''}
        ${this.item.parentPlugin ? html`
          <span class="plugin-tag" ${tooltip(`From plugin: ${this.item.parentPlugin}`)}
            @click=${() => this.fireNavigatePlugin()}>
            plugin: ${this.item.parentPlugin}
          </span>
        ` : ''}
        ${this.item.childSkills?.length ? this.showSkillExpando
          ? html`
            <details class="skill-expando">
              <summary>
                <span class="chevron">${icon.chevronRight(12)}</span>
                <span class="count">${this.item.childSkills.length}</span>
                skill${this.item.childSkills.length === 1 ? '' : 's'} included
              </summary>
              <ul class="skill-list">
                ${this.item.childSkills.map((s) => html`
                  <li>
                    <div class="skill-name">${s.name}</div>
                    ${s.description ? html`<div class="skill-desc">${s.description}</div>` : ''}
                  </li>
                `)}
              </ul>
            </details>
          `
          : html`
            <div class="child-skills">
              ${this.item.childSkills.slice(0, 5).map(
                (s) => html`<span class="skill-chip">${s.name}</span>`
              )}
              ${this.item.childSkills.length > 5
                ? html`<span class="skill-chip overflow">+${this.item.childSkills.length - 5} more</span>`
                : ''}
            </div>
          ` : ''}
        ${isInstalled && (installed !== 'yes' || latest) ? html`
          <div class="versions">
            ${installed}${latest ? html` &rarr; ${latest}` : ''}
          </div>
        ` : ''}
        ${url ? html`
          <a class="repo-link" href="${this.browseUrl(url)}" target="_blank" rel="noopener" ${tooltip(this.browseUrl(url))}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>
            Repo
          </a>
        ` : ''}
        ${!isInstalled && this.hasInstallOptions() ? html`
          <div class="options ${this.showAdvanced ? 'open' : ''}">
            <button class="options-toggle" type="button"
              aria-expanded=${this.showAdvanced ? 'true' : 'false'}
              @click=${() => { this.showAdvanced = !this.showAdvanced; }}>
              <span class="chevron">${icon.chevronRight(12)}</span>
              Install options
            </button>
            ${this.showAdvanced ? html`
              <div class="options-body">
                ${this.showBackendSelector && !this.item.claudeOnly ? html`
                  <div class="backend-row">
                    ${(['all', 'claude'] as const).map(
                      (b) => html`
                        <button class="backend-btn ${this.selectedBackend === b ? 'active' : ''}"
                          @click=${() => { this.selectedBackend = b; }}
                        >${b.charAt(0).toUpperCase() + b.slice(1)}</button>
                      `,
                    )}
                  </div>
                ` : ''}
                ${this.showRepoInput && !this.item.installRepo ? html`
                  <div class="repo-input-row">
                    <input
                      placeholder="--repo https://gitlab.com/..."
                      .value=${this.repoUrl}
                      @input=${(e: Event) => { this.repoUrl = (e.target as HTMLInputElement).value; }}
                    />
                  </div>
                ` : ''}
                ${this.showVersionInput ? html`
                  <div class="repo-input-row">
                    <input
                      placeholder="--version (e.g. 2.1.146)"
                      ${tooltip('Pin a specific version (passed as --version to kairos apps install)')}
                      .value=${this.versionPin}
                      @input=${(e: Event) => { this.versionPin = (e.target as HTMLInputElement).value; }}
                    />
                  </div>
                ` : ''}
                ${this.showRepoVersionInput ? html`
                  <div class="repo-input-row">
                    <input
                      placeholder="--repo-version (tag or ref)"
                      ${tooltip('Pin to a specific marketplace tag (passed as --repo-version)')}
                      .value=${this.repoVersion}
                      @input=${(e: Event) => { this.repoVersion = (e.target as HTMLInputElement).value; }}
                    />
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
        <div class="actions">
          ${isInstalled
            ? html`
                ${this.launchable
                  ? this.agentId
                    ? html`
                        <button class="launch" @click=${() => this.fire('start-session')}
                          ${tooltip('Start an interactive agent session in the Agents tab')}>Start session</button>
                        <button class="launch-secondary" @click=${() => this.fire('launch')}
                          ${tooltip('Launch in a system terminal window instead')}>Terminal</button>
                      `
                    : html`<button class="launch" @click=${() => this.fire('launch')}>Launch</button>`
                  : ''}
                ${updateAvailable ? html`<button class="primary" @click=${() => this.fire('update')}>Update</button>` : ''}
                ${this.supportsForceReinstall ? html`
                  <button
                    ${tooltip('Reinstall (passes --force)')}
                    @click=${() => this.fire('install', { force: true })}
                  >Reinstall</button>
                ` : ''}
                <button class="danger" @click=${() => this.fire('uninstall')}>Uninstall</button>
              `
            : html`<button class="primary" @click=${() => this.fire('install')}
                ${tooltip(this.installButtonTitle())}>${this.installButtonLabel()}</button>`
          }
        </div>
      </div>
    `;
  }
}
