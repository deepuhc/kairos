import type { Persona, FeatureVisibility } from './types.js';

const allVisible: FeatureVisibility = {
  'terminal': 'visible',
  'git-worktree': 'visible',
  'code-diffs': 'visible',
  'pipeline-builder': 'visible',
  'pipeline-monitor': 'visible',
  'workflow-visual': 'visible',
  'workflow-dsl': 'visible',
  'file-upload': 'visible',
  'knowledge-base': 'visible',
  'prompt-library': 'visible',
  'mcp-servers': 'visible',
  'plugins': 'visible',
  'workspace-picker': 'visible',
  'agent-multi-session': 'visible',
  'protocol-inspector': 'visible',
  'voice-input': 'visible',
  'cost-tracker': 'visible',
  'kid-mode': 'hidden',
  'audit-log': 'visible',
};

function features(overrides: Partial<FeatureVisibility>): FeatureVisibility {
  return { ...allVisible, ...overrides };
}

export const BUILT_IN_PERSONAS: Persona[] = [
  {
    id: 'developer',
    name: 'Developer',
    description: 'Full-stack engineer, code review, architecture, debugging',
    icon: 'code-2',
    systemPrompt: `You are an expert software engineering assistant. Be concise and precise. Provide code examples when helpful. Assume the user is technically proficient and familiar with modern development practices.`,
    features: features({}),
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'recent-sessions', 'workspaces', 'active-workflows'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'code-review', label: 'Code Review', icon: 'git-pull-request', prompt: 'Review the following code for bugs, performance, and best practices:\n\n' },
      { id: 'architect', label: 'Architecture', icon: 'layers', prompt: 'Help me design the architecture for: ' },
      { id: 'debug', label: 'Debug', icon: 'bug', prompt: 'Help me debug this issue:\n\n' },
    ],
  },
  {
    id: 'designer',
    name: 'Designer',
    description: 'UX/UI design, accessibility audits, copy writing, research synthesis',
    icon: 'palette',
    systemPrompt: `You are a UX/UI design expert. Focus on user experience, accessibility, visual hierarchy, and clear communication. When critiquing designs, be constructive and specific. Reference design principles and heuristics.`,
    features: features({ 'terminal': 'hidden', 'git-worktree': 'hidden', 'code-diffs': 'collapsed', 'workflow-dsl': 'hidden', 'protocol-inspector': 'hidden', 'mcp-servers': 'hidden' }),
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'recent-sessions', 'active-workflows'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'critique', label: 'Design Critique', icon: 'eye', prompt: 'Critique this design for usability, accessibility, and visual clarity:\n\n' },
      { id: 'copy', label: 'Write Copy', icon: 'type', prompt: 'Write clear, concise UI copy for: ' },
      { id: 'a11y', label: 'Accessibility Audit', icon: 'accessibility', prompt: 'Audit the following for WCAG 2.1 AA compliance:\n\n' },
    ],
  },
  {
    id: 'hr',
    name: 'HR Professional',
    description: 'Compensation analysis, offer letters, policy Q&A, handbook updates',
    icon: 'users',
    systemPrompt: `You are an HR professional's assistant. Help with compensation analysis, policy writing, employee communications, and compliance. Be precise with numbers, maintain confidentiality awareness, and use professional but warm language.`,
    features: features({ 'terminal': 'hidden', 'git-worktree': 'hidden', 'code-diffs': 'hidden', 'workflow-dsl': 'hidden', 'protocol-inspector': 'hidden', 'mcp-servers': 'hidden', 'workspace-picker': 'hidden' }),
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'recent-sessions', 'document-queue', 'active-workflows'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'offer-letter', label: 'Draft Offer Letter', icon: 'file-text', prompt: 'Draft a professional offer letter with the following details:\n\n' },
      { id: 'comp-analysis', label: 'Comp Analysis', icon: 'bar-chart-2', action: 'upload-file' },
      { id: 'policy', label: 'Policy Q&A', icon: 'book-open', prompt: 'Answer this policy question:\n\n' },
    ],
  },
  {
    id: 'finance',
    name: 'Finance / CPA',
    description: 'Tax preparation, financial analysis, audit documentation, compliance',
    icon: 'calculator',
    systemPrompt: `You are a financial analysis and tax preparation assistant. Be extremely precise with numbers and calculations. Always cite regulatory sources when referencing tax law or accounting standards. Flag assumptions clearly. Prioritize accuracy over speed.`,
    features: features({ 'terminal': 'hidden', 'git-worktree': 'hidden', 'code-diffs': 'hidden', 'workflow-dsl': 'hidden', 'protocol-inspector': 'hidden', 'mcp-servers': 'hidden', 'workspace-picker': 'hidden' }),
    defaultPrivacy: 'local',
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'recent-sessions', 'document-queue', 'cost-summary'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'analyze', label: 'Analyze Spreadsheet', icon: 'table', action: 'upload-file' },
      { id: 'tax-research', label: 'Tax Research', icon: 'search', prompt: 'Research the following tax question and cite relevant IRC sections:\n\n' },
      { id: 'memo', label: 'Draft Memo', icon: 'file-text', prompt: 'Draft a professional memo regarding:\n\n' },
    ],
  },
  {
    id: 'sales',
    name: 'Account Executive',
    description: 'Prospect research, email sequences, proposals, competitive analysis',
    icon: 'target',
    systemPrompt: `You are a sales enablement assistant for an enterprise Account Executive. Help with prospect research, personalized outreach, proposal generation, and competitive positioning. Be concise, action-oriented, and focused on value propositions.`,
    features: features({ 'terminal': 'hidden', 'git-worktree': 'hidden', 'code-diffs': 'hidden', 'workflow-dsl': 'hidden', 'protocol-inspector': 'hidden', 'mcp-servers': 'hidden', 'workspace-picker': 'hidden' }),
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'recent-sessions', 'active-workflows'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'research', label: 'Prospect Research', icon: 'search', prompt: 'Research this prospect and summarize key findings for outreach:\n\n' },
      { id: 'email', label: 'Draft Email', icon: 'mail', prompt: 'Write a personalized outreach email to:\n\n' },
      { id: 'proposal', label: 'Build Proposal', icon: 'presentation', prompt: 'Create a proposal outline for:\n\n' },
    ],
  },
  {
    id: 'legal',
    name: 'Legal / Tax Assistant',
    description: 'Document review, form filling, data extraction, regulatory research',
    icon: 'scale',
    systemPrompt: `You are a legal and tax assistant. Help with document review, data extraction from forms, regulatory research, and cross-referencing. Be meticulous about accuracy. Always flag when information needs human verification. Never provide legal advice — only research support.`,
    features: features({ 'terminal': 'hidden', 'git-worktree': 'hidden', 'code-diffs': 'hidden', 'workflow-dsl': 'hidden', 'protocol-inspector': 'hidden', 'mcp-servers': 'hidden', 'workspace-picker': 'hidden' }),
    defaultPrivacy: 'local',
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'recent-sessions', 'document-queue', 'active-workflows'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'extract', label: 'Extract Data', icon: 'scan', action: 'upload-file' },
      { id: 'research', label: 'Regulatory Lookup', icon: 'book-open', prompt: 'Research the following regulation:\n\n' },
      { id: 'review', label: 'Document Review', icon: 'file-check', action: 'upload-file' },
    ],
  },
  {
    id: 'student',
    name: 'Student',
    description: 'Homework help, creative writing, research, learning new topics',
    icon: 'graduation-cap',
    systemPrompt: `You are a friendly and encouraging learning companion for a student. Explain concepts clearly at an age-appropriate level. Use analogies and examples. When helping with homework, guide the student toward understanding rather than just giving answers. Encourage curiosity and creativity. Keep language simple and engaging.`,
    features: features({ 'terminal': 'hidden', 'git-worktree': 'hidden', 'code-diffs': 'hidden', 'pipeline-builder': 'hidden', 'pipeline-monitor': 'hidden', 'workflow-dsl': 'hidden', 'protocol-inspector': 'hidden', 'mcp-servers': 'hidden', 'plugins': 'hidden', 'workspace-picker': 'hidden', 'agent-multi-session': 'hidden', 'audit-log': 'hidden', 'kid-mode': 'visible' }),
    dashboard: {
      greeting: 'Hey {{name}}! Ready to learn something cool?',
      sections: ['quick-actions', 'recent-sessions', 'learning-streak'],
    },
    quickActions: [
      { id: 'new-chat', label: 'Ask Anything', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'homework', label: 'Homework Help', icon: 'book', prompt: 'Help me understand this homework problem:\n\n' },
      { id: 'write', label: 'Creative Writing', icon: 'pencil', prompt: 'Help me write a story about:\n\n' },
      { id: 'explore', label: 'Explore Topic', icon: 'compass', prompt: 'Explain this topic in a fun and simple way:\n\n' },
    ],
  },
  {
    id: 'admin',
    name: 'IT Admin',
    description: 'Team deployment, model routing, usage monitoring, cost control',
    icon: 'shield',
    systemPrompt: `You are a system administration assistant. Help with configuration, deployment, monitoring, and troubleshooting. Be precise with commands and configurations.`,
    features: features({}),
    dashboard: {
      greeting: 'Good {{timeOfDay}}, {{name}}',
      sections: ['quick-actions', 'team-activity', 'cost-summary', 'active-workflows'],
    },
    quickActions: [
      { id: 'new-chat', label: 'New Chat', icon: 'message-square-plus', action: 'new-chat' },
      { id: 'config', label: 'Configuration', icon: 'settings', action: 'open-settings' },
      { id: 'monitor', label: 'Usage Monitor', icon: 'activity', prompt: 'Show me current usage and cost breakdown' },
      { id: 'workflow', label: 'New Workflow', icon: 'git-branch', action: 'new-workflow' },
    ],
  },
];
