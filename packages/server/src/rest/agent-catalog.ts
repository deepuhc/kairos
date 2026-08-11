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
}

/**
 * Build the selectable agent list. Every available provider (plus the mock when
 * active) becomes a connectable agent; connecting any of them on /acp runs the
 * shared router → provider → session/update path. De-duplicates by id so a
 * provider isn't listed twice when it's both available and the mock.
 */
export function buildAgentCatalog(input: AgentCatalogInput): AgentOption[] {
  const ids: string[] = [];
  if (input.mockEnabled) ids.push('mock');
  for (const name of input.providers ?? []) {
    if (!ids.includes(name)) ids.push(name);
  }
  return ids.map((id) => ({ id, label: labelFor(id), managedApp: false, installed: true }));
}
