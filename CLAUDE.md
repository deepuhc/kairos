# Kairos v2 — Development Guide

## What is this?

Kairos is a universal, LLM-agnostic AI orchestrator. It runs multi-agent workflows with DAG-based orchestration, works with any CLI-based LLM tool (Ollama, Claude, Goose, etc.), and ships as a desktop app (Tauri 2) for macOS, Linux, and Windows.

## Architecture

```
packages/
├── protocol/      — ACP types + JSON-RPC 2.0 codec (zero deps)
├── shared/        — Themes (14), design tokens, constants
├── providers/     — LLM provider abstraction (Ollama, Anthropic, OpenAI)
├── orchestrator/  — DAG engine, pipeline state machine, plan parser, worktree manager
├── agents/        — Agent process lifecycle, CLI adapter, Ollama HTTP adapter, pool
├── server/        — Express backend + WebSocket hub (standalone, no Tauri dep)
├── ui/            — Lit 3 web components (the entire frontend)
├── desktop/       — Tauri 2 shell (sidecar wrapper, paper-thin)
└── cli/           — CLI entry point
```

## Running

```bash
npm install
npm run build                    # Build all packages
npm start                        # Server + UI at http://localhost:3333

# Development (hot-reload)
npm run dev                      # Concurrently: server (tsx watch) + UI (vite :5173)

# Desktop
npm run desktop:dev              # Tauri dev mode
npm run desktop:build            # Produce .dmg / .deb / .msi
```

## Key Design Decisions

1. **Web-first, desktop via sidecar**: The Express server is fully standalone. Tauri just spawns it and points a webview at it.
2. **LLM-agnostic**: `AgentPool` spawns any CLI tool. `OllamaHttpAgent` talks directly to Ollama's REST API for zero-overhead local inference.
3. **DAG orchestration**: Markdown plans are parsed into `PipelineDefinition` graphs. The engine executes ready phases in parallel, pauses at gates, supports loops.
4. **Event-sourced state**: Every pipeline transition emits events → broadcast via WebSocket → UI updates in real-time.
5. **Provider routing**: `SmartRouter` selects models by privacy → budget → preference → complexity.

## WebSocket Protocol

Client → Server:
- `agent:spawn`, `agent:kill`, `prompt`
- `pipeline:start`, `pipeline:cancel`, `gate:decide`

Server → Client:
- `init`, `agent:spawned`, `agent:output`, `agent:status`, `agent:exit`
- `pipeline:state`, `pipeline:event`, `pipeline:gate`, `error`

## Code Conventions

- TypeScript, ES modules (`"type": "module"`)
- `tsup` for library packages, `vite` for UI
- Lit 3 web components with `@state()` decorators
- Event-driven: engines emit typed events, hub broadcasts to WebSocket clients
