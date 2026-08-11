import { describe, it, expect } from 'vitest';
import { buildAgentCatalog } from '../agent-catalog.js';

describe('buildAgentCatalog', () => {
  it('exposes a connectable mock agent when the mock provider is active', () => {
    const agents = buildAgentCatalog({ mockEnabled: true });
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'mock', label: 'Mock Agent', installed: true, managedApp: false });
  });

  it('returns an empty catalog when the mock is off and no providers are available', () => {
    expect(buildAgentCatalog({ mockEnabled: false })).toEqual([]);
    expect(buildAgentCatalog({ mockEnabled: false, providers: [] })).toEqual([]);
  });

  it('exposes one connectable agent per available provider with a human label', () => {
    const agents = buildAgentCatalog({ mockEnabled: false, providers: ['anthropic', 'ollama'] });
    expect(agents.map((a) => a.id)).toEqual(['anthropic', 'ollama']);
    expect(agents.find((a) => a.id === 'anthropic')?.label).toBe('Claude (Anthropic)');
    expect(agents.find((a) => a.id === 'ollama')?.label).toBe('Ollama (local)');
  });

  it('lists the mock first, then providers, when both are present', () => {
    const agents = buildAgentCatalog({ mockEnabled: true, providers: ['anthropic'] });
    expect(agents.map((a) => a.id)).toEqual(['mock', 'anthropic']);
  });

  it('de-duplicates so a provider is never listed twice', () => {
    // If the mock provider also shows up in the available list, only one entry.
    const agents = buildAgentCatalog({ mockEnabled: true, providers: ['mock', 'anthropic'] });
    expect(agents.map((a) => a.id)).toEqual(['mock', 'anthropic']);
  });

  it('falls back to a Title-cased label for an unknown provider id', () => {
    const agents = buildAgentCatalog({ mockEnabled: false, providers: ['acme'] });
    expect(agents[0].label).toBe('Acme');
  });

  it('appends external stdio agents after mock and providers, preserving installed', () => {
    const agents = buildAgentCatalog({
      mockEnabled: true,
      providers: ['anthropic'],
      externalAgents: [{ id: 'claude', installed: true }],
    });
    expect(agents.map((a) => a.id)).toEqual(['mock', 'anthropic', 'claude']);
    const claude = agents.find((a) => a.id === 'claude');
    expect(claude).toMatchObject({ label: 'Claude Code', installed: true, managedApp: false });
  });

  it('marks an uninstalled external agent as installed:false but still lists it', () => {
    const agents = buildAgentCatalog({
      mockEnabled: false,
      externalAgents: [{ id: 'claude', installed: false }],
    });
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'claude', installed: false });
  });

  it('de-duplicates an external agent that also appears as a provider', () => {
    // First occurrence wins, so the provider entry (installed:true) is kept.
    const agents = buildAgentCatalog({
      mockEnabled: false,
      providers: ['claude'],
      externalAgents: [{ id: 'claude', installed: false }],
    });
    expect(agents.map((a) => a.id)).toEqual(['claude']);
    expect(agents[0].installed).toBe(true);
  });

  it('matches the UI AgentOption shape the picker consumes', () => {
    for (const a of buildAgentCatalog({ mockEnabled: true, providers: ['anthropic'] })) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.label).toBe('string');
      expect(typeof a.installed).toBe('boolean');
      expect(typeof a.managedApp).toBe('boolean');
    }
  });
});
