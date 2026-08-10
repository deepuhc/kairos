// Serialize an Agents-tab conversation to Markdown for copy / export.
//
// The chat timeline is bottom-anchored and windowed (only the last N items are
// mounted), so the DOM can never hold a long conversation in full. These pure
// functions serialize straight from the in-memory `TimelineItem[]`, so "Copy
// all" captures the entire transcript regardless of what's rendered.

import type {
  ContentBlock,
  DiffContent,
  PlainToolContent,
  TerminalToolContent,
  TimelineItem,
  ToolCall,
} from './acp-types.js';
import { stripControlChars, cleanTerminalText } from './sanitize-text.js';

export interface SerializeOptions {
  agentName: string;
  // Resolves live terminal output by id — terminal blocks reference an id, not
  // the text itself (same accessor `renderItem` receives). Optional so the
  // serializer stays usable without a live session.
  terminalOutputFor?: (terminalId: string) => string | undefined;
}

export interface TimelineHeader {
  sessionName?: string;
  cwd?: string;
}

export function messageBodyForClipboard(item: Extract<TimelineItem, { kind: 'message' }>): string {
  return stripControlChars(item.text);
}

// Render one non-text content block to plain text. Images/audio become a
// placeholder (base64 payloads are useless in a transcript); resources yield
// their text or uri.
function serializeBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return (block as { text?: string }).text ?? '';
    case 'image':
      return '[image attachment]';
    case 'audio':
      return '[audio attachment]';
    case 'resource_link': {
      const b = block as { name?: string; uri?: string };
      return `[${b.name ?? b.uri ?? 'resource'}](${b.uri ?? ''})`;
    }
    case 'resource': {
      const r = (block as { resource?: { uri?: string; text?: string; mimeType?: string } }).resource;
      if (r?.text != null) {
        const label = r.uri ?? r.mimeType ?? 'resource';
        return `\`${label}\`\n\n\`\`\`\n${r.text}\n\`\`\``;
      }
      return `\`${r?.uri ?? r?.mimeType ?? 'resource'}\``;
    }
    default:
      return '```json\n' + JSON.stringify(block, null, 2) + '\n```';
  }
}

function fencedDiff(d: DiffContent): string {
  const lines: string[] = [];
  for (const l of (d.oldText ?? '').split('\n')) if (l.length) lines.push(`- ${l}`);
  for (const l of d.newText.split('\n')) lines.push(`+ ${l}`);
  return `\`\`\`diff\n${lines.join('\n')}\n\`\`\``;
}

function serializeTool(tool: ToolCall, opts: SerializeOptions, depth = 0): string {
  const indent = depth > 0 ? '  '.repeat(depth) : '';
  const parts: string[] = [];
  const status = tool.status && tool.status !== 'completed' ? ` (${tool.status})` : '';
  parts.push(`**⚙ ${stripControlChars(tool.title ?? tool.kind ?? 'tool')}${status}**`);

  for (const c of tool.content ?? []) {
    if (c.type === 'diff') {
      const d = c as DiffContent;
      parts.push(`\`${d.path}\``, fencedDiff(d));
    } else if (c.type === 'terminal') {
      const out = opts.terminalOutputFor?.((c as TerminalToolContent).terminalId);
      if (out != null && out.length) parts.push('```\n' + cleanTerminalText(out) + '\n```');
    } else if (c.type === 'content') {
      parts.push(serializeBlock((c as PlainToolContent).content));
    }
  }

  // Sub-agent tool calls folded under a Task, indented one level deeper.
  for (const child of tool.children ?? []) {
    parts.push(serializeTool(child, opts, depth + 1));
  }

  const body = parts.join('\n\n');
  return indent ? body.split('\n').map((l) => (l ? indent + l : l)).join('\n') : body;
}

export function serializeItem(item: TimelineItem, opts: SerializeOptions): string {
  switch (item.kind) {
    case 'message':
      return item.role === 'user'
        ? `**You:**\n\n${stripControlChars(item.text)}`
        : `**${opts.agentName}:**\n\n${stripControlChars(item.text)}`;
    case 'thought':
      return stripControlChars(item.text)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'tool':
      return serializeTool(item.tool, opts);
    case 'block':
      return serializeBlock(item.block);
    case 'note':
      return `_${item.text}_`;
  }
}

export function serializeTimeline(
  items: TimelineItem[],
  opts: SerializeOptions & TimelineHeader,
): string {
  const parts: string[] = [];
  const header: string[] = [];
  if (opts.sessionName) header.push(`# ${opts.sessionName}`);
  if (opts.cwd) header.push(`\`${opts.cwd}\``);
  if (header.length) parts.push(header.join('\n\n'));
  for (const item of items) parts.push(serializeItem(item, opts));
  return parts.join('\n\n---\n\n');
}
