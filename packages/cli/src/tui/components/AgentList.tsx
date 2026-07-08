import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard, listKeys, agentKeys } from '../hooks/useKeyboard.js';
import { colors, icons } from '../theme.js';

export interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'complete' | 'failed' | 'blocked';
  startTime: Date;
  cost: number;
  tokensUsed: number;
  currentTask?: string;
}

export interface AgentListProps {
  agents: Agent[];
  onInspect: (agentId: string) => void;
  onKill: (agentId: string) => void;
  focused?: boolean;
}

/**
 * Running agents panel
 * Shows agents with status, elapsed time, cost
 *
 * MOUSE: click agent to see output, click kill button
 * KEYBOARD: j/k to navigate, Enter to inspect, 'x' to kill
 */
export function AgentList({ agents, onInspect, onKill, focused = false }: AgentListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard(
    focused
      ? [
          {
            key: listKeys.down.key,
            handler: () => setSelectedIndex((prev) => Math.min(prev + 1, agents.length - 1)),
          },
          {
            key: listKeys.up.key,
            handler: () => setSelectedIndex((prev) => Math.max(prev - 1, 0)),
          },
          {
            key: listKeys.downArrow.key,
            handler: () => setSelectedIndex((prev) => Math.min(prev + 1, agents.length - 1)),
          },
          {
            key: listKeys.upArrow.key,
            handler: () => setSelectedIndex((prev) => Math.max(prev - 1, 0)),
          },
          {
            key: agentKeys.inspect.key,
            handler: () => {
              if (agents[selectedIndex]) {
                onInspect(agents[selectedIndex].id);
              }
            },
          },
          {
            key: agentKeys.kill.key,
            handler: () => {
              if (agents[selectedIndex]) {
                onKill(agents[selectedIndex].id);
              }
            },
          },
        ]
      : []
  );

  const getStatusIcon = (status: Agent['status']) => {
    switch (status) {
      case 'idle': return icons.idle;
      case 'running': return icons.running;
      case 'complete': return icons.complete;
      case 'failed': return icons.failed;
      case 'blocked': return icons.blocked;
    }
  };

  const getStatusColor = (status: Agent['status']) => {
    switch (status) {
      case 'idle': return colors.chalk.idle;
      case 'running': return colors.chalk.running;
      case 'complete': return colors.chalk.complete;
      case 'failed': return colors.chalk.failed;
      case 'blocked': return colors.chalk.blocked;
    }
  };

  const getElapsedTime = (startTime: Date) => {
    const elapsed = Date.now() - startTime.getTime();
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  if (agents.length === 0) {
    return (
      <Box
        borderStyle="single"
        borderColor={focused ? colors.chalk.primary : 'gray'}
        paddingX={1}
        paddingY={1}
        flexDirection="column"
      >
        <Text bold>Agents</Text>
        <Text color="gray" dimColor>No agents running</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="single"
      borderColor={focused ? colors.chalk.primary : 'gray'}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
    >
      <Text bold>Agents {focused && <Text color="gray">(j/k: navigate, Enter: inspect, x: kill)</Text>}</Text>
      <Box flexDirection="column" marginTop={1}>
        {agents.map((agent, index) => {
          const isSelected = focused && index === selectedIndex;
          const statusIcon = getStatusIcon(agent.status);
          const statusColor = getStatusColor(agent.status);

          return (
            <Box key={agent.id} marginY={0}>
              <Text color={isSelected ? colors.chalk.accent : 'white'}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text color={statusColor}>{statusIcon} </Text>
              <Text color={isSelected ? colors.chalk.accent : 'white'} bold={isSelected}>
                {agent.name}
              </Text>
              <Text color="gray"> — {getElapsedTime(agent.startTime)}</Text>
              <Text color="gray"> — ${agent.cost.toFixed(3)}</Text>
              {agent.currentTask && (
                <Text color="gray" dimColor> — {agent.currentTask}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      {focused && agents.length > 0 && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {selectedIndex + 1} of {agents.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}
