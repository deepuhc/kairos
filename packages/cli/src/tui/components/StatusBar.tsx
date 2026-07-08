import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme.js';

export interface StatusBarProps {
  provider: string;
  model: string;
  budgetRemaining: number;
  budgetTotal: number;
  securityProfile: string;
}

/**
 * Top status bar — always visible, never distracting
 * Shows: provider name, model, budget remaining, security profile
 *
 * MOUSE: click provider to switch, click budget to see breakdown (future)
 * KEYBOARD: not interactive (info only)
 */
export function StatusBar({
  provider,
  model,
  budgetRemaining,
  budgetTotal,
  securityProfile,
}: StatusBarProps) {
  const budgetPercent = (budgetRemaining / budgetTotal) * 100;
  const budgetColor =
    budgetPercent > 50 ? colors.chalk.success :
    budgetPercent > 20 ? colors.chalk.warning :
    colors.chalk.failed;

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Text color={colors.chalk.primary} bold>
          {provider}
        </Text>
        <Text color="gray">/</Text>
        <Text color="white">{model}</Text>
      </Box>

      <Box gap={2}>
        <Text color={budgetColor}>
          Budget: ${budgetRemaining.toFixed(2)} / ${budgetTotal.toFixed(2)}
        </Text>
        <Text color="gray">|</Text>
        <Text color={colors.chalk.blocked}>{securityProfile}</Text>
      </Box>
    </Box>
  );
}
