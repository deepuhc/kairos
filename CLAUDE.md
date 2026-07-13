# Kairos — Development Handoff

## What is this?

Kairos is a universal, LLM-agnostic orchestrator with a browser-based dashboard. It automatically decides orchestration patterns (parallel, sequential, hierarchical, handoff, loop) and works with ANY CLI-based LLM tool.

## Architecture

```
packages/
├── core/        — Coordinator (NLP-based pattern selection, subtask extraction)
├── runtime/     — LLM runtime abstraction
│   └── adapters/
│       ├── cli.ts         — Universal CLI adapter (works with any LLM tool)
│       └── claude-code.ts — Claude-specific adapter (legacy, being replaced by cli.ts)
├── web/         — Dashboard server + frontend (WebSocket, stream-json parsing)
├── security/    — Input classification, redaction, audit
├── providers/   — LLM provider routing (Anthropic, Ollama)
├── cli/         — CLI entry point
└── test-utils/  — Shared test helpers
```

## Key Design Decisions

1. **LLM-agnostic**: The `CLIRuntime` adapter works with any tool that accepts prompts. Configure via `~/.kairos/config.json`.
2. **Interactive mode (no -p)**: Agents run as persistent processes with stdin open. This enables real-time permission handling, multi-turn conversation, and follow-ups without spawning new processes.
3. **Stream-json parsing**: For Claude, we parse `--output-format stream-json --verbose` events (thinking, text, tool_use, tool_result, result) and forward them to the browser via WebSocket.
4. **Permission handling**: Permission denials are shown as informational warnings. Users can "Retry with full access" which adds `--dangerously-skip-permissions`.
5. **Auto-detection**: `detectTools()` scans for installed LLM tools (claude, ollama, aichat, etc.) and creates a runtime automatically.

## Configuration

User config lives at `~/.kairos/config.json`:
```json
{
  "command": "devai",
  "args": ["launch", "claude", "--output-format", "stream-json", "--verbose"],
  "promptMode": "stdin",
  "systemPrompt": "You are an agent inside Kairos orchestrator..."
}
```

For other tools: `{ "command": "ollama", "args": ["run", "llama3", "{prompt}"] }`

## Running

```bash
npm install
npm run build
npm start          # Starts dashboard at http://localhost:3000
```

## Testing

```bash
npm test           # All tests
npm run test:ci    # With coverage
```

## Current State & Next Steps

### Working
- Dashboard with real-time streaming conversation (thinking, tool calls, results)
- Coordinator pattern selection (parallel, sequential, hierarchical, loop, handoff)
- Permission denial detection and "Retry with full access" UX
- Multi-agent sidebar with alert badges
- Shell command execution (`!command`) and Claude commands (`/command`)
- Follow-up messages in same agent session via stdin

### Needs Work
- **True interactive permissions**: Claude in `-p` mode can't pause for permission grants. The stdin-based interactive mode (without `-p`) is configured but needs end-to-end testing for permission prompts that actually pause and wait.
- **Multi-turn without `-p`**: The process should stay running after the first result, accepting new prompts on stdin. Currently the process exits after one turn.
- **Agent lifecycle**: Long-running agents, graceful shutdown, session resume.
- **Non-Claude streaming**: Generic progress detection for tools that don't support stream-json.
- **Tests**: Integration tests for the streaming pipeline and WebSocket protocol.

## Code Conventions

- TypeScript, ES modules (`"type": "module"`)
- `tsup` for builds, `vitest` for tests
- Event-driven architecture: runtime emits typed events, server forwards via WebSocket
- Debug logging: set `KAIROS_DEBUG=1` for verbose runtime logs
