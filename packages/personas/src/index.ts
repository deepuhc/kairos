export { PersonaRegistry } from './registry.js';
export { FeatureGate } from './feature-gate.js';
export { buildSystemPrompt } from './prompt-adapter.js';
export { type Persona, type PersonaId, type Feature, type FeatureVisibility, type DashboardConfig, type QuickAction } from './types.js';
export { BUILT_IN_PERSONAS } from './built-in.js';
export {
  AGENT_ROLES, DEFAULT_PIPELINE_ROLES, getAgentRole, nextEligibleRoles, validateArtifact,
  type AgentRole, type AgentRoleId, type ModelTier, type ArtifactContract, type ArtifactCheck,
} from './agent-roles.js';
