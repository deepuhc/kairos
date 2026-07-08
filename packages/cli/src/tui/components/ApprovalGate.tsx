import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard, approvalKeys } from '../hooks/useKeyboard.js';
import { colors } from '../theme.js';

export interface ApprovalAction {
  id: string;
  title: string;
  description: string;
  preview?: string[];
  actionType: 'email' | 'file' | 'api' | 'command' | 'other';
}

export interface ApprovalGateProps {
  action: ApprovalAction;
  onApprove: () => void;
  onEdit: () => void;
  onCancel: () => void;
}

type ButtonType = 'approve' | 'edit' | 'cancel';

/**
 * Human approval dialog
 * The critical interaction for both keyboard and mouse users
 *
 * Shows:
 * - What action is about to happen (clear, non-technical language)
 * - Preview of the action (e.g., email list, file changes)
 * - Three buttons: [Approve] [Edit] [Cancel]
 *
 * MOUSE: click any button
 * KEYBOARD: Tab between buttons, Enter to select, 'y' for approve, 'n' for cancel
 */
export function ApprovalGate({ action, onApprove, onEdit, onCancel }: ApprovalGateProps) {
  const [selectedButton, setSelectedButton] = useState<ButtonType>('approve');

  useKeyboard([
    {
      key: 'tab',
      handler: () => {
        setSelectedButton((prev) => {
          if (prev === 'approve') return 'edit';
          if (prev === 'edit') return 'cancel';
          return 'approve';
        });
      },
    },
    {
      key: 'return',
      handler: () => {
        if (selectedButton === 'approve') onApprove();
        else if (selectedButton === 'edit') onEdit();
        else onCancel();
      },
    },
    {
      key: approvalKeys.approve.key,
      handler: onApprove,
    },
    {
      key: approvalKeys.reject.key,
      handler: onCancel,
    },
    {
      key: approvalKeys.edit.key,
      handler: onEdit,
    },
  ]);

  const getActionIcon = (type: ApprovalAction['actionType']) => {
    switch (type) {
      case 'email': return '✉';
      case 'file': return '📄';
      case 'api': return '🔌';
      case 'command': return '⚡';
      default: return '•';
    }
  };

  return (
    <Box
      borderStyle="double"
      borderColor={colors.chalk.warning}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      width="100%"
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={colors.chalk.warning} bold>
          {getActionIcon(action.actionType)} Approval Required
        </Text>
      </Box>

      {/* Title */}
      <Box marginBottom={1}>
        <Text color="white" bold>
          {action.title}
        </Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1}>
        <Text color="white">{action.description}</Text>
      </Box>

      {/* Preview */}
      {action.preview && action.preview.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
          marginBottom={1}
        >
          {action.preview.slice(0, 10).map((line, index) => (
            <Text key={index} color="gray">
              {line}
            </Text>
          ))}
          {action.preview.length > 10 && (
            <Text color="gray" dimColor>
              ... and {action.preview.length - 10} more
            </Text>
          )}
        </Box>
      )}

      {/* Buttons */}
      <Box gap={2} marginTop={1}>
        <Box
          borderStyle="single"
          borderColor={selectedButton === 'approve' ? colors.chalk.accent : 'gray'}
          paddingX={1}
        >
          <Text
            color={selectedButton === 'approve' ? colors.chalk.success : 'white'}
            bold={selectedButton === 'approve'}
          >
            {selectedButton === 'approve' && '▶ '}Approve (y)
          </Text>
        </Box>

        <Box
          borderStyle="single"
          borderColor={selectedButton === 'edit' ? colors.chalk.accent : 'gray'}
          paddingX={1}
        >
          <Text
            color={selectedButton === 'edit' ? colors.chalk.accent : 'white'}
            bold={selectedButton === 'edit'}
          >
            {selectedButton === 'edit' && '▶ '}Edit (e)
          </Text>
        </Box>

        <Box
          borderStyle="single"
          borderColor={selectedButton === 'cancel' ? colors.chalk.accent : 'gray'}
          paddingX={1}
        >
          <Text
            color={selectedButton === 'cancel' ? colors.chalk.failed : 'white'}
            bold={selectedButton === 'cancel'}
          >
            {selectedButton === 'cancel' && '▶ '}Cancel (n)
          </Text>
        </Box>
      </Box>

      {/* Help text */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Tab to switch • Enter to select • Escape to cancel
        </Text>
      </Box>
    </Box>
  );
}
