import type { TimelineItem, ToolCall } from './acp-types.js';

// A resolved session/prompt normally means the turn is over. The one exception
// Kairos deliberately supports is Claude's delegated Task/Agent tool, which
// can keep streaming child tool updates after the prompt response lands.
export function hasDeferredStopTools(items: TimelineItem[]): boolean {
  return items.some((item) => item.kind === 'tool' && isDeferredStopTool(item.tool));
}

export function isDeferredStopTool(tool: ToolCall): boolean {
  return tool.status === 'in_progress' && isDelegatedSubAgent(tool);
}

function isDelegatedSubAgent(tool: ToolCall): boolean {
  const meta = (tool as { _meta?: { claudeCode?: { toolName?: unknown } } })._meta;
  if (meta?.claudeCode?.toolName === 'Agent') return true;
  const rawInput = tool.rawInput;
  return !!rawInput
    && typeof rawInput === 'object'
    && typeof (rawInput as { subagent_type?: unknown }).subagent_type === 'string';
}
