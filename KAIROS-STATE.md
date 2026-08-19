# Kairos — Project State Reference

> Last updated: 2026-08-08

## What is Kairos?

A universal, LLM-agnostic AI orchestrator desktop app. Runs multi-agent workflows with DAG-based orchestration, works with any CLI-based LLM tool, ships as a desktop app (Tauri 2) for macOS, Linux, and Windows.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Lit 3 web components, Vite |
| Backend | Express + WebSocket (standalone) |
| Desktop | Tauri 2 (sidecar model) |
| Language | TypeScript, ES modules |
| Build | tsup (libs), Vite (UI) |
| Test | Vitest |
| Node | >= 20.0.0 |

## Package Architecture

```
packages/
├── protocol/      — ACP types + JSON-RPC 2.0 codec (zero deps)
├── shared/        — 14 themes, design tokens, constants
├── providers/     — LLM provider abstraction (Ollama, Anthropic, OpenAI)
├── orchestrator/  — DAG engine, pipeline state machine, plan parser
├── agents/        — Agent process lifecycle, CLI + Ollama HTTP adapters, pool (max 8)
├── server/        — Express backend + WebSocket hub (standalone, no Tauri dep)
├── ui/            — Lit 3 web components (63+ components, 43+ services)
└── desktop/       — Tauri 2 shell (paper-thin sidecar wrapper)
```

## Supported Providers

| Provider | Models | Pricing | Context |
|----------|--------|---------|---------|
| Anthropic | Claude Opus 4, Sonnet 4, Haiku 4 | $0.8-$75/M tokens | 200K |
| Ollama | Any local model | Free, private | Varies |
| OpenAI | GPT-4o, o-series | Varies | Varies |

**Smart Router** selects models by: privacy > budget > user preference > complexity.

## Built-in Agents (9)

Claude, Codex, Gemini, GitHub Copilot, Goose, OpenCode, Mistral Vibe, Kiro, Custom (BYOA)

**Auth modes**: API key (direct), auth proxy (organizational), or local (no auth needed for Ollama).

## Core Features

### 1. Multi-Agent Orchestration
- DAG-based pipeline with parallel/sequential execution
- Phase types: `agent`, `gate`, `fanout`
- Gate types: `human_approval`, `budget`, `quality`, `programmatic`
- 21 event types for pipeline lifecycle

### 2. Agent Client Protocol (ACP)
- JSON-RPC 2.0 over newline-delimited stdio
- Methods: `initialize`, `session/new`, `session/prompt`, `session/update`, `session/cancel`
- Permission system: `permission/request`, `permission/response`
- Update types: text, thinking, tool_use, tool_result, status, error, cost

### 3. Real-time Streaming UI
- Live reasoning display, tool call cards, file edit diffs
- Terminal integration (xterm.js)
- Plan/task progress tracker
- Protocol frame inspector ("Behind the Scenes")

### 4. Session Management
- Persistence, multi-session support, resume
- Search across sessions
- Export (HTML/Markdown)
- Edit/Fork from any past prompt (rewind)

### 5. Safety & Isolation
- Working directory sandbox (FsScope)
- Git worktree isolation
- Permission prompts with allow/deny/allow_always
- Diff review before accepting changes

### 6. VS Code Integration
- Workspace discovery (filesystem + git-based)
- Pin/rename/hide workspaces
- Launch VS Code with kairos tools on PATH

### 7. Customization
- Global/project rules and roles/personas
- Reusable saved prompts
- MCP server configuration
- Lifecycle hooks
- 14 built-in themes

### 8. Desktop App
- Cross-platform: macOS (.dmg), Linux (.deb), Windows (.msi)
- Auto-updates via Tauri updater
- Code signing support (configurable service)

### 9. Plugins & Skills
- Searchable marketplace
- Install/update/uninstall
- Favorite pinning

### 10. Configuration Hub
- Searchable config keys with layered resolution
- Feature flags
- Vault (encrypted credentials)
- Diagnostics

## UI Layout

- **Left sidebar**: Session list (active/pinned/recent)
- **Main column**: Live session view or tab content
- **Right rail**: Tabbed panels (Files, Prompts, Plan, Review, Summary, Frames)

**Navigation tabs** (6): Agents, Plugins & Skills, Customize, History, VSCode, Settings

**Composer**: Enter to send, Shift+Enter newline, queue mid-turn, @file mentions, /slash commands, drag-drop attachments

## WebSocket Protocol

Client → Server: `agent:spawn`, `agent:kill`, `prompt`, `pipeline:start`, `pipeline:cancel`, `gate:decide`

Server → Client: `init`, `agent:spawned`, `agent:output`, `agent:status`, `agent:exit`, `pipeline:state`, `pipeline:event`, `pipeline:gate`, `error`

## Running

```bash
npm install
npm run build          # Build all packages
npm start              # Server + UI at http://localhost:3333

npm run dev            # Dev mode: server (tsx watch) + UI (vite :5173)
npm run desktop:dev    # Tauri dev mode
npm run desktop:build  # Produce .dmg / .deb / .msi
```

## Test Suite

- **Framework**: Vitest
- **Test files**: 73 across `packages/*/src/**/__tests__/`
- **Run**: `npx vitest run` (from project root)
- **Status (2026-08-19)**: 447 tests pass, 448 total. The single failing test
  (`windows-ci-import-libs`) plus ~19 failing *files* are CI/release scripts
  (codesign, windows, release-notes) absent from a local checkout — not app logic.
- **File pipeline**: `packages/files` now has unit tests (`process.test.ts`) and a
  server endpoint (`POST /api/files/extract`, tested in `packages/server`). The UI
  half ships as `<kairos-file-drop>` (drag-drop upload → extract → table/snippet
  preview) in the **Files** tab, backed by `services/file-extract.ts`; both are
  unit-tested (`file-extract.test.ts`, `file-drop-style.test.ts`).

## Auth Architecture (Post-Decoupling)

- No MathWorks/gateway dependency
- Users configure: API key per provider OR an auth proxy URL
- Credentials stored in OS keychain
- `kairos launch` injects credentials into agent subprocess environment
- Browser never holds API keys directly

## Design Decisions

1. **Web-first, desktop via sidecar**: Express server is standalone; Tauri spawns it + points webview
2. **LLM-agnostic**: AgentPool spawns any CLI tool; OllamaHttpAgent for local inference
3. **DAG orchestration**: Markdown plans → PipelineDefinition graphs → parallel execution
4. **Event-sourced state**: Pipeline transitions → events → WebSocket broadcast → UI updates
5. **Provider routing**: SmartRouter selects by privacy → budget → preference → complexity
