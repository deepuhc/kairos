import { describe, expect, it } from 'vitest';
import { Conversation } from '../services/acp-conversation.js';
import type { SessionUpdate } from '../services/acp-types.js';

describe('Conversation background tracking', () => {
  it('tracks Claude background launches until their task notification arrives', () => {
    const c = new Conversation();

    c.apply({
      sessionUpdate: 'tool_call',
      toolCallId: 'bash-1',
      title: 'Bash',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm test', run_in_background: true },
      _meta: { claudeCode: { toolName: 'Bash' } },
    } as unknown as SessionUpdate);

    expect(c.backgroundActiveCount).toBe(1);

    c.apply({
      sessionUpdate: 'user_message_chunk',
      content: {
        type: 'text',
        text: '<task-notification><status>completed</status><summary>Tests finished</summary></task-notification>',
      },
    });

    expect(c.backgroundActiveCount).toBe(0);
    expect(c.items.at(-1)).toMatchObject({ kind: 'note', text: 'Tests finished' });
  });

  it('does not track generic non-Claude run_in_background payloads', () => {
    const c = new Conversation();

    c.apply({
      sessionUpdate: 'tool_call',
      toolCallId: 'codex-shell-1',
      title: 'Run command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { cmd: 'npm test', run_in_background: true },
    } as unknown as SessionUpdate);

    expect(c.backgroundActiveCount).toBe(0);
  });
});
