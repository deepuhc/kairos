export type PersonaId =
  | 'developer'
  | 'designer'
  | 'hr'
  | 'finance'
  | 'sales'
  | 'legal'
  | 'student'
  | 'admin'
  | 'custom';

export interface Persona {
  id: PersonaId;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  systemPrompt: string;
  features: FeatureVisibility;
  dashboard: DashboardConfig;
  quickActions: QuickAction[];
  slashCommands?: SlashCommand[];
  defaultModel?: string; // Preferred model for this persona
  defaultPrivacy?: 'local' | 'cloud' | 'auto';
}

export type Feature =
  | 'terminal'
  | 'git-worktree'
  | 'code-diffs'
  | 'pipeline-builder'
  | 'pipeline-monitor'
  | 'workflow-visual'
  | 'workflow-dsl'
  | 'file-upload'
  | 'knowledge-base'
  | 'prompt-library'
  | 'mcp-servers'
  | 'plugins'
  | 'workspace-picker'
  | 'agent-multi-session'
  | 'protocol-inspector'
  | 'voice-input'
  | 'cost-tracker'
  | 'kid-mode'
  | 'audit-log';

export type FeatureVisibility = Record<Feature, 'visible' | 'hidden' | 'collapsed'>;

export interface DashboardConfig {
  greeting: string; // Template: "Good {{timeOfDay}}, {{name}}"
  sections: DashboardSection[];
}

export type DashboardSection =
  | 'quick-actions'
  | 'recent-sessions'
  | 'active-workflows'
  | 'workspaces'
  | 'document-queue'
  | 'learning-streak'
  | 'cost-summary'
  | 'team-activity';

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prompt?: string; // Pre-fill composer
  action?: 'new-chat' | 'upload-file' | 'new-workflow' | 'open-settings';
}

export interface SlashCommand {
  command: string;
  description: string;
  prompt: string;
}
