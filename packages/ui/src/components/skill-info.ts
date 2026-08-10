// Detects when a tool call is a Skill invocation (Claude Code's Skill tool) and
// pulls out the skill name so the collapsed header can say *which* skill is
// running without the user having to expand the pane.
//
// Detection mirrors subagent-info.ts / exit-plan-doc.ts: intentionally loose so
// a shape drift degrades to "no skill name" rather than crashing.
//   { _meta: { claudeCode: { toolName: 'Skill' } },
//     rawInput: { skill: 'code-review', args: '...' }, status, ... }

import type { ToolCall } from '../services/acp-types.js';

function toolName(tool: ToolCall): string | undefined {
  const meta = (tool as { _meta?: { claudeCode?: { toolName?: unknown } } })._meta;
  const name = meta?.claudeCode?.toolName;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Returns the invoked skill's name when `tool` is a Skill invocation, else
 * undefined. Matches the stable _meta tag OR a non-empty rawInput.skill string;
 * returning only a real string guards against false positives on other tools.
 */
export function skillName(tool: ToolCall): string | undefined {
  const ri = (tool.rawInput && typeof tool.rawInput === 'object' ? tool.rawInput : {}) as { skill?: unknown };
  const name = typeof ri.skill === 'string' && ri.skill.trim() ? ri.skill.trim() : undefined;
  const isSkill = toolName(tool) === 'Skill' || name !== undefined;
  return isSkill ? name : undefined;
}
