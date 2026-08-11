import { describe, it, expect } from 'vitest';
import { buildAgentCatalog } from '../agent-catalog.js';

describe('buildAgentCatalog', () => {
  it('exposes a connectable mock agent when the mock provider is active', () => {
    const agents = buildAgentCatalog({ mockEnabled: true });
    expect(agents).toHaveLength(1);
    const mock = agents[0];
    expect(mock).toMatchObject({ id: 'mock', label: 'Mock Agent', installed: true, managedApp: false });
  });

  it('returns an empty catalog when the mock provider is off and no real agents are wired', () => {
    expect(buildAgentCatalog({ mockEnabled: false })).toEqual([]);
  });

  it('matches the UI AgentOption shape the picker consumes', () => {
    // getAgents() → { agents: AgentOption[] } with id/label/installed/managedApp.
    for (const a of buildAgentCatalog({ mockEnabled: true })) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.label).toBe('string');
      expect(typeof a.installed).toBe('boolean');
      expect(typeof a.managedApp).toBe('boolean');
    }
  });
});
