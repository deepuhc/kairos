import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getAppsList, getAppsStatus, getPluginsList, getPluginsStatus, getSkillsList, getSkillsStatus, execute, launchApp } from '../services/api.js';
import { io, type Socket } from '../services/events.js';
import './item-card.js';
import './launch-picker.js';
import { tooltip } from '../directives/tooltip.js';
import { agentForApp } from '../services/agent-apps.js';
import { focusRing } from '../styles/focus.js';
import { skeletonStyles, skeletonCardGrid } from '../styles/skeleton.js';
import { emptyState, emptyStateStyles } from './empty-state.js';
import { icon } from './icons.js';

// Apps that don't need a working directory — they're GUI launchers.
const GUI_APPS = new Set(['code', 'code-insiders', 'cursor']);

export interface ChildSkill {
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
  installRepoBranch?: string;
  claudeOnly?: boolean;
  /** apps only — true when the CLI groups this app under "AI Agents" (vs a plain
   *  developer tool like rg/jq). Only agents get a Launch button. */
  isAgent?: boolean;
  installed?: string;
  latest?: string;
  updateAvailable?: boolean;
  parentPlugin?: string;
  childSkills?: ChildSkill[];
  /** Only set in the merged 'plugins-and-skills' view; identifies which subcommand to use. */
  kind?: 'plugin' | 'skill';
}

const CACHE_KEY_PREFIX = 'kairos-catalog:';

function getCached(type: string): CatalogItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + type);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCache(type: string, items: CatalogItem[]) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + type, JSON.stringify(items));
  } catch { /* quota exceeded — ignore */ }
}

const FAVORITES_KEY = CACHE_KEY_PREFIX + 'favorites';

/** Stable favorite key: kind guards against a plugin and skill sharing a name. */
function favoriteKey(item: CatalogItem): string {
  return `${item.kind ?? 'item'}:${item.name}`;
}

// Stable identity for keyed `repeat` of the card grid: favorites float to the
// top and sort order shifts, so positional keys would make Lit re-diff every
// card against the wrong prior element and churn whole custom-element props.
function cardKey(item: CatalogItem): string {
  return item.kind ? `${item.kind}:${item.name}` : item.name;
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch { /* quota exceeded — ignore */ }
}

function rowToItem(r: Record<string, string>): CatalogItem {
  return {
    name: r.name ?? '',
    description: r.description,
    category: r.category,
    source: r.source,
    url: r.url,
    installRepo: r.installRepo,
    installRepoBranch: r.installRepoBranch,
    claudeOnly: r.claudeOnly === 'true',
    isAgent: r.isAgent === 'true',
    parentPlugin: r.parentPlugin,
  };
}

function byInstalledThenName(a: CatalogItem, b: CatalogItem): number {
  const ai = a.installed ? 0 : 1;
  const bi = b.installed ? 0 : 1;
  if (ai !== bi) return ai - bi;
  return a.name.localeCompare(b.name);
}

@customElement('kairos-catalog')
export class DevaiCatalog extends LitElement {
  @property() type: 'apps' | 'plugins' | 'skills' | 'plugins-and-skills' = 'apps';
  @state() private items: CatalogItem[] = [];
  @state() private loading = true;
  @state() private filter = '';
  @state() private statusFilter: 'all' | 'installed' | 'available' = 'all';
  @state() private customName = '';
  @state() private customRepo = '';
  @state() private customBackend: 'all' | 'claude' = 'all';
  @state() private sourceFilter: string = 'all';
  @state() private scope: 'user' | 'project' = 'user';
  @state() private checkingUpdates = false;
  @state() private launchPickerName: string | null = null;
  @state() private verbose = false;
  @state() private sort: 'installed' | 'name' | 'updates' = 'installed';
  @state() private loadError = false;
  @state() private favorites = loadFavorites();
  private socket: Socket | null = null;

  static styles = [focusRing, skeletonStyles, emptyStateStyles, css`
    :host { display: block; }
    .header {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    /* Each toolbar row wraps between control groups if space runs out, but
       individual buttons/labels never break mid-phrase (nowrap below). */
    .toolbar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .title-row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-shrink: 0;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
      white-space: nowrap;
    }
    .result-count {
      font-size: var(--font-size-base);
      color: var(--neutral-gray);
      font-variant-numeric: tabular-nums;
    }
    h2.capitalize {
      text-transform: capitalize;
    }
    h3.section {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--bright-white);
      margin: 8px 0 14px;
      display: flex;
      align-items: baseline;
      gap: 8px;
      /* Keep the section label in view while scrolling its (often long) grid.
         The page scrolls in <main>, whose header scrolls away, so top:0 anchors
         the label to the viewport. A solid canvas + padding stop cards bleeding
         through as they slide under it. */
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg-base);
      padding: 8px 0 10px;
      margin: 0 0 8px;
    }
    h3.section .count {
      font-size: var(--font-size-base);
      font-weight: 400;
      color: var(--neutral-gray);
    }
    .section-divider {
      margin: 36px 0 0;
      border: none;
      border-top: 1px solid var(--glass-border);
    }
    .section-subtitle {
      margin-top: 6px;
      margin-bottom: 16px;
      font-size: var(--font-size-base);
      color: var(--neutral-gray);
    }
    .grid-plugins {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
    }
    @media (max-width: 720px) {
      .grid-plugins { grid-template-columns: 1fr; }
    }
    input {
      padding: 8px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      color: var(--white);
      font-size: var(--font-size-md);
      width: 240px;
      transition: border-color var(--transition-fast);
    }
    .search-input {
      flex: 1;
      min-width: 200px;
      width: auto;
    }
    input::placeholder { color: var(--neutral-gray); }
    input:focus { outline: none; border-color: var(--accent-a35); }
    .sort-select {
      padding: 8px 12px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--gray);
      font-size: var(--font-size-md);
      cursor: pointer;
      white-space: nowrap;
      transition: border-color var(--transition-fast);
    }
    .sort-select:focus { outline: none; border-color: var(--accent-a35); }
    .load-error {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg-elevated);
      color: var(--gray);
      font-size: var(--font-size-md);
    }
    .load-error svg { color: var(--neutral-gray); flex-shrink: 0; }
    /* Brief highlight when a skill's plugin tag scrolls you to the parent card. */
    @keyframes card-flash {
      0%, 100% { box-shadow: none; }
      15% { box-shadow: 0 0 0 2px var(--accent); }
    }
    kairos-item-card.flash { animation: card-flash 1s ease-out; border-radius: var(--radius); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
    }
    @media (max-width: 720px) {
      .grid { grid-template-columns: 1fr; }
    }
    .loading, .empty {
      text-align: center;
      padding: 48px;
      color: var(--gray);
    }
    .refresh-btn {
      padding: 8px 16px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      color: var(--gray);
      font-size: var(--font-size-base);
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .refresh-btn:hover { background: var(--w10); border-color: var(--glass-border-hover); color: var(--white); }
    /* Segmented control: buttons butt together into one pill so a group reads
       as a unit and never splits across a wrap. */
    .filters {
      display: inline-flex;
      flex-shrink: 0;
    }
    .filters .filter-tab {
      border-radius: 0;
      margin-left: -1px;
    }
    .filters .filter-tab:first-child {
      border-top-left-radius: var(--radius);
      border-bottom-left-radius: var(--radius);
      margin-left: 0;
    }
    .filters .filter-tab:last-child {
      border-top-right-radius: var(--radius);
      border-bottom-right-radius: var(--radius);
    }
    .filters .filter-tab.active { z-index: 1; }
    .filter-tab {
      padding: 6px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      color: var(--gray);
      font-size: var(--font-size-base);
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .filter-tab:hover { background: var(--w10); border-color: var(--glass-border-hover); color: var(--white); }
    .filter-tab.active { background: var(--accent-a25); border-color: var(--accent-a35); color: var(--purple-light); }
    .custom-install {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 20px;
      padding: 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
    }
    .custom-install input {
      padding: 8px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-md);
      transition: border-color var(--transition-fast);
    }
    .custom-install input::placeholder { color: var(--neutral-gray); }
    .custom-install input:focus { outline: none; border-color: var(--accent-a35); }
    .custom-install input.name-input { width: 180px; }
    .custom-install input.repo-input { flex: 1; font-family: var(--font-mono); font-size: var(--font-size-base); }
    .custom-install > button {
      padding: 8px 16px;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a25);
      color: var(--purple-light);
      font-size: var(--font-size-base);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .custom-install > button:hover { background: var(--accent-a35); color: var(--bright-white); }
    .custom-install > button:disabled { opacity: 0.4; cursor: not-allowed; }
    .custom-install-label {
      color: var(--gray);
      font-size: var(--font-size-base);
      white-space: nowrap;
    }
    /* Scope/backend share the segmented-pill treatment via .filters. */
    .scope-toggle, .backend-toggle {
      display: inline-flex;
      flex-shrink: 0;
    }
    .scope-toggle .filter-tab, .backend-toggle .filter-tab {
      border-radius: 0;
      margin-left: -1px;
    }
    .scope-toggle .filter-tab:first-child, .backend-toggle .filter-tab:first-child {
      border-top-left-radius: var(--radius);
      border-bottom-left-radius: var(--radius);
      margin-left: 0;
    }
    .scope-toggle .filter-tab:last-child, .backend-toggle .filter-tab:last-child {
      border-top-right-radius: var(--radius);
      border-bottom-right-radius: var(--radius);
    }
    .scope-toggle .filter-tab.active, .backend-toggle .filter-tab.active { z-index: 1; }
    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.socket = io();
    this.loadData();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('type')) this.loadData();
  }

  private async loadData() {
    const cached = getCached(this.type);
    if (cached) {
      this.items = cached;
      this.loading = false;
      this.fetchAndMerge();
    } else {
      this.loading = true;
      await this.fetchAndMerge();
    }
  }

  private async fetchAndMerge() {
    try {
      if (this.type === 'plugins-and-skills') {
        await this.fetchAndMergeCombined();
        return;
      }

      const fetches: [Promise<CatalogItem[]>, Promise<Array<{ name: string; installed: string; latest: string; updateAvailable: boolean; source?: string; description?: string }>>, ...Promise<any>[]] = [
        this.fetchList(),
        this.fetchStatus(),
      ];

      const results = await Promise.allSettled(fetches);
      this.loadError = results.some((r) => r.status === 'rejected');

      const list = results[0].status === 'fulfilled' ? results[0].value : [];
      const statusItems = results[1].status === 'fulfilled' ? results[1].value : [];

      const items = this.mergeListAndStatus(list, statusItems);

      if (this.type === 'skills') {
        const statusMap = new Map(statusItems.map((s) => [s.name, s]));
        for (const item of items) {
          const status = statusMap.get(item.name);
          if (status?.source?.startsWith('plugin:')) {
            item.parentPlugin = status.source.slice('plugin:'.length);
          }
        }
      }

      items.sort(byInstalledThenName);

      setCache(this.type, items);
      this.items = items;
    } finally {
      this.loading = false;
    }
  }

  private async fetchAndMergeCombined() {
    const settled = await Promise.allSettled([
      getPluginsList(),
      getPluginsStatus().then((r) => r.items),
      getSkillsList(),
      getSkillsStatus().then((r) => r.items),
    ]);
    const [pluginListR, pluginStatusR, skillListR, skillStatusR] = settled;
    this.loadError = settled.some((r) => r.status === 'rejected');

    const pluginList = (pluginListR.status === 'fulfilled' ? pluginListR.value : []).map(rowToItem);
    const pluginStatus = pluginStatusR.status === 'fulfilled' ? pluginStatusR.value : [];
    const skillList = (skillListR.status === 'fulfilled' ? skillListR.value : []).map(rowToItem);
    const skillStatus = skillStatusR.status === 'fulfilled' ? skillStatusR.value : [];

    const plugins = this.mergeListAndStatus(pluginList, pluginStatus).map((p) => ({ ...p, kind: 'plugin' as const }));
    const skills = this.mergeListAndStatus(skillList, skillStatus).map((s) => ({ ...s, kind: 'skill' as const }));

    // Resolve parentPlugin for installed skills via `source: plugin:...`
    const skillStatusMap = new Map(skillStatus.map((s) => [s.name, s]));
    for (const skill of skills) {
      const status = skillStatusMap.get(skill.name);
      if (status?.source?.startsWith('plugin:')) {
        skill.parentPlugin = status.source.slice('plugin:'.length);
      }
    }

    // Build childSkills from list/status descriptions, attach to plugins
    const pluginSkillMap = new Map<string, ChildSkill[]>();
    for (const skill of skills) {
      if (!skill.parentPlugin) continue;
      const arr = pluginSkillMap.get(skill.parentPlugin) ?? [];
      arr.push({ name: skill.name, description: skill.description });
      pluginSkillMap.set(skill.parentPlugin, arr);
    }
    for (const plugin of plugins) {
      const childs = pluginSkillMap.get(plugin.name);
      if (childs) plugin.childSkills = childs.sort((a, b) => a.name.localeCompare(b.name));
    }

    plugins.sort(byInstalledThenName);
    // Standalone skills only — those without a parent plugin
    const standaloneSkills = skills.filter((s) => !s.parentPlugin).sort(byInstalledThenName);

    const merged: CatalogItem[] = [...plugins, ...standaloneSkills];
    setCache(this.type, merged);
    this.items = merged;
  }

  /** Merge a list response with status response, preserving order from list and appending status-only items. */
  private mergeListAndStatus(
    list: CatalogItem[],
    statusItems: Array<{ name: string; installed: string; latest: string; updateAvailable: boolean; source?: string; description?: string }>,
  ): CatalogItem[] {
    const statusMap = new Map(statusItems.map((s) => [s.name, s]));
    const items: CatalogItem[] = list.map((item) => {
      const status = statusMap.get(item.name);
      return {
        ...item,
        installed: status?.installed || undefined,
        latest: status?.latest,
        updateAvailable: status?.updateAvailable,
      };
    });
    const listNames = new Set(list.map((i) => i.name));
    for (const s of statusItems) {
      if (!listNames.has(s.name)) {
        items.push({
          name: s.name,
          description: s.description,
          installed: s.installed,
          latest: s.latest,
          updateAvailable: s.updateAvailable,
        });
      }
    }
    return items;
  }

  private async fetchList(): Promise<CatalogItem[]> {
    let rows: Record<string, string>[] = [];
    switch (this.type) {
      case 'apps': rows = await getAppsList(); break;
      case 'plugins': rows = await getPluginsList(); break;
      case 'skills': rows = await getSkillsList(); break;
      case 'plugins-and-skills': rows = []; break; // handled by fetchAndMergeCombined
    }
    return rows.map(rowToItem);
  }

  private fetchStatus(checkUpdates = false): Promise<Array<{ name: string; installed: string; latest: string; updateAvailable: boolean; source?: string; description?: string }>> {
    switch (this.type) {
      case 'apps': return getAppsStatus().then((r) => r.items);
      case 'plugins': return getPluginsStatus(checkUpdates).then((r) => r.items);
      case 'skills': return getSkillsStatus(checkUpdates).then((r) => r.items);
      case 'plugins-and-skills': return Promise.resolve([]); // handled by fetchAndMergeCombined
    }
  }

  private get devaiType(): string {
    // devai CLI uses singular for plugin/skill
    return this.type === 'apps' ? 'apps' : this.type === 'plugins' ? 'plugin' : 'skill';
  }

  /** For an item in the combined view, determine which CLI subcommand applies. */
  private subcommandFor(item: CatalogItem | undefined): string {
    if (this.type === 'plugins-and-skills') {
      return item?.kind === 'skill' ? 'skill' : 'plugin';
    }
    return this.devaiType;
  }

  private async handleAction(e: CustomEvent) {
    const {
      action, name, repoUrl, backend, versionPin, repoVersion, force,
    } = e.detail as {
      action: string; name: string; repoUrl?: string; backend?: string;
      versionPin?: string; repoVersion?: string; force?: boolean;
    };

    if (action === 'start-session') {
      const agent = agentForApp(name);
      if (agent) {
        this.dispatchEvent(new CustomEvent('start-agent-session', {
          detail: { agent },
          bubbles: true,
          composed: true,
        }));
      }
      return;
    }

    if (action === 'launch') {
      if (GUI_APPS.has(name)) {
        await launchApp([name]);
      } else {
        this.launchPickerName = name;
      }
      return;
    }

    const item = this.items.find((i) => i.name === name);
    const itemSubcommand = this.subcommandFor(item);

    // Public-toolkit skills can only be installed via their parent plugin —
    // these toolkits don't expose a top-level `skills/` directory.
    const installViaPlugin = action === 'install'
      && itemSubcommand === 'skill'
      && !!item?.parentPlugin
      && !!item?.installRepo
      && !repoUrl;

    const subcommand = installViaPlugin ? 'plugin' : itemSubcommand;
    const targetName = installViaPlugin ? item!.parentPlugin! : name;
    const installName = (action === 'install' && backend && backend !== 'all')
      ? `${backend}:${targetName}` : targetName;
    const args = [subcommand, action, installName];
    const usingItemRepo = !repoUrl && action === 'install' && !!item?.installRepo;
    const effectiveRepo = repoUrl || (action === 'install' ? item?.installRepo : undefined);
    if (effectiveRepo) args.push('--repo', effectiveRepo);
    if (usingItemRepo && item?.installRepoBranch) args.push('--repo-branch', item.installRepoBranch);
    if (repoVersion && action === 'install' && (subcommand === 'plugin' || subcommand === 'skill')) {
      args.push('--repo-version', repoVersion);
    }
    if (versionPin && action === 'install' && subcommand === 'apps') {
      args.push('--version', versionPin);
    }
    if (force && (subcommand === 'plugin' || subcommand === 'skill')) {
      args.push('--force');
    }
    if (subcommand === 'plugin' && (action === 'install' || action === 'update')) {
      args.push('--scope', this.scope);
    }
    if (subcommand === 'skill' && action === 'install' && this.scope === 'project') {
      args.push('--dir', '.');
    }
    if (this.verbose && (subcommand === 'plugin' || subcommand === 'skill')) {
      args.push('--verbose');
    }
    const { operationId } = await execute(args);
    this.dispatchEvent(new CustomEvent('operation', {
      detail: { operationId, args },
      bubbles: true,
      composed: true,
    }));

    this.socket?.on(`done:${operationId}`, () => {
      this.socket?.off(`done:${operationId}`);
      this.loadData();
    });
  }

  private async handleCheckUpdates() {
    this.checkingUpdates = true;
    try {
      let pluginStatus: Array<{ name: string; latest: string; updateAvailable: boolean }> = [];
      let skillStatus: Array<{ name: string; latest: string; updateAvailable: boolean }> = [];
      if (this.type === 'plugins-and-skills') {
        const [p, s] = await Promise.allSettled([
          getPluginsStatus(true).then((r) => r.items),
          getSkillsStatus(true).then((r) => r.items),
        ]);
        pluginStatus = p.status === 'fulfilled' ? p.value : [];
        skillStatus = s.status === 'fulfilled' ? s.value : [];
      } else {
        const statusItems = await this.fetchStatus(true);
        if (this.type === 'plugins') pluginStatus = statusItems;
        else if (this.type === 'skills') skillStatus = statusItems;
        else {
          // apps — keep old behavior
          const statusMap = new Map(statusItems.map((s) => [s.name, s]));
          this.items = this.items.map((item) => {
            const status = statusMap.get(item.name);
            return status ? { ...item, latest: status.latest, updateAvailable: status.updateAvailable } : item;
          });
          setCache(this.type, this.items);
          return;
        }
      }
      const pluginMap = new Map(pluginStatus.map((s) => [s.name, s]));
      const skillMap = new Map(skillStatus.map((s) => [s.name, s]));
      this.items = this.items.map((item) => {
        const map = item.kind === 'skill' || this.type === 'skills' ? skillMap : pluginMap;
        const status = map.get(item.name);
        return status ? { ...item, latest: status.latest, updateAvailable: status.updateAvailable } : item;
      });
      setCache(this.type, this.items);
    } finally {
      this.checkingUpdates = false;
    }
  }

  private async handleCustomInstall() {
    if (!this.customName || !this.customRepo) return;
    // Custom installs in the merged view always go to plugin (skills can't be cherry-picked from arbitrary repos via `kairos skill`).
    const subcommand = this.type === 'plugins-and-skills' ? 'plugin' : this.devaiType;
    const installName = (subcommand === 'plugin' && this.customBackend !== 'all')
      ? `${this.customBackend}:${this.customName}` : this.customName;
    const args = [subcommand, 'install', installName, '--repo', this.customRepo];
    if (subcommand === 'plugin') args.push('--scope', this.scope);
    if (subcommand === 'skill' && this.scope === 'project') args.push('--dir', '.');
    if (this.verbose && (subcommand === 'plugin' || subcommand === 'skill')) args.push('--verbose');
    const { operationId } = await execute(args);
    this.dispatchEvent(new CustomEvent('operation', {
      detail: { operationId, args },
      bubbles: true,
      composed: true,
    }));
    this.socket?.on(`done:${operationId}`, () => {
      this.socket?.off(`done:${operationId}`);
      this.customName = '';
      this.customRepo = '';
      this.loadData();
    });
  }

  // A skill's "plugin: X" tag is a cross-reference within this same view, so
  // scroll to the parent plugin card and flash it rather than re-navigating.
  private handleNavigatePlugin(e: CustomEvent<string>) {
    const name = e.detail;
    if (!name) return;
    const card = this.renderRoot.querySelector<HTMLElement>(`[data-card-id="plugin:${CSS.escape(name)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    // Force reflow so re-adding the class restarts the animation on repeat clicks.
    void card.offsetWidth;
    card.classList.add('flash');
  }

  private handleToggleFavorite(e: CustomEvent<{ name: string; kind?: 'plugin' | 'skill' }>) {
    const key = `${e.detail.kind ?? 'item'}:${e.detail.name}`;
    const next = new Set(this.favorites);
    if (next.has(key)) next.delete(key); else next.add(key);
    this.favorites = next;
    saveFavorites(next);
  }

  private static readonly SOURCE_LABELS: Array<{ key: string; label: string }> = [
    { key: 'mw-agent-plugins-marketplace', label: 'Marketplace' },
    { key: 'matlab-agentic-toolkit', label: 'MATLAB Toolkit' },
    { key: 'simulink-agentic-toolkit', label: 'Simulink Toolkit' },
    { key: 'desktop-team', label: 'Desktop Team' },
  ];

  private get availableSources(): Array<{ key: string; label: string }> {
    const seen = new Set<string>();
    for (const item of this.items) {
      if (item.source) seen.add(item.source);
    }
    return DevaiCatalog.SOURCE_LABELS.filter((s) => seen.has(s.key));
  }

  // Memoize the filtered+sorted list. `filtered` is read twice per render (the
  // header count and renderBody) and re-read on every keystroke; recomputing it
  // means two sorts + four filter passes each time. Cache keyed on the identity
  // of every input so unrelated state changes (e.g. launchPicker) don't re-sort,
  // and a keystroke recomputes exactly once.
  private filteredCache: { key: string; items: CatalogItem[]; favorites: Set<string>; value: CatalogItem[] } | null = null;

  private get filtered(): CatalogItem[] {
    const key = `${this.statusFilter} ${this.sourceFilter} ${this.filter} ${this.sort}`;
    const cache = this.filteredCache;
    if (cache && cache.key === key && cache.items === this.items && cache.favorites === this.favorites) {
      return cache.value;
    }
    const value = this.computeFiltered();
    this.filteredCache = { key, items: this.items, favorites: this.favorites, value };
    return value;
  }

  private computeFiltered(): CatalogItem[] {
    let result = this.items;

    // Status filter
    if (this.statusFilter === 'installed') {
      result = result.filter((i) => !!i.installed);
    } else if (this.statusFilter === 'available') {
      result = result.filter((i) => !i.installed);
    }

    // Source filter
    if (this.sourceFilter !== 'all') {
      result = result.filter((i) => (i.source ?? '') === this.sourceFilter);
    }

    // Text search
    if (this.filter) {
      const q = this.filter.toLowerCase();
      result = result.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q),
      );
    }

    // Sort, then float favorites to the top within their (already-sorted) order.
    const comparator = this.sort === 'name'
      ? (a: CatalogItem, b: CatalogItem) => a.name.localeCompare(b.name)
      : this.sort === 'updates'
        ? (a: CatalogItem, b: CatalogItem) => {
            const au = a.updateAvailable ? 0 : 1;
            const bu = b.updateAvailable ? 0 : 1;
            return au !== bu ? au - bu : byInstalledThenName(a, b);
          }
        : byInstalledThenName;
    const sorted = [...result].sort(comparator);
    const favorites: CatalogItem[] = [];
    const others: CatalogItem[] = [];
    for (const item of sorted) {
      (this.favorites.has(favoriteKey(item)) ? favorites : others).push(item);
    }
    return [...favorites, ...others];
  }

  render() {
    if (this.loading) {
      return html`
        <div class="header">
          <div class="title-row">
            <h2 class="${this.type === 'plugins-and-skills' ? '' : 'capitalize'}">${this.headerTitle}</h2>
          </div>
        </div>
        ${skeletonCardGrid(6)}
      `;
    }

    const showCustomInstall = this.type === 'skills' || this.type === 'plugins' || this.type === 'plugins-and-skills';
    const showBackendInRepo = this.type === 'plugins' || this.type === 'plugins-and-skills';
    const showScopeToggle = this.type === 'plugins' || this.type === 'plugins-and-skills' || this.type === 'skills';
    const showVerboseToggle = this.type !== 'apps';
    const filtered = this.filtered;
    const availableSources = this.availableSources;

    return html`
      <div class="header">
        <div class="toolbar-row">
          <div class="title-row">
            <h2 class="${this.type === 'plugins-and-skills' ? '' : 'capitalize'}">${this.headerTitle}</h2>
            ${this.loading ? '' : html`<span class="result-count">${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}</span>`}
          </div>
          <input
            class="search-input"
            placeholder="Search…"
            .value=${this.filter}
            @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}
          />
          <div class="toolbar-actions">
            ${this.type !== 'apps' ? html`
              <button class="refresh-btn" ?disabled=${this.checkingUpdates} @click=${() => this.handleCheckUpdates()}>
                ${this.checkingUpdates ? 'Checking…' : 'Check updates'}
              </button>
            ` : ''}
            ${showVerboseToggle ? html`
              <button
                class="refresh-btn"
                ${tooltip('Append --verbose to install/update/uninstall commands')}
                style=${this.verbose ? 'color:var(--purple-light);border-color:var(--accent-a35);background:var(--accent-a15);' : ''}
                @click=${() => { this.verbose = !this.verbose; }}
              >${this.verbose ? '✓ Verbose' : 'Verbose'}</button>
            ` : ''}
            <button class="refresh-btn" @click=${() => this.loadData()}>Refresh</button>
          </div>
        </div>
        <div class="toolbar-row">
          <div class="filters">
            ${(['all', 'installed', 'available'] as const).map(
              (f) => html`
                <button
                  class="filter-tab ${this.statusFilter === f ? 'active' : ''}"
                  @click=${() => { this.statusFilter = f; }}
                >${f === 'all' ? 'All' : f === 'installed' ? 'Installed' : 'Available'}</button>
              `,
            )}
          </div>
          ${this.type !== 'apps' && availableSources.length > 1 ? html`
            <div class="filters">
              <button
                class="filter-tab ${this.sourceFilter === 'all' ? 'active' : ''}"
                @click=${() => { this.sourceFilter = 'all'; }}
              >All sources</button>
              ${availableSources.map(
                (s) => html`
                  <button
                    class="filter-tab ${this.sourceFilter === s.key ? 'active' : ''}"
                    @click=${() => { this.sourceFilter = s.key; }}
                  >${s.label}</button>
                `,
              )}
            </div>
          ` : ''}
          ${showScopeToggle ? html`
            <div class="scope-toggle">
              ${(['user', 'project'] as const).map(
                (s) => html`
                  <button
                    class="filter-tab ${this.scope === s ? 'active' : ''}"
                    ${tooltip(s === 'project' && this.type === 'skills'
                      ? 'Install skills into the current project (passes --dir .)'
                      : `Install scope (--scope ${s})`)}
                    @click=${() => { this.scope = s; this.loadData(); }}
                  >${s.charAt(0).toUpperCase() + s.slice(1)}</button>
                `,
              )}
            </div>
          ` : ''}
          <select
            class="sort-select"
            .value=${this.sort}
            ${tooltip('Sort order')}
            @change=${(e: Event) => { this.sort = (e.target as HTMLSelectElement).value as typeof this.sort; }}
          >
            <option value="installed">Installed first</option>
            <option value="name">Name (A–Z)</option>
            <option value="updates">Updates first</option>
          </select>
        </div>
      </div>
      ${this.loadError ? html`
        <div class="load-error" role="status">
          ${icon.circle(16)}
          <span>Couldn’t load everything — showing what we could reach. Try Refresh.</span>
        </div>
      ` : ''}
      ${showCustomInstall ? html`
        <div class="custom-install">
          <span class="custom-install-label">${this.type === 'skills' ? 'Install skill from repo:' : this.type === 'plugins' ? 'Install plugin from repo:' : 'Install from repo:'}</span>
          ${showBackendInRepo ? html`
            <div class="backend-toggle">
              ${(['all', 'claude'] as const).map(
                (b) => html`
                  <button
                    class="filter-tab ${this.customBackend === b ? 'active' : ''}"
                    @click=${() => { this.customBackend = b; }}
                  >${b.charAt(0).toUpperCase() + b.slice(1)}</button>
                `,
              )}
            </div>
          ` : ''}
          <input
            class="name-input"
            placeholder="${this.type === 'skills' ? 'Skill' : 'Plugin'} name"
            .value=${this.customName}
            @input=${(e: Event) => { this.customName = (e.target as HTMLInputElement).value; }}
          />
          <input
            class="repo-input"
            placeholder="https://gitlab.com/your/repo"
            .value=${this.customRepo}
            @input=${(e: Event) => { this.customRepo = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.handleCustomInstall(); }}
          />
          <button
            ?disabled=${!this.customName || !this.customRepo}
            @click=${() => this.handleCustomInstall()}
          >Install</button>
        </div>
      ` : ''}
      ${this.renderBody()}
      ${this.launchPickerName
        ? html`<kairos-launch-picker
            .appName=${this.launchPickerName}
            @cancel=${() => { this.launchPickerName = null; }}
            @pick=${this.handleLaunchPick}
          ></kairos-launch-picker>`
        : ''}
    `;
  }

  private get headerTitle(): string {
    return this.type === 'plugins-and-skills' ? 'Plugins & Skills' : this.type;
  }

  private renderBody() {
    const filtered = this.filtered;

    if (this.type === 'plugins-and-skills') {
      const plugins = filtered.filter((i) => i.kind === 'plugin');
      const skills = filtered.filter((i) => i.kind === 'skill');
      if (plugins.length === 0 && skills.length === 0) {
        return this.renderEmpty();
      }
      return html`
        ${plugins.length > 0 ? html`
          <h3 class="section">Plugins <span class="count">(${plugins.length})</span></h3>
          <div class="section-subtitle">Skill packs — install one to get all its skills.</div>
          <div class="grid-plugins">${repeat(plugins, cardKey, (item, i) => this.renderCard(item, i))}</div>
        ` : ''}
        ${skills.length > 0 ? html`
          ${plugins.length > 0 ? html`<hr class="section-divider" />` : ''}
          <h3 class="section">Standalone Skills <span class="count">(${skills.length})</span></h3>
          <div class="section-subtitle">Skills not bundled in any plugin.</div>
          <div class="grid">${repeat(skills, cardKey, (item, i) => this.renderCard(item, i))}</div>
        ` : ''}
      `;
    }

    if (filtered.length === 0) {
      return this.renderEmpty();
    }
    return html`<div class="grid">${repeat(filtered, cardKey, (item, i) => this.renderCard(item, i))}</div>`;
  }

  // Distinguishes "your search/filter matched nothing" (offer to clear) from a
  // genuinely empty catalog (nothing installed or available at all).
  private renderEmpty() {
    const searching = this.filter.trim().length > 0;
    const filtering = this.statusFilter !== 'all' || this.sourceFilter !== 'all';
    const noun = this.type === 'plugins-and-skills' ? 'plugins or skills' : this.headerTitle.toLowerCase();
    if (searching || filtering) {
      return emptyState({
        icon: icon.circle(22),
        title: 'Nothing matches',
        message: searching
          ? html`No ${noun} match “${this.filter.trim()}”. Try a looser search.`
          : `No ${this.statusFilter === 'all' ? '' : this.statusFilter + ' '}${noun} right now.`,
        actionLabel: 'Clear filters',
        onAction: () => { this.filter = ''; this.statusFilter = 'all'; this.sourceFilter = 'all'; },
      });
    }
    return emptyState({
      icon: icon.circle(22),
      title: `No ${noun} yet`,
      message: this.type === 'apps'
        ? 'No developer tools or agents are available from your configured marketplaces.'
        : `Nothing to show here — once ${noun} are published to your marketplaces, they’ll appear here.`,
    });
  }

  private renderCard(item: CatalogItem, index = 0) {
    const itemSubcommand = this.subcommandFor(item);
    const isPluginOrSkill = itemSubcommand === 'plugin' || itemSubcommand === 'skill';
    // Cap the stagger so a long grid doesn't ripple for seconds; the first ~12
    // cards fan in, the rest share the last delay.
    const delay = Math.min(index, 12) * 0.03;
    const favoritable = this.type === 'plugins-and-skills';
    return html`
      <kairos-item-card
        style="--enter-delay: ${delay}s"
        data-card-id=${item.kind ? `${item.kind}:${item.name}` : item.name}
        .item=${item}
        ?launchable=${this.type === 'apps' && (item.isAgent || GUI_APPS.has(item.name))}
        .agentId=${this.type === 'apps' ? (agentForApp(item.name) ?? '') : ''}
        ?showRepoInput=${isPluginOrSkill}
        ?showBackendSelector=${itemSubcommand === 'plugin'}
        ?showSkillExpando=${this.type === 'plugins-and-skills' && item.kind === 'plugin'}
        ?showVersionInput=${itemSubcommand === 'apps'}
        ?showRepoVersionInput=${isPluginOrSkill}
        ?supportsForceReinstall=${isPluginOrSkill}
        ?favoritable=${favoritable}
        ?favorited=${favoritable && this.favorites.has(favoriteKey(item))}
        @item-action=${this.handleAction}
        @navigate-plugin=${this.handleNavigatePlugin}
        @toggle-favorite=${this.handleToggleFavorite}
      ></kairos-item-card>
    `;
  }

  private async handleLaunchPick(e: CustomEvent<{ cwd: string }>) {
    const name = this.launchPickerName;
    this.launchPickerName = null;
    if (!name) return;
    await launchApp([name], e.detail.cwd);
  }
}
