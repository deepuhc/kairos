// The selectable agent catalog the UI's picker consumes (getAgents →
// { agents: AgentOption[] }). Distinct from the list of *running* agent
// processes (AgentPool.list()). Any id returned here can be connected on /acp,
// where ProviderAcpAgent serves it through the shared router.

export interface AgentOption {
  id: string;
  label: string;
  managedApp: boolean;
  installed: boolean;
  custom?: boolean;
}

// Human labels for the built-in providers. Unknown provider names fall back to
// a Title-cased id so a newly added provider still shows something sensible.
const PROVIDER_LABELS: Record<string, string> = {
  mock: 'Mock Agent',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama (local)',
  claude: 'Claude Code',
};

function labelFor(id: string): string {
  return PROVIDER_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export interface AgentCatalogInput {
  /** Whether the in-memory mock provider is active. */
  mockEnabled: boolean;
  /**
   * Names of providers currently available (from registry.discoverAvailable()).
   * Each becomes a connectable /acp agent so the UI picker offers real backends
   * — without this the picker is empty whenever the mock is off, even though the
   * router would happily serve a real provider.
   */
  providers?: string[];
  /**
   * External ACP CLI agents spawned over stdio (e.g. "claude" via its ACP
   * adapter). Distinct from in-process providers: connecting one launches a
   * subprocess. `installed` reflects whether its launch command is on PATH.
   */
  externalAgents?: Array<{ id: string; installed: boolean }>;
}

/**
 * Build the selectable agent list. Every available provider (plus the mock when
 * active) becomes a connectable agent; connecting any of them on /acp runs the
 * shared router → provider → session/update path. De-duplicates by id so a
 * provider isn't listed twice when it's both available and the mock.
 */
export function buildAgentCatalog(input: AgentCatalogInput): AgentOption[] {
  const options: AgentOption[] = [];
  const seen = new Set<string>();
  const add = (id: string, installed: boolean) => {
    if (seen.has(id)) return;
    seen.add(id);
    options.push({ id, label: labelFor(id), managedApp: false, installed });
  };

  if (input.mockEnabled) add('mock', true);
  for (const name of input.providers ?? []) add(name, true);
  for (const ext of input.externalAgents ?? []) add(ext.id, ext.installed);
  return options;
}
