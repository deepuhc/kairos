/**
 * Kairos TUI (Terminal User Interface)
 * React-based terminal UI using Ink
 */

export { App } from './App.js';
export type { AppProps } from './App.js';

export { StatusBar } from './components/StatusBar.js';
export type { StatusBarProps } from './components/StatusBar.js';

export { InputBar } from './components/InputBar.js';
export type { InputBarProps } from './components/InputBar.js';

export { PipelineView } from './components/PipelineView.js';
export type { PipelineViewProps, PipelinePhase } from './components/PipelineView.js';

export { AgentList } from './components/AgentList.js';
export type { AgentListProps, Agent } from './components/AgentList.js';

export { ApprovalGate } from './components/ApprovalGate.js';
export type { ApprovalGateProps, ApprovalAction } from './components/ApprovalGate.js';

export { useKeyboard } from './hooks/useKeyboard.js';
export type { KeyboardState, KeyHandler } from './hooks/useKeyboard.js';
export { globalKeys, listKeys, approvalKeys, agentKeys } from './hooks/useKeyboard.js';

export { colors, icons, spacing } from './theme.js';
