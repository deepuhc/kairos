import { describe, expect, it } from 'vitest';
import { hasDeferredStopTools, isDeferredStopTool } from '../services/agent-liveness.js';
import type { TimelineItem, ToolCall } from '../services/acp-types.js';

function tool(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: 'tool-1',
    title: 'Run command',
    kind: 'execute',
    status: 'in_progress',
    ...overrides,
  };
}

function item(t: ToolCall): TimelineItem {
  return { kind: 'tool', id: `tool:${t.toolCallId}`, tool: t };
}

describe('agent liveness', () => {
  it('does not defer stop for generic stale in-progress tools', () => {
    expect(isDeferredStopTool(tool())).toBe(false);
    expect(hasDeferredStopTools([item(tool())])).toBe(false);
  });

  it('defers stop for Claude delegated sub-agent tasks still in progress', () => {
    const task = tool({
      title: 'Task',
      kind: 'think',
      _meta: { claudeCode: { toolName: 'Agent' } },
    } as Partial<ToolCall>);

    expect(isDeferredStopTool(task)).toBe(true);
    expect(hasDeferredStopTools([item(task)])).toBe(true);
  });

  it('recognizes delegated task input even if metadata is missing', () => {
    expect(isDeferredStopTool(tool({ rawInput: { subagent_type: 'code-reviewer' } }))).toBe(true);
  });

  it('does not defer stop for completed delegated tasks', () => {
    expect(isDeferredStopTool(tool({
      status: 'completed',
      _meta: { claudeCode: { toolName: 'Agent' } },
    } as Partial<ToolCall>))).toBe(false);
  });
});
