import { useInput } from 'ink';
import { useState, useCallback } from 'react';

export interface KeyboardState {
  lastKey: string | null;
  ctrlC: boolean;
  escape: boolean;
}

export interface KeyHandler {
  key: string;
  handler: () => void;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/**
 * Keyboard shortcut manager for Kairos TUI
 * Handles both global and context-sensitive keys
 */
export function useKeyboard(handlers: KeyHandler[]) {
  const [state, setState] = useState<KeyboardState>({
    lastKey: null,
    ctrlC: false,
    escape: false,
  });

  useInput(
    useCallback(
      (input, key) => {
        // Track special keys
        if (key.ctrl && input === 'c') {
          setState((prev) => ({ ...prev, ctrlC: true }));
        }
        if (key.escape) {
          setState((prev) => ({ ...prev, escape: true, lastKey: 'escape' }));
        }

        // Match handlers
        for (const handler of handlers) {
          const keyMatch = handler.key === input;
          const ctrlMatch = handler.ctrl ? key.ctrl : true;
          const shiftMatch = handler.shift ? key.shift : true;
          const metaMatch = handler.meta ? key.meta : true;

          if (keyMatch && ctrlMatch && shiftMatch && metaMatch) {
            handler.handler();
            setState((prev) => ({ ...prev, lastKey: input }));
            return;
          }
        }

        // Update last key
        setState((prev) => ({ ...prev, lastKey: input }));
      },
      [handlers]
    )
  );

  return state;
}

/**
 * Predefined keyboard shortcuts for common TUI actions
 */
export const globalKeys = {
  quit: { key: 'q', description: 'Quit' },
  switchPanel: { key: 'tab', description: 'Switch panel' },
  confirm: { key: 'return', description: 'Confirm' },
  cancel: { key: 'escape', description: 'Cancel' },
  help: { key: '?', description: 'Help' },
} as const;

export const listKeys = {
  up: { key: 'k', description: 'Up' },
  down: { key: 'j', description: 'Down' },
  upArrow: { key: 'upArrow', description: 'Up' },
  downArrow: { key: 'downArrow', description: 'Down' },
  pageUp: { key: 'pageUp', description: 'Page up' },
  pageDown: { key: 'pageDown', description: 'Page down' },
  first: { key: 'g', description: 'First' },
  last: { key: 'G', description: 'Last', shift: true },
} as const;

export const approvalKeys = {
  approve: { key: 'y', description: 'Approve' },
  reject: { key: 'n', description: 'Reject' },
  edit: { key: 'e', description: 'Edit' },
} as const;

export const agentKeys = {
  inspect: { key: 'return', description: 'Inspect' },
  kill: { key: 'x', description: 'Kill' },
  restart: { key: 'r', description: 'Restart' },
} as const;
