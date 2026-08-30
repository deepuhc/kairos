# Kairos — The Decisive Moment

> Universal Agent Orchestrator — The right agent, the right tool, the right time.

Kairos orchestrates multiple AI agents across any LLM (local or cloud) for any domain — software development, accounting, education, research, and more.

## Quick Start

### Prerequisites

- **Node.js 20+** — `node --version`
- **npm 9+** — `npm --version`
- **Ollama** (optional, for free local AI) — https://ollama.ai

### Install and run

```bash
git clone https://github.com/deepuhc/kairos.git
cd kairos
npm install
npm run build
npm start           # → http://localhost:3333
```

`npm start` runs the standalone Express server, which also serves the built UI.
Override the port with `PORT=4000 npm start`.

Or, in one command — builds, starts the server, and opens your browser:

```bash
npm run kairos
```

### Development (hot reload)

```bash
npm run dev         # server (tsx watch) + UI (vite on :5173)
```

### Desktop app

Requires the [Rust toolchain](https://rustup.rs) in addition to Node:

```bash
npm run desktop:dev      # Tauri dev mode
npm run desktop:build    # produce .dmg / .deb / .msi
```

`desktop:build` bundles the server into a single self-contained JS file and ships
it (plus the built UI) as Tauri resources. At launch the app spawns that server on
a free port and points its window at it — so **Node 20+ must be installed on the
target machine** (the JS server runs on the system's Node; a Node runtime is not
embedded). If Node is missing, the app shows a startup-error page instead of
crashing.

### Tests and typecheck

```bash
npm test                              # watch mode
npx vitest run                        # single run, all packages
npx vitest run packages/providers     # one package
npm run test:ci                       # with coverage
npm run typecheck                     # tsc -b across all packages
```

## Setting Up LLM Providers

### Option 1: Ollama (Free, Local, Private)

Best for: getting started, sensitive data, no API costs.

```bash
# Install Ollama
brew install ollama      # macOS
# or: curl -fsSL https://ollama.ai/install.sh | sh   # Linux

# Start Ollama server
ollama serve

# Pull a model (in another terminal)
ollama pull llama3.2          # 3B params, fast, good for simple tasks
ollama pull llama3.1:8b       # 8B params, better quality
ollama pull deepseek-coder-v2 # great for code tasks

# Verify it's running
curl http://localhost:11434/api/tags
```

Kairos auto-detects Ollama at `localhost:11434`.

#### Remote / homelab Ollama

To point Kairos at an Ollama running on another machine, either set `OLLAMA_HOST`:

```bash
export OLLAMA_HOST="http://100.80.191.11:11434"   # full URL or bare host:port
```

…or create `~/.kairos/providers.json` (override the directory with `KAIROS_CONFIG_DIR`):

```json
{
  "ollama": { "baseUrl": "http://100.80.191.11:11434" }
}
```

Additional endpoints — a second Ollama, an OpenAI-compatible server (vLLM, LM Studio,
LiteLLM), or Open WebUI — go under `custom`:

```json
{
  "custom": [
    {
      "name": "homelab",
      "baseUrl": "http://100.80.191.11:11434",
      "type": "ollama",
      "isLocal": true,
      "defaultModel": "qwen2.5:14b"
    },
    {
      "name": "vllm",
      "baseUrl": "http://100.80.191.11:8000/v1",
      "type": "openai-compatible",
      "isLocal": true,
      "auth": { "type": "bearer", "token": "..." }
    }
  ]
}
```

`type` must be `ollama`, `openai-compatible`, or `open-webui`. `isLocal: true` marks the
endpoint as private so privacy-sensitive routing prefers it and never falls back to a cloud
provider. The file is optional — if it is missing or malformed the server logs a warning and
falls back to the defaults rather than failing to start.

Verify connectivity:

```bash
curl -s http://localhost:3333/api/providers/diagnostics
```

This reports each provider's resolved endpoint, whether it is reachable, and which of its
models are vision-capable.

For a full walkthrough — Tailscale/LAN setup, all config fields, and enabling
local image description — see [docs/homelab.md](docs/homelab.md).

### Option 2: Anthropic (Claude)

Best for: complex reasoning, high-quality output.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or add to `~/.zshrc` / `~/.bashrc` for persistence.

### Option 3: OpenAI (GPT)

Best for: GPT-4o, o-series models.

```bash
export OPENAI_API_KEY="sk-..."
```

### Multiple Providers (Smart Routing)

Kairos uses all available providers simultaneously:
- Routes simple tasks to cheap/local models
- Routes complex reasoning to powerful cloud models
- Falls back to local when budget runs low
- Routes restricted data (SSN, EIN) to local only — never cloud

## Project Structure

```
kairos/
├── packages/
│   ├── protocol/      ACP types + JSON-RPC 2.0 codec (zero deps)
│   ├── shared/        Themes, design tokens, constants
│   ├── providers/     LLM adapters (Ollama, OpenAI, Anthropic) + SmartRouter
│   ├── files/         File type detection + extraction (standalone)
│   ├── knowledge/     Knowledge/context helpers
│   ├── personas/      Agent role/persona definitions
│   ├── orchestrator/  DAG engine, pipeline state machine, plan parser
│   ├── workflows/     Reusable workflow definitions
│   ├── agents/        Agent process lifecycle, CLI + Ollama adapters, pool
│   ├── server/        Express backend + WebSocket hub (standalone)
│   ├── ui/            Lit 3 web components (the frontend)
│   └── desktop/       Tauri 2 shell (sidecar wrapper)
```

## Writing a Plan

Plans are **Markdown**. Each task is a checklist item `id: description`, with
optional inline annotations for dependencies, role, and gates. `parsePlan()`
(in `@kairos/orchestrator`) turns them into a `PipelineDefinition` DAG the engine
executes — ready phases run in parallel, and gates pause for human approval.

```markdown
# Research and Summarize

- [ ] research: Research the topic thoroughly [role: researcher]
- [ ] review: Approve the research before writing [type: gate]
- [ ] write: Write a clear summary from the findings [role: writer] [depends: research, review]
```

Supported annotations:

| Annotation | Meaning |
|------------|---------|
| `[depends: a, b]` | This phase waits for phases `a` and `b` |
| `[role: X]` | Run the phase under role/persona `X` |
| `[type: gate]` | Pause for human approval (uses the description as the prompt) |
| `[type: fanout]` | Fan the phase out across inputs |

## Privacy-Aware Routing

`SmartRouter` selects a model per request, preferring local models for
privacy-sensitive work and falling back to cloud providers only when allowed.
Mark a homelab endpoint `isLocal: true` in `~/.kairos/providers.json` (see
[Remote / homelab Ollama](#remote--homelab-ollama)) so it is treated as private.

File handling follows the same principle: **text extraction runs locally** on
the server. **Image description uses a vision model**, which may be a cloud
provider if no local vision model is configured — the analyzing provider/model
is surfaced with each result rather than hidden. Pull a local vision model
(`ollama pull moondream` or `ollama pull llava`) to keep images on-device.

## Development

```bash
# Type check the whole workspace
npm run typecheck

# Clean builds + node_modules
npm run clean

# Watch a single package (rebuilds on change)
npm run dev -w @kairos/server

# Run one package's tests
npx vitest run packages/providers

# Watch mode
npx vitest
```

## Architecture Decisions

- **TypeScript monorepo** with npm workspaces
- **ESM-first** (type: module everywhere)
- **tsup** for library builds, **Vite** for the UI
- **Vitest** for testing (Node environment)
- **Lit 3** web components for the frontend
- **Event-sourced state** for pipeline execution (supports replay/debug)
- **Web-first, desktop via sidecar**: the Express server is standalone; Tauri
  spawns it and points a webview at it

## License

MIT
