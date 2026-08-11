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

/**
 * Build the selectable agent list. With the mock provider active we expose a
 * "mock" agent so the Agents tab works end-to-end with no real CLI installed.
 * When real providers are wired (Phase E) their agents are appended here.
 */
export function buildAgentCatalog(opts: { mockEnabled: boolean }): AgentOption[] {
  const agents: AgentOption[] = [];
  if (opts.mockEnabled) {
    agents.push({ id: 'mock', label: 'Mock Agent', managedApp: false, installed: true });
  }
  return agents;
}
