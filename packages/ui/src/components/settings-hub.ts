import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getWorkspaces, type WorkspaceEntry, type RuleScope } from '../services/api.js';
import { focusRing } from '../styles/focus.js';
import './rules-view.js';
import './prompts-view.js';
import './roles-view.js';
import './mcp-view.js';
import './hooks-view.js';
import './config.js';
import './features.js';
import './doctor.js';
import './updates-view.js';
import './security-view.js';
import './catalog.js';

// Two-pane shell that groups the settings-like views behind one tab. A left rail
// lists the sections; the right pane renders the selected one. Two flavors,
// chosen by `kind`:
//   customize — agent-facing config (Rules, Prompts, Roles, MCP, Hooks). The
//               Rules editor is scoped global vs. project, so the shell owns the
//               scope tabs + workspace picker and passes scope/cwd down to the
//               sections that declare `scoped: true`.
//   settings  — devai environment (Apps, Config, Features, Updates, Security,
//               Doctor). No scope.
// The per-view <h2> titles stay as pane headings; the rail label is the nav copy.

type Section = {
  id: string;
  label: string;
  // Whether this section supports the global-vs-project scope selector. Only the
  // AGENTS.md rules editor does; MCP/Hooks are global-only in the kairos CLI and
  // Prompts/Roles are global config.json entries.
  scoped?: boolean;
};

const CUSTOMIZE_SECTIONS: Section[] = [
  { id: 'rules', label: 'Rules', scoped: true },
  { id: 'prompts', label: 'Prompts' },
  { id: 'roles', label: 'Roles' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'hooks', label: 'Hooks' },
];

const SETTINGS_SECTIONS: Section[] = [
  { id: 'apps', label: 'Apps' },
  { id: 'config', label: 'Config' },
  { id: 'features', label: 'Features' },
  { id: 'updates', label: 'Updates' },
  { id: 'security', label: 'Security' },
  { id: 'doctor', label: 'Doctor' },
];

const TITLES: Record<'customize' | 'settings', { title: string; subtitle: string }> = {
  customize: {
    title: 'Customize',
    subtitle: 'Shape how agents behave — instructions, prompts, roles, tools, and hooks.',
  },
  settings: {
    title: 'kairos settings',
    subtitle: 'Manage the kairos environment — apps, configuration, feature flags, updates, security, and diagnostics.',
  },
};

@customElement('kairos-settings-hub')
export class DevaiSettingsHub extends LitElement {
  @property({ type: String }) kind: 'customize' | 'settings' = 'customize';
  // Optionally deep-link to a section (e.g. from a cross-view navigate).
  @property({ type: String }) section: string | null = null;

  @state() private active = '';
  @state() private scope: RuleScope = 'global';
  @state() private cwd: string | null = null;
  @state() private workspaces: WorkspaceEntry[] = [];

  static styles = [focusRing, css`
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
      margin-bottom: 20px;
    }
    .layout {
      display: grid;
      grid-template-columns: var(--rail-width) 1fr;
      gap: 24px;
      align-items: start;
    }
    .rail { display: flex; flex-direction: column; gap: 4px; }
    .rail-item {
      padding: 9px 14px;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-md);
      /* Constant weight across states — active is carried by color + wash +
         border, so the label width never changes on select. */
      font-weight: 500;
      text-align: left;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .rail-item:hover { background: var(--w8); color: var(--white); }
    .rail-item.active {
      background: var(--accent-a15);
      border-color: var(--accent-a35);
      color: var(--bright-white);
    }
    .pane { min-width: 0; }
    .scope-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .scope-tabs { display: flex; gap: 4px; }
    .scope-tab {
      padding: 7px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .scope-tab:hover { background: var(--w8); color: var(--white); }
    .scope-tab.active {
      background: var(--accent-a25);
      color: var(--accent);
      border-color: var(--accent-a35);
    }
    .scope-bar select {
      flex: 1;
      max-width: 480px;
      padding: 7px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
    }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.loadWorkspaces();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('kind') || changed.has('section')) {
      const sections = this.sections;
      const wanted = this.section && sections.some((s) => s.id === this.section) ? this.section : null;
      if (wanted) this.active = wanted;
      else if (!sections.some((s) => s.id === this.active)) this.active = sections[0]?.id ?? '';
    }
  }

  private get sections(): Section[] {
    return this.kind === 'settings' ? SETTINGS_SECTIONS : CUSTOMIZE_SECTIONS;
  }

  private get activeSection(): Section | undefined {
    return this.sections.find((s) => s.id === this.active);
  }

  private async loadWorkspaces() {
    try {
      const result = await getWorkspaces();
      this.workspaces = result.workspaces.filter((w) => w.exists);
    } catch {
      // empty list is fine
    }
  }

  render() {
    const meta = TITLES[this.kind];
    const active = this.active || this.sections[0]?.id || '';
    return html`
      <h2>${meta.title}</h2>
      <div class="subtitle">${meta.subtitle}</div>
      <div class="layout">
        <div class="rail">
          ${this.sections.map(
            (s) => html`
              <button
                class="rail-item ${s.id === active ? 'active' : ''}"
                @click=${() => { this.active = s.id; }}
              >${s.label}</button>
            `,
          )}
        </div>
        <div class="pane">
          ${this.renderScopeBar()}
          ${this.renderSection(active)}
        </div>
      </div>
    `;
  }

  private renderScopeBar() {
    if (!this.activeSection?.scoped) return nothing;
    return html`
      <div class="scope-bar">
        <div class="scope-tabs">
          <button
            class="scope-tab ${this.scope === 'global' ? 'active' : ''}"
            @click=${() => { this.scope = 'global'; }}
          >Global</button>
          <button
            class="scope-tab ${this.scope === 'project' ? 'active' : ''}"
            @click=${() => { this.scope = 'project'; }}
          >Project</button>
        </div>
        ${this.scope === 'project'
          ? html`
              <select
                @change=${(e: Event) => { this.cwd = (e.target as HTMLSelectElement).value || null; }}
              >
                <option value="" ?selected=${!this.cwd}>Select a workspace…</option>
                ${this.workspaces.map(
                  (w) => html`<option value=${w.path} ?selected=${this.cwd === w.path}>${w.name} — ${w.path}</option>`,
                )}
              </select>
            `
          : nothing}
      </div>
    `;
  }

  private renderSection(id: string) {
    // Scoped sections receive scope/cwd; the rest manage their own state.
    switch (id) {
      case 'apps':
        return html`<kairos-catalog type="apps"></kairos-catalog>`;
      case 'rules':
        return html`<kairos-rules .scope=${this.scope} .cwd=${this.cwd}></kairos-rules>`;
      case 'prompts':
        return html`<kairos-prompts></kairos-prompts>`;
      case 'roles':
        return html`<kairos-roles></kairos-roles>`;
      case 'mcp':
        return html`<kairos-mcp></kairos-mcp>`;
      case 'hooks':
        return html`<kairos-hooks></kairos-hooks>`;
      case 'config':
        return html`<kairos-config></kairos-config>`;
      case 'features':
        return html`<kairos-features></kairos-features>`;
      case 'updates':
        return html`<kairos-updates></kairos-updates>`;
      case 'security':
        return html`<kairos-security></kairos-security>`;
      case 'doctor':
        return html`<kairos-doctor></kairos-doctor>`;
      default:
        return nothing;
    }
  }
}
