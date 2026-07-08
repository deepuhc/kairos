import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme.js';

export interface LogEntry {
  agentId: string;
  text: string;
  timestamp: string;
  type: 'output' | 'status' | 'error' | 'prompt';
}

export interface OutputLogProps {
  entries: LogEntry[];
  maxLines?: number;
  focusedAgent?: string;
}

/**
 * Scrollable output log showing agent activity.
 * Filters by focused agent if one is selected.
 *
 * KEYBOARD: Shift+↑/↓ to scroll
 * MOUSE: Scroll wheel
 */
export function OutputLog({
  entries,
  maxLines = 15,
  focusedAgent,
}: OutputLogProps) {
  const filtered = focusedAgent
    ? entries.filter(e => e.agentId === focusedAgent)
    : entries;

  const visible = filtered.slice(-maxLines);

  const typeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'output': return 'white';
      case 'status': return colors.chalk.primary;
      case 'error': return colors.chalk.failed;
      case 'prompt': return colors.chalk.accent;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text bold color="gray">
          Output {focusedAgent ? `(${focusedAgent})` : '(all)'}
        </Text>
      </Box>

      {visible.length === 0 && (
        <Text color="gray" dimColor>Waiting for activity...</Text>
      )}

      {visible.map((entry, i) => (
        <Box key={i}>
          <Text color="gray" dimColor>{entry.timestamp} </Text>
          <Text color={colors.chalk.running}>{entry.agentId}: </Text>
          <Text color={typeColor(entry.type)} wrap="truncate-end">
            {entry.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
