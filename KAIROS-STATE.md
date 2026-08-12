# Kairos — Project State Reference

> Last updated: 2026-08-12

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
- "Behind the Scenes" static reference pane (pipeline diagram, auth status, curated protocol frames)

### 4. Session Management
- Persistence, multi-session support, resume
- Search across sessions
- Export (HTML/Markdown)
- Edit/Fork from any past prompt (rewind)

### 5. Safety & Isolation
- Working directory sandbox (FsScope)
- Git worktree isolation
- Tiered permission model (Plan / Ask / Auto / Full-auto) with always-on danger floor
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

### 11. Team-Role Personas & Autonomous Orchestrator
- 7 built-in team-role personas: Product Marketing, UX Designer, Software Architect, Project Manager, QA Engineer, Documentation Engineer, Program Manager
- Server-side DAG coordinator (`packages/server/src/orchestrator/`) drives a project through the full lifecycle autonomously
- Each persona writes a typed artifact to disk; a gate validates the artifact before the DAG advances
- Program Manager runs as a supervisor throughout, maintaining an append-only `PROGRESS.md` progress ledger (dual-write with machine state in `.kairos/orchestrator-state.json`)
- `AgentWatchdog` enforces heartbeat (3 min), start-to-close (30 min), and schedule-to-close (2 h) timeouts + soft-stall loop detection
- Provider-agnostic: SmartRouter assigns model tiers (frontier / mid / cheap) per persona
- One project at a time; REST: `POST /api/orchestrator/start`, `GET /api/orchestrator/state`, `GET /api/orchestrator/roles`
- Progress streams as `orchestrator:*` events over the `/events` bus

### 12. Activity View (developer mode)
- Top-nav **Activity** tab, visible in Developer mode only
- Renders the orchestrator pipeline DAG with per-phase status (pending / ready / running / blocked / done) and liveness (ok / soft-stall / stalled / timeout)
- Shows last-activity relative time, attempt count, and blocked reason per phase
- Live updates via `orchestrator:update` events; `GET /api/orchestrator/state` for initial snapshot and reconnect fallback
- Backed by `kairos-activity` Lit component (`packages/ui/src/components/activity-view.ts`)

## UI Layout

- **Left sidebar**: Session list (active/pinned/recent)
- **Main column**: Live session view or tab content
- **Right rail**: Side panels (Plan, Review, Summary)

**Navigation tabs**: Agents, Files (global, session-bound), Prompts (global, session-bound), Plugins & Skills, Customize, History, VSCode, Settings
**Developer mode adds**: Plan, Review, Activity

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
- **Test files**: 60 in `packages/ui/src/__tests__/`
- **Run**: `npx vitest run` (from project root)
- **Known**: ~23 test files fail due to missing CI scripts (not present locally); 37 pass

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
