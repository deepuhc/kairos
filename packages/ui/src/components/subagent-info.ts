// Detects when a tool call is really a delegated sub-agent (Claude's Task tool)
// and pulls out the fields worth showing as a distinct card: the sub-agent type,
// the task description/prompt, and the final report.
//
// Shape learned from a live Claude ACP session (kind is 'think', title mutates
// from "Task" to the description, so neither is a reliable signal):
//   { _meta: { claudeCode: { toolName: 'Agent' } },
//     rawInput: { subagent_type, description, prompt },
//     status, content: [...], rawOutput: [{ type:'text', text }, ...] }
// The report arrives on completion in `rawOutput` (an array of text blocks whose
// first element is the report; later elements are a SendMessage/usage footer).
// It is duplicated into `content[]` at completion — but mid-run `content[]`
// holds the prompt, so the content fallback only applies once completed.

import type { ContentBlock, ToolCall } from '../services/acp-types.js';

export interface SubAgentInfo {
  /** subagent_type, e.g. 'general-purpose' or 'code-reviewer'; '' if unreported. */
  type: string;
  description?: string;
  prompt?: string;
  /** Final report text, once the sub-agent has finished. */
  report?: string;
}

interface RawInput {
  subagent_type?: unknown;
  description?: unknown;
  prompt?: unknown;
}

// Claude Code tags every tool_call with the underlying tool name here; the Task
// tool surfaces as 'Agent'. This is the one field present and stable from the
// first (still-empty) pending event through completion.
function toolName(tool: ToolCall): string | undefined {
  const meta = (tool as { _meta?: { claudeCode?: { toolName?: unknown } } })._meta;
  const name = meta?.claudeCode?.toolName;
  return typeof name === 'string' ? name : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

// First text found in a rawOutput array or a content[] block list. Sub-agent
// output is markdown text; anything else is ignored.
function firstText(blocks: unknown): string | undefined {
  if (!Array.isArray(blocks)) return undefined;
  for (const b of blocks) {
    if (b && typeof b === 'object') {
      const rec = b as { type?: unknown; text?: unknown; content?: unknown };
      if (rec.type === 'text') return str(rec.text);
      // ToolCallContent 'content' wrapper: { type:'content', content:{type:'text',text} }
      if (rec.type === 'content' && rec.content && typeof rec.content === 'object') {
        const inner = rec.content as ContentBlock;
        if (inner.type === 'text') return str((inner as { text?: unknown }).text);
      }
    }
  }
  return undefined;
}

function extractReport(tool: ToolCall): string | undefined {
  const raw = tool.rawOutput;
  if (typeof raw === 'string') return str(raw);
  const fromRaw = firstText(raw);
  if (fromRaw) return fromRaw;
  // content[] mirrors the report only once completed; before that it holds the
  // dispatched prompt, so don't mistake it for output mid-run.
  if (tool.status === 'completed') return firstText(tool.content);
  return undefined;
}

/**
 * Returns sub-agent details when `tool` is a Task/Agent delegation, else null
 * (the card then renders as an ordinary tool). Detection is intentionally
 * loose so a shape drift degrades to the old rendering rather than crashing.
 */
export function subAgentInfo(tool: ToolCall): SubAgentInfo | null {
  const ri = (tool.rawInput && typeof tool.rawInput === 'object' ? tool.rawInput : {}) as RawInput;
  const isAgent = toolName(tool) === 'Agent' || typeof ri.subagent_type === 'string';
  if (!isAgent) return null;
  return {
    type: str(ri.subagent_type) ?? '',
    description: str(ri.description),
    prompt: str(ri.prompt),
    report: extractReport(tool),
  };
}
