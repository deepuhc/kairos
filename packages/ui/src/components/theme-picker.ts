import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tooltip } from '../directives/tooltip.js';
import {
  getMode,
  getDarkTheme,
  getLightTheme,
  setMode,
  setDarkTheme,
  setLightTheme,
  resolveKind,
  DARK_THEMES,
  LIGHT_THEMES,
  type ThemeMode,
  type ThemeDef,
} from '../services/theme.js';

// Theme control in the header. A button (mirrors .theme-toggle chrome) opens a
// popover with two independent choices, the way VS Code splits color theme from
// the auto light/dark switch:
//   • Mode      — System / Light / Dark (which KIND shows)
//   • Dark theme + Light theme — the default picked for each kind, so `system`
//     mode gives you your light theme by day and your dark theme by night.
@customElement('kairos-theme-picker')
export class DevaiThemePicker extends LitElement {
  @state() private open = false;
  @state() private mode: ThemeMode = getMode();
  @state() private dark = getDarkTheme();
  @state() private light = getLightTheme();

  static styles = css`
    :host { position: relative; display: inline-block; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--header-control-size, 36px);
      height: var(--header-control-size, 36px);
      border: 1px solid var(--header-control-border, var(--glass-border));
      border-radius: var(--header-control-radius, var(--radius));
      background: var(--header-control-bg, var(--glass-bg));
      color: var(--gray);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .btn:hover {
      border-color: var(--header-control-border-hover, var(--accent-a35));
      background: var(--header-control-bg-hover, var(--accent-a15));
      color: var(--bright-white);
    }
    .btn svg { width: 18px; height: 18px; display: block; }

    .menu {
      position: absolute;
      right: 0;
      top: 100%;
      margin-top: 8px;
      width: 300px;
      max-height: min(560px, calc(100vh - 80px));
      overflow-y: auto;
      background: var(--surface-raised);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      z-index: 200;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .section-label {
      font-size: var(--font-size-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--neutral-gray);
    }

    .segment {
      display: flex;
      gap: 4px;
      padding: 3px;
      background: var(--w4);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      margin-top: 6px;
    }
    .segment button {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 6px 8px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .segment button:hover { color: var(--bright-white); }
    .segment button[aria-pressed='true'] {
      background: var(--glass-bg);
      color: var(--bright-white);
      box-shadow: var(--shadow-sm);
    }
    .segment svg { width: 14px; height: 14px; }

    .group + .group { margin-top: 2px; }
    .group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .active-pill {
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--accent);
      background: var(--accent-a15);
      border-radius: 999px;
      padding: 2px 8px;
    }

    .list { display: flex; flex-direction: column; gap: 2px; }
    .theme-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 8px;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: transparent;
      color: var(--white);
      font-size: var(--font-size-sm);
      text-align: left;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .theme-row:hover { background: var(--w6); }
    .theme-row[aria-checked='true'] {
      border-color: var(--accent-a35);
      background: var(--accent-a10);
      color: var(--bright-white);
      font-weight: 500;
    }

    .swatch {
      flex-shrink: 0;
      width: 30px;
      height: 22px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-strong);
      overflow: hidden;
      display: flex;
    }
    .swatch .bg { flex: 1.4; }
    .swatch .fg { flex: 1; display: flex; align-items: center; justify-content: center; }
    .swatch .dot { width: 7px; height: 7px; border-radius: 50%; }

    .theme-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .check { flex-shrink: 0; width: 15px; height: 15px; color: var(--accent); opacity: 0; }
    .theme-row[aria-checked='true'] .check { opacity: 1; }

    .hint {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      line-height: 1.4;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    // Reflect OS flips (system mode) and any other tab's changes.
    window.addEventListener('theme-changed', this.syncFromStore);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('theme-changed', this.syncFromStore);
  }

  private syncFromStore = () => {
    this.mode = getMode();
    this.dark = getDarkTheme();
    this.light = getLightTheme();
  };

  private toggle(e: Event) {
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      return;
    }
    this.syncFromStore();
    this.open = true;
    requestAnimationFrame(() => {
      document.addEventListener('click', this.close, { once: true });
    });
  }

  private close = () => { this.open = false; };

  private pickMode(mode: ThemeMode) {
    this.mode = mode;
    setMode(mode);
  }

  private pickTheme(t: ThemeDef) {
    if (t.kind === 'dark') {
      this.dark = t.id;
      setDarkTheme(t.id);
    } else {
      this.light = t.id;
      setLightTheme(t.id);
    }
  }

  private buttonLabel(): string {
    const kind = resolveKind(this.mode);
    if (this.mode === 'system') return `Theme: System (${kind}) — click to change`;
    return `Theme: ${this.mode === 'dark' ? 'Dark' : 'Light'} — click to change`;
  }

  // Sun / monitor / moon, matching the old cycle-button glyphs.
  private modeIcon(mode: ThemeMode) {
    if (mode === 'system')
      return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
    if (mode === 'light')
      return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
    return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }

  private renderGroup(title: string, themes: ThemeDef[], selectedId: string, activeNow: boolean) {
    return html`
      <div class="group">
        <div class="group-head">
          <span class="section-label">${title}</span>
          ${activeNow ? html`<span class="active-pill">Active</span>` : nothing}
        </div>
        <div class="list" role="radiogroup" aria-label=${title}>
          ${themes.map((t) => {
            const checked = t.id === selectedId;
            return html`
              <button
                class="theme-row"
                role="radio"
                aria-checked=${checked}
                @click=${() => this.pickTheme(t)}
              >
                <span class="swatch">
                  <span class="bg" style="background:${t.swatch[0]}"></span>
                  <span class="fg" style="background:${t.swatch[1]}">
                    <span class="dot" style="background:${t.swatch[2]}"></span>
                  </span>
                </span>
                <span class="theme-name">${t.name}</span>
                <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  render() {
    const kind = resolveKind(this.mode);
    const label = this.buttonLabel();
    return html`
      <button class="btn" @click=${this.toggle} ${tooltip(label)} aria-label=${label} aria-haspopup="true" aria-expanded=${this.open}>
        ${this.modeIcon(kind)}
      </button>
      ${this.open ? html`
        <div
          class="menu"
          data-tauri-drag-region="false"
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @mousedown=${(e: Event) => e.stopPropagation()}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div>
            <span class="section-label">Appearance</span>
            <div class="segment" role="radiogroup" aria-label="Appearance mode">
              ${(['system', 'light', 'dark'] as ThemeMode[]).map((m) => html`
                <button
                  role="radio"
                  aria-checked=${this.mode === m}
                  aria-pressed=${this.mode === m}
                  @click=${() => this.pickMode(m)}
                >${this.modeIcon(m)}${m === 'system' ? 'System' : m === 'light' ? 'Light' : 'Dark'}</button>
              `)}
            </div>
            <div class="hint" style="margin-top:8px">
              ${this.mode === 'system'
                ? 'Follows your OS. Uses the light theme in day mode, the dark theme at night.'
                : `Always ${this.mode}, using the selected ${this.mode} theme below.`}
            </div>
          </div>

          ${this.mode === 'system' ? html`
            ${this.renderGroup('Dark theme (night)', DARK_THEMES, this.dark, kind === 'dark')}
            ${this.renderGroup('Light theme (day)', LIGHT_THEMES, this.light, kind === 'light')}
          ` : this.mode === 'dark'
            ? this.renderGroup('Choose a dark theme', DARK_THEMES, this.dark, true)
            : this.renderGroup('Choose a light theme', LIGHT_THEMES, this.light, true)
          }
        </div>
      ` : nothing}
    `;
  }
}
