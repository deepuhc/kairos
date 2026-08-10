// Bridges the Agents tab's browser-local preferences to the standard on-disk
// stores. Two responsibilities:
//
//  1. Boot hydration + one-time migration (`hydrateAgentPrefs`): on first load
//     after this feature ships, seed the disk stores from whatever was in
//     localStorage, then treat disk as authoritative and mirror it back into
//     localStorage so the synchronous getters elsewhere stay fast. Prompt
//     snippets (`kairos-agents:prompts`) migrate into ~/.kairos/config.json via
//     the `/agents/prompts` API — engine-agnostic and shared across browsers.
//
//  2. Write-through (`pushPrefs`): app-only prefs (last cwd/agent, auto-accept
//     default, per-agent config) live in ~/.kairos/config.json.
//     The existing synchronous setters keep writing localStorage for instant
//     reads; they also call pushPrefs to persist to disk fire-and-forget.
//
// localStorage stays only as a hydrated cache — disk is the source of truth.

import {
  getAgentPrefs, saveAgentPrefs, getPrompts, createPrompt,
  type AgentPrefs, type SavedConfig,
} from './api.js';
import { promptId } from './prompt-util.js';

// Keys owned here (mirror the constants in agents-view.ts).
const LAST_CWD_KEY = 'kairos-agents:last-cwd';
const LAST_AGENT_KEY = 'kairos-agents:last-agent';
const AUTO_ACCEPT_KEY = 'kairos-agents:auto-accept';
const CONFIG_KEY_PREFIX = 'kairos-agents:config:';
const PROMPTS_KEY = 'kairos-agents:prompts';

// One-time migration guards.
const MIGRATED_PREFS_FLAG = 'kairos-agents:migrated-prefs';
const MIGRATED_PROMPTS_FLAG = 'kairos-agents:migrated-prompts';

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

// The most-recently-used agent id (synchronous localStorage read, hydrated from
// disk at boot). Defaults to 'claude'. Shared so surfaces outside the Agents tab
// (e.g. History's "Search with <agent>") can target the same engine.
export function loadLastAgent(): string {
  return lsGet(LAST_AGENT_KEY) || 'claude';
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* quota / disabled */ }
}

// Fire-and-forget disk persist. Never throws (fetch may be absent in tests).
export function pushPrefs(partial: Partial<AgentPrefs>): void {
  try {
    void saveAgentPrefs(partial).catch(() => {});
  } catch { /* no fetch — ignore */ }
}

// Read the current localStorage prefs into the AgentPrefs shape, so we can seed
// disk from them on first migration.
function readLocalPrefs(): AgentPrefs {
  const savedConfigs: Record<string, SavedConfig> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(CONFIG_KEY_PREFIX)) {
        const agentId = key.slice(CONFIG_KEY_PREFIX.length);
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '{}');
          if (parsed && typeof parsed === 'object') savedConfigs[agentId] = parsed;
        } catch { /* skip */ }
      }
    }
  } catch { /* localStorage unavailable */ }
  return {
    lastCwd: lsGet(LAST_CWD_KEY) ?? '',
    lastAgent: lsGet(LAST_AGENT_KEY) ?? '',
    autoAccept: lsGet(AUTO_ACCEPT_KEY) === '1',
    savedConfigs,
  };
}

// Mirror disk prefs back into localStorage so the synchronous getters read
// current values (e.g. on a second machine that never had this data locally).
function writeLocalPrefs(prefs: AgentPrefs): void {
  lsSet(LAST_CWD_KEY, prefs.lastCwd);
  if (prefs.lastAgent) lsSet(LAST_AGENT_KEY, prefs.lastAgent);
  lsSet(AUTO_ACCEPT_KEY, prefs.autoAccept ? '1' : '0');
  for (const [agentId, config] of Object.entries(prefs.savedConfigs)) {
    lsSet(CONFIG_KEY_PREFIX + agentId, JSON.stringify(config));
  }
}

function prefsAreEmpty(p: AgentPrefs): boolean {
  return !p.lastCwd && !p.lastAgent && !p.autoAccept
    && Object.keys(p.savedConfigs).length === 0;
}

// Seed server-side prompts (config.json) from any localStorage prompt snippets
// left over from the old browser-local store. Only runs when the server has no
// prompts yet, so it never clobbers or duplicates prompts created since. Aborts
// without setting the flag on failure so it retries next boot.
async function migratePromptsToConfig(): Promise<void> {
  if (lsGet(MIGRATED_PROMPTS_FLAG) === '1') return;
  let legacy: Array<{ name: string; description?: string; body: string }>;
  try {
    const raw = lsGet(PROMPTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    legacy = Array.isArray(parsed) ? parsed : [];
  } catch {
    legacy = [];
  }
  if (legacy.length > 0) {
    let existing;
    try {
      existing = (await getPrompts()).prompts;
    } catch {
      // Can't confirm server state — abort without the flag so we retry.
      return;
    }
    // Only migrate into an empty server store; a non-empty one means the user
    // already has prompts (created here or migrated on another browser).
    if (existing.length === 0) {
      const created: typeof existing = [];
      for (const p of legacy) {
        if (!p?.name?.trim() || !p?.body?.trim()) continue;
        const id = promptId(p.name, created);
        try {
          const res = await createPrompt({ id, name: p.name, description: p.description, body: p.body });
          created.push(res.prompt);
        } catch { /* skip this one; flag stays unset so we retry */ return; }
      }
    }
  }
  lsSet(MIGRATED_PROMPTS_FLAG, '1');
}

let hydrated = false;

// Called once at app boot. Reconciles localStorage with the on-disk stores and
// runs the one-time migrations. Safe to call when offline (falls back to the
// existing localStorage values).
export async function hydrateAgentPrefs(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  try {
    const { prefs } = await getAgentPrefs();
    if (lsGet(MIGRATED_PREFS_FLAG) !== '1') {
      // First run: if disk is empty but the browser has data, seed disk from it.
      const local = readLocalPrefs();
      if (prefsAreEmpty(prefs) && !prefsAreEmpty(local)) {
        pushPrefs(local);
        writeLocalPrefs(local);
      } else {
        writeLocalPrefs(prefs);
      }
      lsSet(MIGRATED_PREFS_FLAG, '1');
    } else {
      // Disk is authoritative on subsequent loads.
      writeLocalPrefs(prefs);
    }
  } catch {
    // Offline / server down — keep whatever's in localStorage.
  }

  await migratePromptsToConfig();
}
