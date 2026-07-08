import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { StatusBar } from './components/StatusBar.js';
import { InputBar } from './components/InputBar.js';
import { PipelineView, PipelinePhase } from './components/PipelineView.js';
import { AgentList, Agent } from './components/AgentList.js';
import { ApprovalGate, ApprovalAction } from './components/ApprovalGate.js';
import { useKeyboard, globalKeys } from './hooks/useKeyboard.js';

type ViewType = 'pipeline' | 'agents';

export interface AppProps {
  provider?: string;
  model?: string;
  budgetTotal?: number;
  budgetRemaining?: number;
  securityProfile?: string;
  onCommand?: (command: string) => void;
}

/**
 * Main TUI application for Kairos
 *
 * Layout:
 * - Top status bar (model, budget, security profile)
 * - Main content area (switches between views)
 * - Bottom input bar
 *
 * Keyboard shortcuts:
 * - `q` to quit
 * - `Tab` to switch panels
 * - `Enter` to confirm
 * - `Escape` to cancel
 *
 * Mouse:
 * - Clickable status items
 * - Clickable tabs
 */
export function App({
  provider = 'anthropic',
  model = 'claude-sonnet-4-6',
  budgetTotal = 10.0,
  budgetRemaining = 8.5,
  securityProfile = 'standard',
  onCommand,
}: AppProps) {
  const { exit } = useApp();
  const [currentView, setCurrentView] = useState<ViewType>('pipeline');
  const [focusedPanel, setFocusedPanel] = useState<'status' | 'content' | 'input'>('content');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  // Demo state — in real app, this comes from orchestrator
  const [phases, setPhases] = useState<PipelinePhase[]>([
    {
      id: '1',
      name: 'Extract',
      status: 'complete',
      description: 'Reading client data',
    },
    {
      id: '2',
      name: 'Analyze',
      status: 'running',
      description: 'Matching transactions',
      progress: 65,
      details: ['Processing Chase statements', 'Categorizing expenses'],
    },
    {
      id: '3',
      name: 'Report',
      status: 'idle',
      description: 'Generate summary',
    },
  ]);

  const [agents, setAgents] = useState<Agent[]>([
    {
      id: 'a1',
      name: 'reconciler',
      status: 'running',
      startTime: new Date(Date.now() - 83000),
      cost: 0.042,
      tokensUsed: 1234,
      currentTask: 'Matching transactions from Chase',
    },
    {
      id: 'a2',
      name: 'validator',
      status: 'complete',
      startTime: new Date(Date.now() - 180000),
      cost: 0.018,
      tokensUsed: 567,
    },
  ]);

  const [pendingApproval, setPendingApproval] = useState<ApprovalAction | null>(null);

  // Global keyboard shortcuts
  useKeyboard([
    {
      key: globalKeys.quit.key,
      handler: () => {
        if (!pendingApproval) {
          exit();
        }
      },
    },
    {
      key: globalKeys.switchPanel.key,
      handler: () => {
        if (!pendingApproval) {
          setCurrentView((prev) => (prev === 'pipeline' ? 'agents' : 'pipeline'));
        }
      },
    },
  ]);

  const handleCommand = (command: string) => {
    setCommandHistory((prev) => [...prev, command]);
    if (onCommand) {
      onCommand(command);
    }

    // Demo: simulate approval request
    if (command.toLowerCase().includes('send') || command.toLowerCase().includes('email')) {
      setPendingApproval({
        id: 'approval-1',
        title: 'Ready to send reminder emails to 12 clients',
        description: 'Each client will receive a personalized email about missing documents.',
        actionType: 'email',
        preview: [
          'Anderson, Corp.  — missing: W-2, 1099-INT',
          'Baker LLC        — missing: K-1',
          'Chen, David      — missing: W-2',
          '... and 9 more',
        ],
      });
    }
  };

  const handlePhaseSelect = (phaseId: string) => {
    // In real app, show phase details modal or expand inline
    console.log('Selected phase:', phaseId);
  };

  const handleAgentInspect = (agentId: string) => {
    // In real app, show agent output/logs
    console.log('Inspect agent:', agentId);
  };

  const handleAgentKill = (agentId: string) => {
    // In real app, send kill signal to orchestrator
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
  };

  const handleApprove = () => {
    // In real app, send approval to orchestrator
    console.log('Approved:', pendingApproval?.id);
    setPendingApproval(null);
  };

  const handleEdit = () => {
    // In real app, open editor for approval details
    console.log('Edit:', pendingApproval?.id);
    setPendingApproval(null);
  };

  const handleCancel = () => {
    setPendingApproval(null);
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Status Bar */}
      <StatusBar
        provider={provider}
        model={model}
        budgetRemaining={budgetRemaining}
        budgetTotal={budgetTotal}
        securityProfile={securityProfile}
      />

      {/* Main Content Area */}
      <Box flexGrow={1} flexDirection="column" paddingTop={1}>
        {pendingApproval ? (
          <ApprovalGate
            action={pendingApproval}
            onApprove={handleApprove}
            onEdit={handleEdit}
            onCancel={handleCancel}
          />
        ) : (
          <Box flexDirection="row" gap={1} height="100%">
            {/* Pipeline View */}
            <Box flexBasis="60%">
              <PipelineView
                phases={phases}
                title="Pipeline"
                onPhaseSelect={handlePhaseSelect}
                focused={currentView === 'pipeline'}
              />
            </Box>

            {/* Agent List */}
            <Box flexBasis="40%">
              <AgentList
                agents={agents}
                onInspect={handleAgentInspect}
                onKill={handleAgentKill}
                focused={currentView === 'agents'}
              />
            </Box>
          </Box>
        )}
      </Box>

      {/* Input Bar */}
      <InputBar
        onSubmit={handleCommand}
        commandHistory={commandHistory}
        placeholder="What would you like to do?"
      />

      {/* Help hint */}
      {!pendingApproval && (
        <Box paddingX={1}>
          <Text color="gray" dimColor>
            Tab: switch panels • q: quit • ?: help
          </Text>
        </Box>
      )}
    </Box>
  );
}
