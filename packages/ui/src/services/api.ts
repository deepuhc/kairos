import { ensureBackendCookie, fetchWithAuth } from './backend-auth.js';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureBackendCookie();
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error ?? res.statusText) as Error & { unsupported?: boolean };
    if (err.unsupported) error.unsupported = true;
    throw error;
  }
  return res.json();
}

// Auth
export const getAuthStatus = () => request<{
  loggedIn: boolean; user: string | null; gateway: string | null;
  expires: string | null;
}>('/auth/status');

export const login = () => request<{ success: boolean; output: string }>('/auth/login', { method: 'POST' });
export const logout = () => request<{ success: boolean; output: string }>('/auth/logout', { method: 'POST' });

export interface VaultSlot {
  index: number;
  backend: string;
  detail: string | null;
}

export interface VaultStatus {
  vaultPath: string | null;
  version: string | null;
  secrets: string | null;
  perms: string | null;
  slots: VaultSlot[];
  kekStatus: string | null;
  kekAccessible: boolean;
  hasPassphraseSlot: boolean;
}

export const getVaultStatus = () => request<VaultStatus>('/auth/vault-status');

const streamedAuth = (path: string) =>
  request<{ operationId: string; args: string[] }>(path, { method: 'POST' });

export const changePassphrase = () => streamedAuth('/auth/change-passphrase');
export const resetPassphrase = () => streamedAuth('/auth/reset-passphrase');
export const setupSsh = (force = false) => streamedAuth(force ? '/auth/setup-ssh-force' : '/auth/setup-ssh');
export const rotateKey = () => streamedAuth('/auth/rotate-key');
export const trustCert = () => streamedAuth('/auth/trust-cert');
export const untrustCert = () => streamedAuth('/auth/untrust-cert');

// Apps
export const getAppsList = () => request<Record<string, string>[]>('/apps/list');
export const getAppsStatus = () => request<{
  items: Array<{ name: string; installed: string; latest: string; updateAvailable: boolean }>;
  message: string | null;
}>('/apps/status');

// Plugins — list may return an array or { items: [], error } when the marketplace is broken
export const getPluginsList = async (): Promise<Record<string, string>[]> => {
  const data = await request<Record<string, string>[] | { items: unknown[]; error: string }>('/plugins/list');
  return Array.isArray(data) ? data : [];
};
export const getPluginsStatus = (checkUpdates?: boolean) => {
  const params = new URLSearchParams();
  if (checkUpdates) params.set('checkUpdates', 'true');
  const qs = params.toString();
  return request<{ items: any[]; message: string | null }>(`/plugins/status${qs ? `?${qs}` : ''}`);
};

// Skills
export const getSkillsList = () => request<Record<string, string>[]>('/skills/list');
export const getSkillsStatus = (checkUpdates?: boolean) => {
  const params = new URLSearchParams();
  if (checkUpdates) params.set('checkUpdates', 'true');
  const qs = params.toString();
  return request<{
    items: Array<{ name: string; installed: string; latest: string; updateAvailable: boolean; source?: string; description?: string }>;
    message: string | null;
  }>(`/skills/status${qs ? `?${qs}` : ''}`);
};

// System
export const getVersion = () => request<{ version: string }>('/system/version');

export const getSystemUser = () =>
  request<{ username: string; displayName: string }>('/system/user');

export interface UiUpdateStatus {
  behind: number;
  current?: string;
  latest?: string;
  error?: string;
}

export const getUiUpdateStatus = () => request<UiUpdateStatus>('/system/ui-update');

export interface SelfUpdateStatus {
  available: boolean;
  message?: string | null;
}

export const getSelfUpdateStatus = () => request<SelfUpdateStatus>('/system/self-update');

// Doctor
export const getDoctorStatus = () => request<{
  checks: Array<{ group: string; name: string; passed: boolean; details: string[] }>;
  allPassed: boolean;
}>('/doctor/status');

// Streamed execute
export const execute = (args: string[]) =>
  request<{ operationId: string }>('/execute', {
    method: 'POST',
    body: JSON.stringify({ args }),
  });

// Batch streamed execute (runs commands sequentially under one operationId)
export const executeBatch = (commands: string[][]) =>
  request<{ operationId: string }>('/execute-batch', {
    method: 'POST',
    body: JSON.stringify({ commands }),
  });

// Launch an app or tool in a new terminal window
export const launchApp = (args: string[], cwd?: string) =>
  request<{ success: boolean }>('/launch', {
    method: 'POST',
    body: JSON.stringify({ args, cwd }),
  });

// Reveal a file's containing folder in the system file explorer
export const revealInFolder = (path: string) =>
  request<{ success: boolean }>('/reveal', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

// Open a system terminal at a directory
export const openTerminal = (path: string) =>
  request<{ success: boolean }>('/terminal', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

// Workspaces
export type SortBy = 'name' | 'source' | 'path' | 'recent';

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
  source: 'discovered' | 'manual';
  root?: string;
  exists: boolean;
  pinned: boolean;
  lastOpened?: string;
}

export interface DiscoverySource {
  roots: string[];
  subpath: string;
  recursive: boolean;
  disabled?: boolean;
}

export interface WorkspaceConfig {
  discoverySources: DiscoverySource[];
  searchDepth: number;
  excludePatterns: string[];
  hiddenPaths: string[];
}

export const getWorkspaces = (refresh?: boolean) =>
  request<{ workspaces: WorkspaceEntry[]; config: WorkspaceConfig; warnings: string[]; sortBy: SortBy }>(
    `/workspaces${refresh ? '?refresh=true' : ''}`,
  );

export const addWorkspace = (wsPath: string, name?: string) =>
  request<{ id: string; name: string; path: string }>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ path: wsPath, name }),
  });

export const removeWorkspace = (id: string) =>
  request<{ success: boolean }>(`/workspaces/${id}`, { method: 'DELETE' });

export const hideWorkspace = (wsPath: string) =>
  request<{ success: boolean }>('/workspaces/hide', {
    method: 'POST',
    body: JSON.stringify({ path: wsPath }),
  });

export const unhideWorkspace = (wsPath: string) =>
  request<{ success: boolean }>('/workspaces/unhide', {
    method: 'POST',
    body: JSON.stringify({ path: wsPath }),
  });

export const updateWorkspaceConfig = (config: Partial<WorkspaceConfig>) =>
  request<WorkspaceConfig>('/workspaces/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });

export const pinWorkspace = (id: string) =>
  request<{ success: boolean }>('/workspaces/pin', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const unpinWorkspace = (id: string) =>
  request<{ success: boolean }>('/workspaces/unpin', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const renameWorkspace = (id: string, name: string) =>
  request<{ success: boolean }>('/workspaces/rename', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  });

export const recordWorkspaceOpen = (id: string) =>
  request<{ success: boolean }>('/workspaces/record-open', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const setWorkspaceSort = (sortBy: SortBy) =>
  request<{ success: boolean }>('/workspaces/sort', {
    method: 'PUT',
    body: JSON.stringify({ sortBy }),
  });

// Git worktrees — isolate parallel agent sessions in their own checkout + branch.
export interface RepoInfo {
  isRepo: boolean;
  root?: string;
  commonRoot?: string;
  currentBranch?: string;
  isWorktree?: boolean;
}

export interface CreatedWorktree {
  worktreePath: string;
  branch: string;
  repoRoot: string;
  id: string;
}

export interface WorktreeStatus {
  dirty: boolean;
  ahead: number;
  unmergedToHead: boolean;
}

export type GitChangeState =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'unmerged'
  | 'untracked'
  | 'typechange'
  | 'unknown';

export interface GitStatusChange {
  path: string;
  originalPath?: string | null;
  x: string;
  y: string;
  index?: GitChangeState | null;
  workingTree?: GitChangeState | null;
  kind: GitChangeState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  root?: string;
  commonRoot?: string;
  currentBranch?: string;
  branch?: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  isWorktree?: boolean;
  changes: GitStatusChange[];
}

export const detectRepo = (cwd: string) =>
  request<RepoInfo>(`/worktrees/detect?cwd=${encodeURIComponent(cwd)}`);

export const getGitStatus = (cwd: string) =>
  request<GitStatus>(`/worktrees/status?cwd=${encodeURIComponent(cwd)}`);

export const createWorktree = (cwd: string, branch: string, agentId?: string) =>
  request<CreatedWorktree>('/worktrees', {
    method: 'POST',
    body: JSON.stringify({ cwd, branch, agentId }),
  });

export const inspectWorktree = (worktreePath: string, repoRoot: string, branch: string) =>
  request<WorktreeStatus>('/worktrees/inspect', {
    method: 'POST',
    body: JSON.stringify({ worktreePath, repoRoot, branch }),
  });

export const removeWorktree = (
  worktreePath: string,
  repoRoot: string,
  branch: string,
  opts?: { force?: boolean; deleteBranch?: boolean },
) =>
  request<{ success: boolean }>('/worktrees', {
    method: 'DELETE',
    body: JSON.stringify({ worktreePath, repoRoot, branch, ...opts }),
  });

// Checkpoints — working-tree snapshots for prompt-level file restore.
export interface Checkpoint {
  sessionId: string;
  turnIndex: number;
  sha: string;
  parentSha?: string;
  promptText: string;
  cwd: string;
  createdAt: string;
}

export interface CheckpointDiffStat {
  path: string;
  added: number;
  removed: number;
}

export const createCheckpoint = (input: { cwd: string; sessionId: string; turnIndex: number; promptText: string }) =>
  request<{ checkpoint: Checkpoint | null }>('/checkpoints', { method: 'POST', body: JSON.stringify(input) });

export const listCheckpoints = (sessionId: string) =>
  request<{ checkpoints: Checkpoint[] }>(`/checkpoints?sessionId=${encodeURIComponent(sessionId)}`);

export const previewCheckpoint = (cwd: string, sha: string) =>
  request<{ files: CheckpointDiffStat[] }>('/checkpoints/preview', { method: 'POST', body: JSON.stringify({ cwd, sha }) });

export const diffCheckpointFile = (cwd: string, sha: string, path: string) =>
  request<{ oldText: string; newText: string }>('/checkpoints/diff', { method: 'POST', body: JSON.stringify({ cwd, sha, path }) });

export const restoreCheckpoint = (cwd: string, sha: string, sessionId?: string) =>
  request<{ success: boolean }>('/checkpoints/restore', { method: 'POST', body: JSON.stringify({ cwd, sha, sessionId }) });

// Read-only file browsing for the Agents-tab file tree — scoped to a session's
// working directory by the Rust backend.
export interface DirEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
}

export const listWorkspaceDir = (cwd: string, path = '') =>
  request<{ entries: DirEntry[]; truncated: boolean }>(
    `/files/list?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`);

export const readWorkspaceFile = (cwd: string, path: string) =>
  request<{ content: string; truncated: boolean; binary: boolean; bytes: number }>(
    `/files/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`);

// Flat whole-tree file list for @-mention autocomplete in the composer.
export const listAllWorkspaceFiles = (cwd: string) =>
  request<{ files: string[]; truncated: boolean }>(
    `/files/all?cwd=${encodeURIComponent(cwd)}`);

// Config
export interface ConfigKey {
  key: string;
  type: string;
  value: string;
  source: string;
  description: string;
}

export interface ConfigResolutionLayer {
  layer: string;
  value: string;
  source: string;
}

export interface ConfigExplain {
  key: string;
  type: string;
  values: string[] | null;
  default: string | null;
  layers: ConfigResolutionLayer[];
  resolved: { value: string; source: string } | null;
}

export interface ConfigStatus {
  username: string | null;
  configDir: string | null;
  projectConfig: string | null;
  profiles: string[];
  userOverrides: number;
  projectOverrides: number;
}

export const getConfigList = (all?: boolean) =>
  request<{ items: ConfigKey[] }>(`/config/list${all ? '?all=true' : ''}`);
export const getConfigStatus = () => request<ConfigStatus>('/config/status');
export const getConfigKey = (key: string) =>
  request<{ key: string; value: string; source: string; type: string }>(`/config/get/${encodeURIComponent(key)}`);
export const explainConfigKey = (key: string) =>
  request<ConfigExplain>(`/config/explain/${encodeURIComponent(key)}`);
export const setConfigKey = (key: string, value: string, project?: boolean) =>
  request<{ success: boolean; output: string }>('/config/set', {
    method: 'POST',
    body: JSON.stringify({ key, value, project }),
  });
export const unsetConfigKey = (key: string, project?: boolean) =>
  request<{ success: boolean; output: string }>('/config/unset', {
    method: 'POST',
    body: JSON.stringify({ key, project }),
  });

// Sessions
export interface SessionEntry {
  id: string;
  tool: string;
  dir: string;
  title: string;
  firstActive: string;
  lastActive: string;
  messages: number;
  active: boolean;
  pinned?: boolean;
  filePath?: string;
  firstMessage?: string;
}

export interface SessionsListOptions {
  all?: boolean;
  active?: boolean;
  cwdOnly?: boolean;
  apps?: string;
  since?: string;
}

export const getSessions = (opts: SessionsListOptions = {}) => {
  const params = new URLSearchParams();
  if (opts.all) params.set('all', 'true');
  if (opts.active) params.set('active', 'true');
  if (opts.cwdOnly) params.set('cwdOnly', 'true');
  if (opts.apps) params.set('apps', opts.apps);
  if (opts.since) params.set('since', opts.since);
  const qs = params.toString();
  return request<{ sessions: SessionEntry[] }>(`/sessions${qs ? `?${qs}` : ''}`);
};

export const resumeSession = (id: string, cwd?: string) =>
  request<{ success: boolean }>('/sessions/resume', {
    method: 'POST',
    body: JSON.stringify({ id, cwd }),
  });

export const resumeSessionFromPoint = (
  id: string,
  input: { turnIndex: number; mode: 'overwrite' | 'fork'; title?: string; includeSelected?: boolean },
) =>
  request<{ mode: 'overwrite' | 'fork'; session: SessionEntry; keptTurns: number; totalTurns: number }>(
    `/sessions/${encodeURIComponent(id)}/resume-point`,
    { method: 'POST', body: JSON.stringify(input) },
  );

// Set a custom title for a session (empty name reverts to the auto title).
export const renameSession = (id: string, name: string) =>
  request<{ success: boolean }>('/sessions/rename', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  });

export const pinSession = (id: string) =>
  request<{ success: boolean }>('/sessions/pin', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const unpinSession = (id: string) =>
  request<{ success: boolean }>('/sessions/unpin', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const reorderPinnedSessions = (ids: string[]) =>
  request<{ success: boolean }>('/sessions/pinned-order', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });

// Permanently delete a session's transcript from disk. The devai CLI has no
// delete command, so the backend unlinks the .jsonl file directly.
export const deleteSession = (id: string) =>
  request<{ success: boolean }>(`/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export interface DeleteSessionFailure {
  id: string;
  error: string;
}

export interface DeleteSessionsResult {
  success: boolean;
  deleted: string[];
  failures: DeleteSessionFailure[];
}

export const deleteSessions = (ids: string[]) =>
  request<DeleteSessionsResult>('/sessions/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });

export const exportSessionUrl = (id: string, format: 'html' | 'md' = 'html', full = false) => {
  const params = new URLSearchParams();
  params.set('format', format);
  if (full) params.set('full', 'true');
  return `/api/sessions/${encodeURIComponent(id)}/export?${params.toString()}`;
};

// URL for viewing a session's rendered HTML transcript in-browser (no download
// header) — used by the preview modal's iframe.
export const sessionPreviewUrl = (id: string, full = false) => {
  const params = new URLSearchParams();
  params.set('format', 'html');
  params.set('inline', 'true');
  if (full) params.set('full', 'true');
  return `/api/sessions/${encodeURIComponent(id)}/export?${params.toString()}`;
};

// One ACP agent the Agents tab can launch. `installed` is false for a managed
// agent (e.g. Gemini) that still needs `kairos apps install <id>`. `custom` is
// true for user-defined agents (editable/removable from the picker).
//
// `keyEnvVar` names the env var a provider API key would be passed via when
// the agent runs in "API key" mode; absent means the agent doesn't accept a
// key and can only run through the kairos gateway (or its own auth). `authMode`
// is what the agent will actually launch with next, and `hasKey` reflects
// whether a stored key exists (masked; never sent back to the browser).
export interface AgentOption {
  id: string;
  label: string;
  managedApp: boolean;
  installed: boolean;
  custom?: boolean;
  keyEnvVar?: string;
  authMode?: 'gateway' | 'key';
  hasKey?: boolean;
}

// Shape a user supplies to register a custom ACP agent. `command` defaults to
// `devai` server-side when omitted.
export interface CustomAgentInput {
  id: string;
  label: string;
  command?: string;
  args: string[];
  env?: Record<string, string>;
  managedApp?: boolean;
}

export const getAgents = () => request<{ agents: AgentOption[] }>('/agents');

// Set an agent's auth mode. In `key` mode, omit `apiKey` to keep the currently
// stored key while just re-affirming the mode. In `gateway` mode any stored
// key is discarded server-side.
export const setAgentAuth = (
  id: string,
  body: { mode: 'gateway' } | { mode: 'key'; apiKey?: string },
) => request<{ mode: 'gateway' | 'key'; hasKey: boolean }>(
  `/agents/${encodeURIComponent(id)}/auth`,
  { method: 'PUT', body: JSON.stringify(body) },
);

export const createCustomAgent = (agent: CustomAgentInput) =>
  request<{ agent: CustomAgentInput }>('/agents/custom', { method: 'POST', body: JSON.stringify(agent) });

export const updateCustomAgent = (id: string, agent: Omit<CustomAgentInput, 'id'>) =>
  request<{ agent: CustomAgentInput }>(`/agents/custom/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(agent) });

export const deleteCustomAgent = (id: string) =>
  request<{ success: boolean }>(`/agents/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });

// An agent-agnostic role/persona. Stored globally in ~/.kairos/config.json and
// applied to any engine at launch; its text is prepended to the session's first
// prompt turn (ACP has no system-prompt field).
export interface CustomRoleInput {
  id: string;
  label: string;
  instructions: string;
  outputFormat?: string;
}

export const getRoles = () => request<{ roles: CustomRoleInput[] }>('/agents/roles');

export const createRole = (role: CustomRoleInput) =>
  request<{ role: CustomRoleInput }>('/agents/roles', { method: 'POST', body: JSON.stringify(role) });

export const updateRole = (id: string, role: Omit<CustomRoleInput, 'id'>) =>
  request<{ role: CustomRoleInput }>(`/agents/roles/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(role) });

export const deleteRole = (id: string) =>
  request<{ success: boolean }>(`/agents/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });

// An agent-agnostic prompt snippet for the composer `/` menu. Stored globally in
// ~/.kairos/config.json (was browser localStorage); inserting one just fills
// the composer draft, so it works with any engine.
export interface PromptInput {
  id: string;
  name: string;
  description?: string;
  body: string;
}

export const getPrompts = () => request<{ prompts: PromptInput[] }>('/agents/prompts');

export const createPrompt = (prompt: PromptInput) =>
  request<{ prompt: PromptInput }>('/agents/prompts', { method: 'POST', body: JSON.stringify(prompt) });

export const updatePrompt = (id: string, prompt: Omit<PromptInput, 'id'>) =>
  request<{ prompt: PromptInput }>(`/agents/prompts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(prompt) });

export const deletePrompt = (id: string) =>
  request<{ success: boolean }>(`/agents/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });

// A stdio MCP server the Agents tab passes to every session. Stored globally in
// ~/.kairos/config.json and injected server-side on session/new & session/load.
export interface McpServerInput {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ExternalMcpServerSource {
  source: string;
  scope: string;
  path: string;
  count: number;
  serverNames: string[];
}

export const getMcpServers = () =>
  request<{ servers: McpServerInput[]; externalServers?: ExternalMcpServerSource[] }>('/agents/mcp');

export const createMcpServer = (server: McpServerInput) =>
  request<{ server: McpServerInput }>('/agents/mcp', { method: 'POST', body: JSON.stringify(server) });

export interface ImportClaudeMcpResult {
  imported: McpServerInput[];
  skipped: Array<{ name: string; source: string; scope: string; path: string; reason: string }>;
  servers: McpServerInput[];
  externalServers?: ExternalMcpServerSource[];
}

export const importClaudeMcpServers = () =>
  request<ImportClaudeMcpResult>('/agents/mcp/import-claude', { method: 'POST' });

// One-click install of a known MCP server: the backend downloads its binary for
// this platform, then saves the config entry. On unsupported platforms / network
// failure the result carries `fallbackToManual` so the UI can pre-fill instead
// of surfacing a dead end. Returns a discriminated result rather than throwing.
export type InstallPresetResult =
  | { ok: true; server: McpServerInput }
  | { ok: false; error: string; fallbackToManual: boolean };

export async function installMcpPreset(preset: string): Promise<InstallPresetResult> {
  const res = await fetchWithAuth(`/api/agents/mcp/install-preset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset }),
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    return { ok: false, error: data.error ?? res.statusText, fallbackToManual: Boolean(data.fallbackToManual) };
  }
  return { ok: true, server: data.server };
}

export const updateMcpServer = (id: string, server: Omit<McpServerInput, 'id'>) =>
  request<{ server: McpServerInput }>(`/agents/mcp/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(server) });

export const deleteMcpServer = (id: string) =>
  request<{ success: boolean }>(`/agents/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' });

// User-defined lifecycle hooks — shell commands fired on agent events.
// Stored in ~/.kairos/config.json; the server runs them fire-and-forget.
export type HookEvent = string;

export interface HookEventInfo {
  id: HookEvent;
  label: string;
  aliases: string[];
  description: string;
}

export interface HookInput {
  id: string;
  label: string;
  event: HookEvent;
  command: string;
}

export interface ExternalHookSource {
  source: string;
  scope: string;
  path: string;
  count: number;
  importableCount?: number;
  eventCounts: Array<{ event: string; count: number }>;
}

export interface ClaudeHookImportResult {
  imported: HookInput[];
  importedCount: number;
  compatibleCount: number;
  duplicateCount: number;
  skippedCount: number;
  skipped: Array<{
    source: string;
    scope: string;
    path: string;
    event: string;
    count: number;
    reason: string;
  }>;
}

export const getHooks = () =>
  request<{
    hooks: HookInput[];
    events: HookEvent[];
    eventDetails?: HookEventInfo[];
    externalHooks?: ExternalHookSource[];
  }>('/agents/hooks');

export const createHook = (hook: HookInput) =>
  request<{ hook: HookInput }>('/agents/hooks', { method: 'POST', body: JSON.stringify(hook) });

export const importClaudeHooks = () =>
  request<ClaudeHookImportResult>('/agents/hooks/import/claude', { method: 'POST' });

export const updateHook = (id: string, hook: Omit<HookInput, 'id'>) =>
  request<{ hook: HookInput }>(`/agents/hooks/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(hook) });

export const deleteHook = (id: string) =>
  request<{ success: boolean }>(`/agents/hooks/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Agents-tab preferences — persisted in ~/.kairos/config.json (was localStorage).
export type SavedConfig = Record<string, string>;

export interface AgentPrefs {
  lastCwd: string;
  lastAgent: string;
  autoAccept: boolean;
  savedConfigs: Record<string, SavedConfig>;
}

export const getAgentPrefs = () => request<{ prefs: AgentPrefs }>('/agents/prefs');

export const saveAgentPrefs = (prefs: Partial<AgentPrefs>) =>
  request<{ prefs: AgentPrefs }>('/agents/prefs', { method: 'PUT', body: JSON.stringify(prefs) });

// The Rules editor toggles between global standing instructions and a project's
// AGENTS.md. Only project rules are files; global rules are config-backed (see
// below), because no cross-agent user-level rules file exists.
export type RuleScope = 'global' | 'project';

// Project rules / instructions — the cross-agent AGENTS.md file agents read
// automatically from a repo root (`cwd`).
export interface RuleFile {
  name: string;
  path: string;
  exists: boolean;
  content: string;
  cwd: string;
}

const ruleQuery = (cwd: string, name?: string) => {
  const params = new URLSearchParams({ cwd });
  if (name) params.set('name', name);
  return params.toString();
};

export const getRules = (cwd: string) =>
  request<{ files: RuleFile[] }>(`/rules?${ruleQuery(cwd)}`);

export const getRuleFile = (name: string, cwd: string) =>
  request<{ file: RuleFile }>(`/rules/file?${ruleQuery(cwd, name)}`);

export const saveRuleFile = (name: string, content: string, cwd: string) =>
  request<{ file: RuleFile }>('/rules/file', {
    method: 'PUT',
    body: JSON.stringify({ name, content, cwd }),
  });

export const deleteRuleFile = (name: string, cwd: string) =>
  request<{ success: boolean }>(`/rules/file?${ruleQuery(cwd, name)}`, { method: 'DELETE' });

// Global standing instructions — the engine-neutral equivalent of "user rules".
// Stored in ~/.kairos/config.json (not a file any single engine reads) and
// injected into every session's first prompt turn, the same way roles are.
export const getGlobalRules = () => request<{ rules: string }>('/agents/global-rules');

export const saveGlobalRules = (rules: string) =>
  request<{ rules: string }>('/agents/global-rules', { method: 'PUT', body: JSON.stringify({ rules }) });

// Features
export interface FeatureFlag {
  flag: string;
  value: string;
  source: string;
  stability: string;
  description: string;
}

export interface FeatureExplain {
  flag: string;
  type: string;
  stability: string;
  default: string | null;
  layers: Array<{ layer: string; value: string; source: string }>;
  resolved: { value: string; source: string } | null;
}

export const getFeaturesList = (all?: boolean) =>
  request<{ items: FeatureFlag[] }>(`/features/list${all ? '?all=true' : ''}`);
export const explainFeature = (flag: string) =>
  request<FeatureExplain>(`/features/explain/${encodeURIComponent(flag)}`);
export const setFeature = (flag: string, value: boolean) =>
  request<{ success: boolean; output: string }>('/features/set', {
    method: 'POST',
    body: JSON.stringify({ flag, value }),
  });
export const unsetFeature = (flag: string) =>
  request<{ success: boolean; output: string }>('/features/unset', {
    method: 'POST',
    body: JSON.stringify({ flag }),
  });

// Usage
export interface UsageEntry {
  hostname: string;
  username: string;
  client_kind: string | null;
  kairos_version: string | null;
  client_os: string | null;
  client_arch: string | null;
  first_seen: string;
  last_seen: string;
}

export const getUsageAccess = () => request<{ allowed: boolean }>('/usage/access');
export const getUsage = () =>
  request<{ users: UsageEntry[] }>('/usage');

// Public presence feed — who's active in the last window, no hostnames.
export const getPresence = () =>
  request<{ present: Array<{ username: string; last_seen: string }>; total: number }>('/usage/presence');

// Public testimonial wall. Author is set server-side, never sent by the client.
export interface Testimonial {
  username: string;
  note: string;
  created_at: string;
}
export const getTestimonials = () =>
  request<{ testimonials: Testimonial[]; total: number }>('/usage/testimonials');
export const postTestimonial = (note: string) =>
  request<{ ok: boolean }>('/usage/testimonials', {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
