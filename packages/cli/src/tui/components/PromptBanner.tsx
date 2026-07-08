import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme.js';

export interface PendingPrompt {
  agentId: string;
  message: string;
  options?: string[];
}

export interface PromptBannerProps {
  prompt: PendingPrompt | null;
  onRespond: (agentId: string, response: string) => void;
  onDismiss: () => void;
}

/**
 * Inline prompt banner — surfaces when an agent needs user input.
 * Appears between the agent list and output log.
 *
 * KEYBOARD: number keys (1-9) to pick option, or type free response + Enter
 * MOUSE: Click option buttons
 */
export function PromptBanner({
  prompt,
  onRespond,
  onDismiss,
}: PromptBannerProps) {
  const [freeInput, setFreeInput] = useState('');

  useInput((input, key) => {
    if (!prompt) return;

    // Number key selects option directly
    if (prompt.options && /^[1-9]$/.test(input)) {
      const idx = parseInt(input) - 1;
      if (idx < prompt.options.length) {
        onRespond(prompt.agentId, prompt.options[idx]);
        setFreeInput('');
      }
      return;
    }

    // Enter submits free response
    if (key.return && freeInput.trim()) {
      onRespond(prompt.agentId, freeInput.trim());
      setFreeInput('');
      return;
    }

    // Escape dismisses
    if (key.escape) {
      onDismiss();
      setFreeInput('');
      return;
    }

    // Typing
    if (key.backspace || key.delete) {
      setFreeInput(prev => prev.slice(0, -1));
    } else if (!key.ctrl && !key.meta && input) {
      setFreeInput(prev => prev + input);
    }
  });

  if (!prompt) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors.chalk.accent}
      paddingX={1}
      paddingY={0}
    >
      <Box>
        <Text color={colors.chalk.accent} bold>⚠ </Text>
        <Text color={colors.chalk.running} bold>{prompt.agentId}</Text>
        <Text color="white"> needs your input:</Text>
      </Box>

      <Box marginLeft={2}>
        <Text color="white">{prompt.message}</Text>
      </Box>

      {prompt.options && (
        <Box marginLeft={2} gap={2} marginTop={1}>
          {prompt.options.map((opt, i) => (
            <Text key={i} color={colors.chalk.primary}>
              [{i + 1}] {opt}
            </Text>
          ))}
        </Box>
      )}

      <Box marginLeft={2} marginTop={1}>
        <Text color="gray">▶ </Text>
        <Text color="white">
          {freeInput || <Text color="gray" dimColor>Type response or pick option...</Text>}
        </Text>
      </Box>
    </Box>
  );
}
