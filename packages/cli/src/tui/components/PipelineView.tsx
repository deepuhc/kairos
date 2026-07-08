import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard, listKeys, agentKeys } from '../hooks/useKeyboard.js';
import { colors, icons } from '../theme.js';

export interface PipelinePhase {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
  description?: string;
  progress?: number; // 0-100
  details?: string[];
}

export interface PipelineViewProps {
  phases: PipelinePhase[];
  title?: string;
  onPhaseSelect?: (phaseId: string) => void;
  focused?: boolean;
}

/**
 * Pipeline visualization
 * Shows the current pipeline execution with phase boxes connected by arrows
 *
 * Status indicators:
 * ○ idle
 * ◉ running
 * ✓ complete
 * ✗ failed
 *
 * MOUSE: click a phase to see details
 * KEYBOARD: arrow keys to navigate phases, Enter for details
 */
export function PipelineView({
  phases,
  title = 'Pipeline',
  onPhaseSelect,
  focused = false,
}: PipelineViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard(
    focused && onPhaseSelect
      ? [
          {
            key: listKeys.down.key,
            handler: () => setSelectedIndex((prev) => Math.min(prev + 1, phases.length - 1)),
          },
          {
            key: listKeys.up.key,
            handler: () => setSelectedIndex((prev) => Math.max(prev - 1, 0)),
          },
          {
            key: listKeys.downArrow.key,
            handler: () => setSelectedIndex((prev) => Math.min(prev + 1, phases.length - 1)),
          },
          {
            key: listKeys.upArrow.key,
            handler: () => setSelectedIndex((prev) => Math.max(prev - 1, 0)),
          },
          {
            key: agentKeys.inspect.key,
            handler: () => {
              if (phases[selectedIndex]) {
                onPhaseSelect(phases[selectedIndex].id);
              }
            },
          },
        ]
      : []
  );

  const getStatusIcon = (status: PipelinePhase['status']) => {
    switch (status) {
      case 'idle': return icons.idle;
      case 'running': return icons.running;
      case 'complete': return icons.complete;
      case 'failed': return icons.failed;
    }
  };

  const getStatusColor = (status: PipelinePhase['status']) => {
    switch (status) {
      case 'idle': return colors.chalk.idle;
      case 'running': return colors.chalk.running;
      case 'complete': return colors.chalk.complete;
      case 'failed': return colors.chalk.failed;
    }
  };

  if (phases.length === 0) {
    return (
      <Box
        borderStyle="single"
        borderColor={focused ? colors.chalk.primary : 'gray'}
        paddingX={1}
        paddingY={1}
        flexDirection="column"
      >
        <Text bold>{title}</Text>
        <Text color="gray" dimColor>No pipeline active</Text>
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
      <Text bold>{title}</Text>
      {focused && onPhaseSelect && (
        <Text color="gray" dimColor>(arrow keys: navigate, Enter: details)</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {phases.map((phase, index) => {
          const isSelected = focused && index === selectedIndex;
          const isLast = index === phases.length - 1;
          const statusIcon = getStatusIcon(phase.status);
          const statusColor = getStatusColor(phase.status);

          return (
            <Box key={phase.id} flexDirection="column">
              <Box>
                <Text color={isSelected ? colors.chalk.accent : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={statusColor}>{statusIcon} </Text>
                <Text color={isSelected ? colors.chalk.accent : 'white'} bold={isSelected}>
                  {phase.name}
                </Text>
                {phase.description && (
                  <Text color="gray"> — {phase.description}</Text>
                )}
              </Box>

              {/* Progress bar for running phases */}
              {phase.status === 'running' && phase.progress !== undefined && (
                <Box marginLeft={4} marginTop={0}>
                  <Text color={colors.chalk.running}>
                    [{
                      '='.repeat(Math.floor(phase.progress / 5)) +
                      ' '.repeat(20 - Math.floor(phase.progress / 5))
                    }] {phase.progress}%
                  </Text>
                </Box>
              )}

              {/* Details if selected */}
              {isSelected && phase.details && phase.details.length > 0 && (
                <Box flexDirection="column" marginLeft={4} marginTop={0}>
                  {phase.details.map((detail, i) => (
                    <Text key={i} color="gray" dimColor>• {detail}</Text>
                  ))}
                </Box>
              )}

              {/* Arrow connector to next phase */}
              {!isLast && (
                <Box marginLeft={4}>
                  <Text color="gray">{icons.arrow}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
