// Curated ACP protocol reference for the "Behind the Scenes" view.
//
// Each entry pairs a real protocol message with the UI it drives. The frames
// here are hand-authored from the actual ACP types (see acp-types.ts) and the
// exact client constants the Rust backend sends, so the
// showcase teaches the real protocol rather than an invented one.
//
// Two kinds of payload:
//  - `envelope`: a full JSON-RPC 2.0 request/response pair. The browser never
//    sees these (the backend builds them over stdio), so they're curated for
//    the reference; acp-showcase.test.ts asserts the handshake stays in sync.
//  - `updates`: `session/update` notification bodies. These ARE what the
//    frontend receives; folding them through the real `Conversation` yields the
//    same timeline items the live view renders.

import type { PermissionRequest, ElicitationRequest } from './acp.js';
import { KAIROS_VERSION } from './app-version.js';
import type { SessionUpdate, TurnUsage } from './acp-types.js';

// A tiny 200×120 PNG of a blank-looking chart (dark card, axes, an empty plot
// area) — a real, *visible* image so the prompt card's attachment renders as a
// thumbnail rather than an invisible 1×1 pixel, without bloating the bundle.
export const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAYAAAC3kr3rAAABf0lEQVR4nO3TsQkCQRRF0W1BMLQAIwvQTgytwBos2lRhY/eCsLiDnOBEb4IfzJ12+8ML+Gza+gAYmUAgCASCQCAIBIJAIAgEgkAgCASCQCAIBIJAIAgEwuqBHE9nGNqmgVxv982rhyUCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIAoEgEAgCgSAQCAKBIBAIwwVyeTxnS+/t9l/uwwUCIxEIBIFAEAgEgUAQCASBQBAIBIFAEAgEgUAQCASBQBAIBIFAEAgEgUAYIhAY1bf/efVA4J8IBIJAIAgEgkAgCASCQCAIBIJAIAgEgkAgCASCQCAIBIJAIAgEgkAgCASCQCAIBIJAILwBwqSnzNIBUHQAAAAASUVORK5CYII=';

// Mirrors src-tauri/src/backend/acp.rs.
export const SHOWCASE_PROTOCOL_VERSION = 1;
export const SHOWCASE_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
  elicitation: { form: {} },
};
export const SHOWCASE_CLIENT_INFO = { name: 'kairos', title: 'Kairos', version: KAIROS_VERSION };

export interface JsonRpcEnvelope {
  request: unknown;
  response?: unknown;
}

// How the right-hand "rendered UI" column should be built for an entry.
//  - 'timeline'  → fold `updates` through Conversation, render the items
//  - 'tool'      → render the single tool from `updates` as <agents-tool-call>
//  - 'permission'→ render a tool card with the pending permission strip
//  - 'elicitation'→ render the <agents-elicitation> form
//  - 'capabilities'→ a capability→feature table (initialize)
//  - 'config'    → config controls, read from the envelope's response.configOptions
//  - 'terminal'  → a tool card whose terminal content streams `terminalOutput`
//  - 'commands'  → the composer's slash-command menu, from `updates`
//  - 'clientcall'→ an "answered by this UI" panel (agent→client requests: fs/*,
//                  session/load, session/cancel) — there is no timeline UI, the
//                  point is that Kairos is itself an ACP server
export type ShowcaseRenderKind =
  | 'timeline'
  | 'tool'
  | 'permission'
  | 'elicitation'
  | 'capabilities'
  | 'config'
  | 'terminal'
  | 'commands'
  | 'clientcall';

export interface ShowcaseEntry {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  render: ShowcaseRenderKind;
  // The JSON shown on the left. `envelope` for request/response entries
  // (handshake, requests, permissions, elicitation); otherwise the JSON column
  // is derived from `updates` so it can never drift from what the right column
  // folds — see jsonSourceFor.
  envelope?: JsonRpcEnvelope;
  // Notification bodies folded through Conversation to produce the rendering.
  updates?: SessionUpdate[];
  // Per-turn usage from `session/prompt`, folded into Conversation so showcase
  // usage meters exercise the same prompt-cache path as live sessions.
  turnUsage?: TurnUsage[];
  // For permission / elicitation entries, the request the component renders.
  permission?: PermissionRequest;
  elicitation?: ElicitationRequest;
  // For 'clientcall' / 'terminal' entries: bullet points describing how this UI
  // services the agent→client request (Kairos acts as the ACP *server* here).
  handledBy?: string[];
  // Optional path→feature notes used by the capabilities table and to label
  // which JSON field maps to which rendered region for hover-highlight.
  mappings?: Array<{ path: string; label: string }>;
}

const SESSION_ID = 'sess_9f3c1a7b';

export const SHOWCASE: ShowcaseEntry[] = [
  {
    id: 'initialize',
    title: 'Handshake',
    subtitle: 'initialize',
    blurb:
      'The first thing the client sends. We advertise what this UI can do (read/write files, run terminals, show elicitation forms) and the agent replies with its own capabilities — including which content types it accepts in a prompt.',
    render: 'capabilities',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: SHOWCASE_PROTOCOL_VERSION,
          clientCapabilities: SHOWCASE_CLIENT_CAPABILITIES,
          clientInfo: SHOWCASE_CLIENT_INFO,
        },
      },
      response: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'claude-code-acp', title: 'Claude Code', version: '1.0.0' },
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true, audio: false, embeddedContext: true },
          },
          authMethods: [],
        },
      },
    },
    mappings: [
      { path: 'response.result.agentCapabilities.promptCapabilities.image', label: 'Image attach button' },
      { path: 'response.result.agentCapabilities.promptCapabilities.embeddedContext', label: '@-mention files' },
      { path: 'response.result.agentCapabilities.loadSession', label: 'Resume past sessions' },
      { path: 'response.result.authMethods', label: 'No login prompt — gateway handles auth' },
    ],
  },
  {
    id: 'session-new',
    title: 'New session',
    subtitle: 'session/new',
    blurb:
      'Opens a conversation rooted at a working directory. The agent returns a session id plus its current config — the model, reasoning effort, and mode choices — which become the controls in the composer.',
    render: 'config',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        params: { cwd: '/Users/you/code/kairos', mcpServers: [] },
      },
      response: {
        jsonrpc: '2.0',
        id: 2,
        result: {
          sessionId: SESSION_ID,
          configOptions: [
            {
              id: 'model',
              name: 'Model',
              category: 'model',
              type: 'select',
              currentValue: 'claude-opus-4-8',
              options: [
                { value: 'claude-opus-4-8', name: 'Opus 4.8' },
                { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
                { value: 'claude-haiku-4-5', name: 'Haiku 4.5' },
              ],
            },
            {
              id: 'effort',
              name: 'Effort',
              category: 'thought_level',
              type: 'select',
              currentValue: 'medium',
              options: [
                { value: 'low', name: 'Low' },
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High' },
              ],
            },
          ],
        },
      },
    },
    mappings: [
      { path: 'response.result.configOptions.0', label: 'Model picker' },
      { path: 'response.result.configOptions.1', label: 'Effort dropdown' },
    ],
  },
  {
    id: 'set-config-option',
    title: 'Change a setting',
    subtitle: 'session/set_config_option',
    blurb:
      'Picking a different model or effort sends this request. The agent replies with the FULL rebuilt option set — switching to a model with no reasoning effort drops the effort control entirely — so the composer adopts the response wholesale rather than mutating one field.',
    render: 'config',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 4,
        method: 'session/set_config_option',
        params: { sessionId: SESSION_ID, configId: 'model', value: 'claude-sonnet-4-6' },
      },
      response: {
        jsonrpc: '2.0',
        id: 4,
        result: {
          configOptions: [
            {
              id: 'model',
              name: 'Model',
              category: 'model',
              type: 'select',
              currentValue: 'claude-sonnet-4-6',
              options: [
                { value: 'claude-opus-4-8', name: 'Opus 4.8' },
                { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
                { value: 'claude-haiku-4-5', name: 'Haiku 4.5' },
              ],
            },
            {
              id: 'effort',
              name: 'Effort',
              category: 'thought_level',
              type: 'select',
              currentValue: 'high',
              options: [
                { value: 'low', name: 'Low' },
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High' },
              ],
            },
          ],
        },
      },
    },
    mappings: [
      { path: 'request.params.configId', label: 'Which control changed' },
      { path: 'response.result.configOptions.0', label: 'Model pill, now Sonnet' },
    ],
  },
  {
    id: 'prompt',
    title: 'User prompt',
    subtitle: 'session/prompt',
    blurb:
      'A turn the user sends. The prompt is an array of content blocks — here a line of text plus an image. The agent only accepts image blocks because it advertised promptCapabilities.image in the handshake.',
    render: 'timeline',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'session/prompt',
        params: {
          sessionId: SESSION_ID,
          prompt: [
            { type: 'text', text: 'Why is this chart rendering blank?' },
            { type: 'image', mimeType: 'image/png', data: SAMPLE_PNG_BASE64 },
          ],
        },
      },
      response: { jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } },
    },
    // The UI echoes the user turn locally via pushUserMessage; the showcase
    // does the same so the rendered bubble matches the live view.
    updates: [],
  },
  {
    id: 'agent-message',
    title: 'Assistant reply',
    subtitle: 'session/update · agent_message_chunk',
    blurb:
      'The agent streams its answer as a series of text chunks. The UI coalesces same-role chunks into one bubble and renders the accumulated text as Markdown — so headings, lists, and code blocks appear as the tokens arrive.',
    render: 'timeline',
    updates: [
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: "Here's what's happening:\n\n" } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '## Root cause\n\nThe `data` array is empty when ' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '`render()` runs. Fix it by awaiting the fetch:\n\n```ts\nawait load();\nthis.render();\n```' } },
    ],
  },
  {
    id: 'agent-thought',
    title: 'Thinking',
    subtitle: 'session/update · agent_thought_chunk',
    blurb:
      'Reasoning models stream their thinking separately from the answer. The UI renders it as a muted, set-apart block so it reads as the agent working, not its final reply.',
    render: 'timeline',
    updates: [
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Let me check how the data is loaded before it renders. ' } },
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'If the fetch is async and unawaited, the first paint sees an empty array.' } },
    ],
  },
  {
    id: 'tool-call',
    title: 'Tool call',
    subtitle: 'session/update · tool_call → tool_call_update',
    blurb:
      'When the agent reads or edits a file it announces a tool call (status pending), then updates the same toolCallId as it progresses. The UI tracks it by id and updates the card in place — here arriving at a completed edit with a diff.',
    render: 'tool',
    updates: [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool_42',
        title: 'Edit chart.ts',
        kind: 'edit',
        status: 'pending',
        rawInput: { path: 'src/chart.ts' },
      } as unknown as SessionUpdate,
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool_42',
        status: 'completed',
        locations: [{ path: 'src/chart.ts', line: 12 }],
        content: [
          {
            type: 'diff',
            path: 'src/chart.ts',
            oldText: 'render() {\n  draw(this.data);\n}',
            newText: 'async render() {\n  await this.load();\n  draw(this.data);\n}',
          },
        ],
      } as unknown as SessionUpdate,
    ],
  },
  {
    id: 'subagent',
    title: 'Sub-agent',
    subtitle: 'session/update · tool_call (Task)',
    blurb:
      "The agent can delegate a scoped task to a sub-agent via its Task tool. It arrives as an ordinary tool_call (Claude tags it _meta.claudeCode.toolName 'Agent'); the UI recognizes it and renders a distinct sub-agent card — the delegated type as a badge, the task prompt, the sub-agent's own tool calls (each tagged _meta.claudeCode.parentToolUseId, so they nest under the Task instead of leaking to the top level), and the report it returns on completion.",
    render: 'tool',
    updates: [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool_sub_1',
        title: 'Task',
        kind: 'think',
        status: 'pending',
        rawInput: {},
        _meta: { claudeCode: { toolName: 'Agent' } },
      } as unknown as SessionUpdate,
      // Tool calls the sub-agent makes carry parentToolUseId pointing at the Task
      // above, so the fold nests them inside its card rather than at the top level.
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool_sub_read',
        title: 'src/chart.ts',
        kind: 'read',
        status: 'completed',
        rawInput: { path: 'src/chart.ts' },
        _meta: { claudeCode: { toolName: 'Read', parentToolUseId: 'tool_sub_1' } },
      } as unknown as SessionUpdate,
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool_sub_grep',
        title: 'grep "render"',
        kind: 'search',
        status: 'completed',
        rawInput: { pattern: 'render', path: 'src' },
        _meta: { claudeCode: { toolName: 'Grep', parentToolUseId: 'tool_sub_1' } },
      } as unknown as SessionUpdate,
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool_sub_1',
        status: 'completed',
        rawInput: {
          subagent_type: 'code-reviewer',
          description: 'Review the diff',
          prompt: 'Review the current diff for correctness bugs and report findings.',
        },
        rawOutput: [
          {
            type: 'text',
            text: '**No blocking issues.** The `async render()` change correctly awaits `this.load()` before drawing. One nit: consider a loading state so the chart area is not blank during the fetch.',
          },
        ],
        _meta: { claudeCode: { toolName: 'Agent' } },
      } as unknown as SessionUpdate,
    ],
  },
  {
    id: 'fs-read',
    title: 'Agent reads a file',
    subtitle: 'fs/read_text_file',
    blurb:
      'ACP runs both ways: the agent calls back into this UI as a server. When it needs a file it asks us to read it — we resolve the path inside the session cwd (an attempt to escape is rejected) and return the text. There is no chat bubble for this; the proof is that the edit above could happen at all.',
    render: 'clientcall',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 5,
        method: 'fs/read_text_file',
        params: { sessionId: SESSION_ID, path: 'src/chart.ts', line: 1, limit: 40 },
      },
      response: {
        jsonrpc: '2.0',
        id: 5,
        result: { content: 'render() {\n  draw(this.data);\n}\n' },
      },
    },
    handledBy: [
      'Advertised by clientCapabilities.fs.readTextFile in the handshake.',
      'Path resolved against the session working directory; a path escaping the cwd is rejected.',
      'Optional line/limit return just a window of the file, so large files stay cheap.',
    ],
  },
  {
    id: 'fs-write',
    title: 'Agent writes a file',
    subtitle: 'fs/write_text_file',
    blurb:
      'The other half of the filesystem capability. When the agent applies an edit it asks us to write the file — we create any missing parent directories, write inside the cwd, and acknowledge with a null result. This is how a tool_call edit actually lands on disk.',
    render: 'clientcall',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 6,
        method: 'fs/write_text_file',
        params: {
          sessionId: SESSION_ID,
          path: 'src/chart.ts',
          content: 'async render() {\n  await this.load();\n  draw(this.data);\n}\n',
        },
      },
      response: { jsonrpc: '2.0', id: 6, result: null },
    },
    handledBy: [
      'Advertised by clientCapabilities.fs.writeTextFile in the handshake.',
      'Parent directories are created as needed; the write is confined to the cwd.',
      'A null result is the ACP acknowledgement — there is nothing to render.',
    ],
  },
  {
    id: 'terminal',
    title: 'Agent runs a command',
    subtitle: 'terminal/create → output → wait_for_exit',
    blurb:
      'Because we advertised terminal:true, the agent can spawn a real subprocess in the session cwd. We stream its output back as it runs and report the exit status. The tool card embeds the live terminal — its content block is just a terminalId pointing at this stream.',
    render: 'terminal',
    updates: [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool_58',
        title: 'Run npm test',
        kind: 'execute',
        status: 'in_progress',
        content: [{ type: 'terminal', terminalId: 'term_1' }],
      } as unknown as SessionUpdate,
    ],
    handledBy: [
      'terminal/create spawns the process in the session cwd (env vars merged in).',
      'terminal/output is streamed to the card as it arrives, capped at a byte limit.',
      'terminal/wait_for_exit resolves with the exit code; terminal/release tears it down.',
    ],
  },
  {
    id: 'commands',
    title: 'Slash commands',
    subtitle: 'session/update · available_commands_update',
    blurb:
      'The agent tells the UI which slash commands it supports for this session. We fold them into the composer’s "/" menu — typing "/" surfaces exactly this list, so the available commands always match what the agent will accept.',
    render: 'commands',
    updates: [
      {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'init', description: 'Summarize the project into AGENTS.md' },
          { name: 'review', description: 'Review the current diff for bugs' },
          { name: 'compact', description: 'Compact the conversation to free context' },
        ],
      } as SessionUpdate,
    ],
  },
  {
    id: 'content-blocks',
    title: 'Rich content blocks',
    subtitle: 'session/update · agent_message_chunk',
    blurb:
      'A message chunk isn’t only text. The same content union carries images, audio, @-mention resource links, and embedded file resources. Text coalesces into the bubble; every other block becomes its own timeline item in stream order, so nothing is dropped — even a type this UI doesn’t recognize falls back to its raw JSON.',
    render: 'timeline',
    updates: [
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The fix lives in ' } },
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'resource_link', uri: 'file:///Users/you/code/kairos/src/chart.ts', name: 'src/chart.ts' },
      } as SessionUpdate,
      {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'resource',
          resource: { uri: 'file:///Users/you/code/kairos/src/chart.ts', text: 'async render() {\n  await this.load();\n}', mimeType: 'text/x-typescript' },
        },
      } as SessionUpdate,
    ],
  },
  {
    id: 'plan',
    title: 'Plan',
    subtitle: 'session/update · plan',
    blurb:
      'The agent can publish a checklist of steps and revise it as work proceeds. The UI pins it as a sticky, collapsible header so you always see what is done, in progress, and pending.',
    render: 'timeline',
    updates: [
      {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Reproduce the blank chart', status: 'completed' },
          { content: 'Trace the data-loading path', status: 'in_progress' },
          { content: 'Await the fetch before render', status: 'pending' },
          { content: 'Add a regression test', status: 'pending' },
        ],
      },
    ],
  },
  {
    id: 'usage',
    title: 'Context usage',
    subtitle: 'session/update · usage_update',
    blurb:
      'After each turn the agent reports how much of the context window is in use, plus the turn token split. The UI folds these into a meter that shifts amber then red as the window fills; hover it for cache read/write/fresh input details.',
    render: 'timeline',
    updates: [
      { sessionUpdate: 'usage_update', used: 148000, size: 200000, cost: { amount: 0.42, currency: 'USD' } } as SessionUpdate,
    ],
    turnUsage: [
      { inputTokens: 6000, outputTokens: 1500, cachedReadTokens: 60000, cachedWriteTokens: 12000 },
      { inputTokens: 4000, outputTokens: 900, cachedReadTokens: 78000, cachedWriteTokens: 0 },
    ],
  },
  {
    id: 'permission',
    title: 'Permission request',
    subtitle: 'session/request_permission',
    blurb:
      'Before a risky action the agent asks for approval. This is a request (it has an id and expects a reply), not a notification — the UI surfaces approve/reject buttons on the tool card and sends the chosen option back.',
    render: 'permission',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 7,
        method: 'session/request_permission',
        params: {
          sessionId: SESSION_ID,
          toolCall: { toolCallId: 'tool_57', title: 'Run npm test', kind: 'execute' },
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
          ],
        },
      },
      response: { jsonrpc: '2.0', id: 7, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } },
    },
    permission: {
      requestId: 'req_perm_1',
      sessionId: SESSION_ID,
      toolCall: { toolCallId: 'tool_57', title: 'Run npm test', kind: 'execute' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  },
  {
    id: 'elicitation',
    title: 'Structured question',
    subtitle: 'elicitation/create',
    blurb:
      'The agent can ask a structured question mid-turn using a small JSON-Schema form. The UI renders real inputs from the schema and returns the answer — this is how AskUserQuestion-style prompts work over ACP.',
    render: 'elicitation',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 9,
        method: 'elicitation/create',
        params: {
          sessionId: SESSION_ID,
          mode: 'form',
          message: 'Which environment should I deploy to?',
          requestedSchema: {
            type: 'object',
            properties: {
              environment: {
                type: 'string',
                title: 'Environment',
                oneOf: [
                  { const: 'staging', title: 'Staging' },
                  { const: 'production', title: 'Production' },
                ],
              },
            },
            required: ['environment'],
          },
        },
      },
      response: { jsonrpc: '2.0', id: 9, result: { action: 'accept', content: { environment: 'staging' } } },
    },
    elicitation: {
      requestId: 'req_elicit_1',
      sessionId: SESSION_ID,
      message: 'Which environment should I deploy to?',
      requestedSchema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            title: 'Environment',
            oneOf: [
              { const: 'staging', title: 'Staging' },
              { const: 'production', title: 'Production' },
            ],
          },
        },
        required: ['environment'],
      },
    },
  },
  {
    id: 'session-load',
    title: 'Resume a session',
    subtitle: 'session/load',
    blurb:
      'Reopening a past conversation sends session/load instead of session/new — the agent advertised loadSession:true in the handshake. It replays the whole history back as session/update notifications, so the timeline rebuilds itself through the exact same fold the live stream uses.',
    render: 'clientcall',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 11,
        method: 'session/load',
        params: { sessionId: SESSION_ID, cwd: '/Users/you/code/kairos', mcpServers: [] },
      },
      response: { jsonrpc: '2.0', id: 11, result: null },
    },
    handledBy: [
      'Gated on agentCapabilities.loadSession from the handshake.',
      'History replays as ordinary session/update frames before the response resolves.',
      'Each replayed frame folds through the same Conversation, so resumed and live timelines are identical.',
    ],
  },
  {
    id: 'session-cancel',
    title: 'Interrupt a turn',
    subtitle: 'session/cancel',
    blurb:
      'Hitting stop mid-turn sends a session/cancel notification (no id, no reply). The backend also resolves any pending permission or elicitation request for that session as cancelled, so nothing is left hanging. The turn then ends with a cancelled stop reason.',
    render: 'clientcall',
    envelope: {
      request: {
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: SESSION_ID },
      },
    },
    handledBy: [
      'A notification, not a request — there is no response, only the running turn winding down.',
      'Pending permission / elicitation prompts for the session resolve as cancelled.',
      'The in-flight session/prompt returns with stopReason "cancelled".',
    ],
  },
];

// The JSON the left column of a card should pretty-print. It is ALWAYS derived
// from the same fields the right column renders, so the two can never disagree:
//   - request/response entries → the JSON-RPC envelope
//   - notification entries     → the exact session/update frames that get folded
//     (a single frame is unwrapped from its array; multiple frames stay an array
//     so the card shows the full sequence the agent actually streams)
// Returns undefined only for entries with neither (none today), which the card
// renders as an empty payload rather than crashing.
export function jsonSourceFor(entry: ShowcaseEntry): unknown {
  if (entry.envelope) return entry.envelope;
  const updates = entry.updates ?? [];
  if (updates.length === 1) return updates[0];
  if (updates.length > 1) return updates;
  return undefined;
}
