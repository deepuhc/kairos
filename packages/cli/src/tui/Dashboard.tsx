/**
 * Kairos Dashboard — The single pane of glass.
 *
 * Layout:
 * ┌─────────────┬──────────────────────────────────────┐
 * │  Projects   │  Status Bar (provider, budget, time) │
 * │             ├──────────────────────────────────────┤
 * │  ● Active   │  Agent List (status, task, elapsed)  │
 * │  ○ Other    │                                      │
 * │  ○ Other    ├──────────────────────────────────────┤
 * │             │  ⚠ Prompt Banner (if agent waiting)  │
 * │             ├──────────────────────────────────────┤
 * │             │  Output Log (streaming)              │
 * │             │                                      │
 * │             ├──────────────────────────────────────┤
 * │             │  ▶ Input Bar                         │
 * └─────────────┴──────────────────────────────────────┘
 *
 * The user types a task in natural language → Coordinator analyzes it →
 * agents spawn → output streams → prompts surface inline.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { colors, icons } from './theme.js';
import { ProjectSidebar, type ProjectItem } from './components/ProjectSidebar.js';
import { OutputLog, type LogEntry } from './components/OutputLog.js';
import { PromptBanner, type PendingPrompt } from './components/PromptBanner.js';
import { InputBar } from './components/InputBar.js';
import { StatusBar } from './components/StatusBar.js';

export interface DashboardAgent {
  id: string;
  role: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_input';
  elapsed?: number;
  pendingPrompt?: PendingPrompt;
}

export interface DashboardProps {
  /** Callback when user submits a new task */
  onTaskSubmit: (task: string) => void;
  /** Callback when user responds to an agent prompt */
  onPromptRespond: (agentId: string, response: string) => void;
  /** Callback when user switches project */
  onProjectSwitch: (path: string) => void;
  /** Callback when user kills an agent */
  onAgentKill: (agentId: string) => void;
  /** Initial projects list */
  projects: ProjectItem[];
  /** Current agents */
  agents: DashboardAgent[];
  /** Log entries */
  logEntries: LogEntry[];
  /** Current provider info */
  provider?: string;
  model?: string;
  budgetRemaining?: number;
  budgetTotal?: number;
  securityProfile?: string;
  /** Command history */
  commandHistory?: string[];
}

type FocusArea = 'input' | 'projects' | 'agents';

/**
 * Main Dashboard component.
 */
export function Dashboard({
  onTaskSubmit,
  onPromptRespond,
  onProjectSwitch,
  onAgentKill,
  projects,
  agents,
  logEntries,
  provider = 'claude-code',
  model = 'auto',
  budgetRemaining = 10.0,
  budgetTotal = 10.0,
  securityProfile = 'default',
  commandHistory = [],
}: DashboardProps) {
  const { exit } = useApp();
  const [focusArea, setFocusArea] = useState<FocusArea>('input');
  const [projectIndex, setProjectIndex] = useState(0);
  const [agentIndex, setAgentIndex] = useState(0);
  const [focusedAgent, setFocusedAgent] = useState<string | undefined>();

  // Find pending prompt (first agent awaiting input)
  const pendingPrompt = agents.find(a => a.pendingPrompt)?.pendingPrompt ?? null;

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // Tab cycles focus areas
    if (key.tab) {
      setFocusArea(prev => {
        if (prev === 'input') return 'projects';
        if (prev === 'projects') return 'agents';
        return 'input';
      });
      return;
    }

    // When focused on projects sidebar
    if (focusArea === 'projects') {
      if (key.upArrow || input === 'k') {
        setProjectIndex(i => Math.max(0, i - 1));
      } else if (key.downArrow || input === 'j') {
        setProjectIndex(i => Math.min(projects.length - 1, i + 1));
      } else if (key.return) {
        if (projects[projectIndex]) {
          onProjectSwitch(projects[projectIndex].path);
        }
      }
      return;
    }

    // When focused on agents
    if (focusArea === 'agents') {
      if (key.upArrow || input === 'k') {
        setAgentIndex(i => Math.max(0, i - 1));
      } else if (key.downArrow || input === 'j') {
        setAgentIndex(i => Math.min(agents.length - 1, i + 1));
      } else if (key.return) {
        // Focus on agent's output
        if (agents[agentIndex]) {
          setFocusedAgent(
            focusedAgent === agents[agentIndex].id
              ? undefined
              : agents[agentIndex].id
          );
        }
      } else if (input === 'x') {
        // Kill agent
        if (agents[agentIndex]) {
          onAgentKill(agents[agentIndex].id);
        }
      }
      return;
    }
  });

  const handlePromptRespond = useCallback((agentId: string, response: string) => {
    onPromptRespond(agentId, response);
  }, [onPromptRespond]);

  const handlePromptDismiss = useCallback(() => {
    // No-op for now, prompt stays until responded
  }, []);

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color={colors.chalk.accent}>✦ Kairos</Text>
        <Text color="gray">{new Date().toLocaleTimeString()}</Text>
      </Box>

      {/* Status Bar */}
      <StatusBar
        provider={provider}
        model={model}
        budgetRemaining={budgetRemaining}
        budgetTotal={budgetTotal}
        securityProfile={securityProfile}
      />

      {/* Main content area */}
      <Box flexGrow={1}>
        {/* Left: Project Sidebar */}
        <ProjectSidebar
          projects={projects}
          onSelect={onProjectSwitch}
          selectedIndex={focusArea === 'projects' ? projectIndex : -1}
          onNavigate={(dir) => {
            if (dir === 'up') setProjectIndex(i => Math.max(0, i - 1));
            else setProjectIndex(i => Math.min(projects.length - 1, i + 1));
          }}
        />

        {/* Right: Main panel */}
        <Box flexDirection="column" flexGrow={1}>
          {/* Agent List */}
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={focusArea === 'agents' ? colors.chalk.accent : 'gray'}
            paddingX={1}
          >
            <Box marginBottom={1}>
              <Text bold color="gray">
                Agents {agents.length > 0 ? `(${agents.length})` : ''}
              </Text>
              <Text color="gray" dimColor>  Tab to focus, j/k nav, x kill</Text>
            </Box>

            {agents.length === 0 && (
              <Text color="gray" dimColor>
                Type a task below to start agents...
              </Text>
            )}

            {agents.map((agent, i) => {
              const statusIcon = icons[agent.status === 'awaiting_input' ? 'blocked' : agent.status] ?? icons.idle;
              const statusColor = agent.status === 'awaiting_input'
                ? colors.chalk.accent
                : colors.chalk[agent.status] ?? 'gray';

              return (
                <Box key={agent.id}>
                  <Text
                    inverse={focusArea === 'agents' && i === agentIndex}
                    color={statusColor}
                  >
                    {statusIcon} {agent.id}
                  </Text>
                  <Text color="gray">: {agent.role.slice(0, 50)}</Text>
                  {agent.elapsed !== undefined && (
                    <Text color="gray" dimColor> [{agent.elapsed}s]</Text>
                  )}
                  {agent.status === 'awaiting_input' && (
                    <Text color={colors.chalk.accent} bold> ⚠ INPUT</Text>
                  )}
                </Box>
              );
            })}
          </Box>

          {/* Prompt Banner (appears only when agent needs input) */}
          {pendingPrompt && (
            <PromptBanner
              prompt={pendingPrompt}
              onRespond={handlePromptRespond}
              onDismiss={handlePromptDismiss}
            />
          )}

          {/* Output Log */}
          <OutputLog
            entries={logEntries}
            focusedAgent={focusedAgent}
          />

          {/* Input Bar */}
          <InputBar
            onSubmit={onTaskSubmit}
            placeholder="What would you like to do?"
            commandHistory={commandHistory}
          />
        </Box>
      </Box>

      {/* Footer hints */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color="gray" dimColor>
          Tab: switch focus | j/k: navigate | Enter: select | x: kill agent | Ctrl+C: exit
        </Text>
        <Text color="gray" dimColor>
          {focusArea === 'input' ? '📝 input' : focusArea === 'projects' ? '📂 projects' : '🤖 agents'}
        </Text>
      </Box>
    </Box>
  );
}
