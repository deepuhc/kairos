# Kairos — The Decisive Moment

> Universal Agent Orchestrator — The right agent, the right tool, the right time.

Kairos orchestrates multiple AI agents across any LLM (local or cloud) for any domain — software development, accounting, education, research, and more.

## Quick Start

### Prerequisites

- **Node.js 20+** — `node --version`
- **npm 9+** — `npm --version`
- **Ollama** (optional, for free local AI) — https://ollama.ai

### Install

```bash
cd ~/projects/kairos
npm install
```

### Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:ci

# Run a specific package's tests
npx vitest run packages/security/src
npx vitest run packages/core/src
npx vitest run packages/providers/src
```

### Build

```bash
npm run build
```

### Try the CLI

```bash
# Check what's available
npx kairos status

# Dry-run a recipe (shows phases without executing)
npx kairos run recipes/code-review.yaml --dry-run

# Start interactive session
npx kairos start

# Start with local model only (free, private)
npx kairos start --local

# Start with specific provider
npx kairos start --provider ollama/llama3.2
npx kairos start --provider anthropic/claude-sonnet-4-6

# Start with budget limit
npx kairos start --budget 5.00

# Start with security profile
npx kairos start --profile tax-firm
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
│   ├── security/     Data classification, PII redaction, audit logging
│   ├── core/         Orchestration engine, scheduler, patterns, gates
│   ├── providers/    LLM adapters (Ollama, OpenAI, Anthropic, router)
│   ├── runtime/      Agent process management, isolation
│   ├── cli/          CLI commands + TUI (terminal UI)
│   └── test-utils/   Mock providers, test factories
├── recipes/          YAML workflow definitions
├── PLAN.md           Full strategic plan & architecture
├── DESIGN.md         Design philosophy & visual identity
└── TESTING.md        Test strategy for dual audiences
```

## Writing a Recipe

Recipes are YAML files that define multi-agent workflows:

```yaml
name: "My Workflow"
description: "What it does"
version: 1

providers:
  default: ollama/llama3.2     # free local model
  complex: anthropic/claude-sonnet-4-6  # for hard tasks

budget:
  max_cost: 2.00               # stop if cost exceeds this

agents:
  - id: researcher
    role: "Research the topic thoroughly"
    model: ${providers.default}

  - id: writer
    role: "Write a clear summary from research findings"
    model: ${providers.default}

pipeline:
  - phase: research
    pattern: parallel           # run all at once
    agents: [researcher]

  - phase: write
    pattern: sequential         # one after another
    agents: [writer]
    gate:
      type: human_approval
      message: "Ready to write the summary. Proceed?"
```

### Available Patterns

| Pattern | Description | When to Use |
|---------|-------------|-------------|
| `sequential` | A → B → C | Ordered steps with dependencies |
| `parallel` | All at once, collect results | Independent sub-tasks |
| `hierarchical` | Manager delegates to workers | Complex decomposition |
| `handoff` | Router picks one specialist | Multi-domain routing |
| `loop` | Repeat until quality threshold | Iterative refinement |

## Security Profiles

```bash
kairos start --profile personal    # relaxed, cloud allowed
kairos start --profile tax-firm    # strict, local-only, 7yr audit
kairos start --profile healthcare  # HIPAA aligned
kairos start --profile education   # FERPA aligned
kairos start --profile enterprise  # SOC 2 aligned
```

## Development

```bash
# Type check
npm run typecheck

# Clean builds
npm run clean

# Watch mode (rebuilds on file change)
cd packages/core && npx tsup --watch

# Run single test file
npx vitest run packages/security/src/classifier.test.ts

# Run tests in watch mode
npx vitest --watch
```

## Architecture Decisions

- **TypeScript monorepo** with npm workspaces
- **ESM-first** (type: module everywhere)
- **tsup** for fast builds
- **Vitest** for testing
- **Ink** (React for CLI) for TUI components
- **Event-sourced state** for pipeline execution (supports replay/debug)
- **MCP protocol** for tool integration
- **Security-first**: PII detection runs before every model call

## License

MIT
