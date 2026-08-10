// Detects Claude Code's ExitPlanMode tool call — the moment the agent presents
// its finished plan (a markdown document) for approval in plan mode. The plan
// markdown rides in rawInput.plan and is present from the first (pending)
// tool_call event, so the Plan panel can show it before the user approves.
//
// Detection mirrors subagent-info.ts: intentionally loose so a shape drift
// degrades to "no plan doc" rather than crashing.
//   { _meta: { claudeCode: { toolName: 'ExitPlanMode' } },
//     rawInput: { plan: '<markdown>' }, status, ... }

import type { ToolCall } from '../services/acp-types.js';

function toolName(tool: ToolCall): string | undefined {
  const meta = (tool as { _meta?: { claudeCode?: { toolName?: unknown } } })._meta;
  const name = meta?.claudeCode?.toolName;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Returns the plan markdown when `tool` is an ExitPlanMode presentation, else
 * undefined. Matches the stable _meta tag OR a non-empty rawInput.plan string;
 * returning only a real string guards against false positives on other tools.
 */
export function exitPlanDoc(tool: ToolCall): string | undefined {
  const ri = (tool.rawInput && typeof tool.rawInput === 'object' ? tool.rawInput : {}) as { plan?: unknown };
  const plan = typeof ri.plan === 'string' && ri.plan.trim() ? ri.plan : undefined;
  const isExitPlan = toolName(tool) === 'ExitPlanMode' || plan !== undefined;
  return isExitPlan ? plan : undefined;
}
