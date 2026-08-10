// Maps a catalog/app package name to the Agents-tab agent id it can run as an
// in-app ACP session. Only apps backed by a launchable agent appear here; GUI
// editors (code, cursor) have no agent equivalent and are absent, so they keep
// their terminal-only Launch button. Agent ids match the built-ins in
// src-tauri/src/backend/agents.rs.
const APP_TO_AGENT: Record<string, string> = {
  'claude-code': 'claude',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

/** The Agents-tab agent id this app maps to, or null if it has no agent equivalent. */
export function agentForApp(appName: string): string | null {
  return APP_TO_AGENT[appName] ?? null;
}
