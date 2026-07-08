import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme.js';

export interface InputBarProps {
  onSubmit: (input: string) => void;
  placeholder?: string;
  commandHistory?: string[];
}

/**
 * Bottom input bar
 * Natural language input for non-devs ("What would you like to do?")
 * Command input for devs (recognizes `kairos run`, `kairos agents kill` etc.)
 *
 * MOUSE: click to focus (always focused by default though)
 * KEYBOARD: type directly, Up arrow for history, Ctrl+C to cancel
 */
export function InputBar({
  onSubmit,
  placeholder = 'What would you like to do?',
  commandHistory = [],
}: InputBarProps) {
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((inputChar, key) => {
    if (key.return) {
      if (input.trim()) {
        onSubmit(input.trim());
        setInput('');
        setHistoryIndex(-1);
      }
    } else if (key.upArrow) {
      // Navigate history
      if (commandHistory.length > 0) {
        const newIndex = historyIndex + 1;
        if (newIndex < commandHistory.length) {
          setHistoryIndex(newIndex);
          setInput(commandHistory[commandHistory.length - 1 - newIndex]);
        }
      }
    } else if (key.downArrow) {
      // Navigate history
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (!key.ctrl && !key.meta && inputChar) {
      setInput((prev) => prev + inputChar);
    }
  });

  return (
    <Box
      borderStyle="single"
      borderColor={colors.chalk.primary}
      paddingX={1}
    >
      <Text color={colors.chalk.accent}>▶ </Text>
      <Text color="white">
        {input || <Text color="gray" dimColor>{placeholder}</Text>}
        <Text color={colors.chalk.accent}>_</Text>
      </Text>
    </Box>
  );
}
