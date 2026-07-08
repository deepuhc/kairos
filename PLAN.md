# Kairos — The Decisive Moment

> *Universal Agent Orchestrator — The right agent, the right tool, the right time.*

## Executive Summary

**Kairos** (Greek: καιρός — *the decisive moment*) is a universal, LLM-agnostic orchestrator that works with any agentic CLI and any LLM (local or remote). It is the **Kubernetes of AI agents** — a control plane that coordinates, governs, and observes multi-agent workflows regardless of the underlying model, framework, or domain.

**For developers:** A CLI-first orchestrator that manages parallel agents, DAG pipelines, and cross-project intelligence with any model.

**For professionals (accountants, teachers, researchers):** A natural-language interface that automates complex multi-tool workflows without requiring any technical knowledge.

---

## Table of Contents

1. [Market Landscape](#1-market-landscape)
2. [Orchestration Patterns](#2-orchestration-patterns)
3. [Technical Architecture](#3-technical-architecture)
4. [Dual-Audience Design](#4-dual-audience-design)
5. [Domain Kits & Tool Integration](#5-domain-kits--tool-integration)
6. [Security & Legal Framework](#6-security--legal-framework)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Success Metrics](#8-success-metrics)

---

## 1. Market Landscape

### 1.1 Existing Products & Positioning

| Product | Type | LLM Support | Interface | Strengths | Weaknesses |
|---------|------|-------------|-----------|-----------|------------|
| **Claude Orchestrator** | Runtime control plane | Claude only | Web + CLI | Live terminal streaming, permission gates, cross-project intelligence, session durability | Claude-locked, no local LLM, no DAG editor |
| **LangGraph** | Code-first framework | Multi-model | Python/JS SDK + Studio | Explicit state graphs, checkpointing, LangSmith observability | No CLI orchestration, requires code for every flow |
| **CrewAI** | Role-based framework | Multi-model (LiteLLM) | Python SDK + CLI | Easy mental model, role-based crews | Poor production governance, expensive token usage |
| **AutoGen 0.4** | Actor-based framework | Multi-model | Python SDK + Studio | Event-driven, distributed runtime | Complex API, breaking rewrite alienated community |
| **OpenAI Agents SDK** | Lightweight handoffs | OpenAI only | Python SDK | Simple, tracing built-in | OpenAI-locked, no DAG, limited patterns |
| **Dify.ai** | Low-code platform | Multi-model | Web UI | Visual workflow builder, 100+ providers | Single-agent focus, not true multi-agent |
| **n8n** | Workflow automation | Multi-model | Web UI | 400+ integrations, production-ready | AI is bolt-on, not agent-native |
| **Temporal.io** | Durable execution | N/A (infrastructure) | Code SDKs | Battle-tested durability, exactly-once | Not AI-native, heavy infrastructure |
| **Lyzr** | Enterprise control plane | Multi-model | Web platform | Cross-framework, governance, multi-cloud | Enterprise pricing, not CLI-native |
| **Microsoft Copilot Studio** | Enterprise platform | Microsoft models | Web UI | Strong MS ecosystem integration | Microsoft-locked |
| **Salesforce Agentforce** | Enterprise platform | SF models | Web UI | CRM-native | Salesforce-locked |

### 1.2 Key Market Gaps

1. **No universal CLI orchestrator** — Claude Code has the best CLI experience but is Anthropic-only. No tool gives that quality with any LLM.

2. **No local-first multi-agent** — Every framework assumes cloud APIs. Nobody optimizes for Ollama/llama.cpp latency/quality tradeoffs.

3. **No cross-domain templates** — Tools are dev-focused. Finance, legal, research, creative domains have no orchestration recipes.

4. **No cost-aware routing** — No framework provides budget-aware model selection, cost estimation before execution, or automatic downgrade when budget is tight.

5. **No standardized agent-to-agent protocol adoption** — MCP handles tools, A2A handles agent communication, but nobody composes them into a working CLI orchestrator.

6. **Governance gap in open-source** — LangGraph, CrewAI, OpenAI SDK have zero production governance. Enterprise tools have it but are cloud-locked.

7. **No tool for non-developers** — Every orchestrator assumes the user can write code or configure YAML. Accountants, teachers, and researchers are completely unserved.

### 1.3 Industry Context (2026)

- **94% of enterprises** report agent sprawl causing security and operational issues (IBM)
- **Only 5% of enterprise agents** reach production — failure is at orchestration boundaries, not agent quality
- MIT Technology Review named agent orchestration one of "10 Things That Matter in AI Right Now" (April 2026)
- MCP (Anthropic) is the de facto standard for tool interfaces
- A2A (Google) is emerging as the agent-to-agent communication protocol
- The market is moving from "build agents" to "coordinate agents"

---

## 2. Orchestration Patterns

### 2.1 The 5 Production Patterns

| # | Pattern | Description | Use Case |
|---|---------|-------------|----------|
| 1 | **Sequential (Chain)** | A → B → C, linear pipeline with validation gates | Document processing, multi-step approvals, tax preparation pipelines |
| 2 | **Parallel (Fan-out/Fan-in)** | Split → N workers → Aggregate | Multi-source research, bulk document processing, parallel grading |
| 3 | **Hierarchical (Manager/Workers)** | Manager decomposes, delegates, synthesizes | Complex open-ended tasks, multi-step projects |
| 4 | **Handoff (Routing)** | Triage → Specialist owns the rest | Support routing, multi-domain assistants, client intake |
| 5 | **Loop (Iteration)** | Generate → Evaluate → Repeat until quality | Code generation, content drafts, reconciliation |

### 2.2 Control Models

| Model | Description | Use Case |
|-------|-------------|----------|
| **Centralized** | Single control plane governs all agents | Most deployments — strongest governance, clearest audit trail |
| **Decentralized** | Peer-to-peer coordination via protocols | Distributed systems, high-availability requirements |
| **Federated** | Multiple orchestrators coordinate across boundaries | Cross-organization workflows, regulatory boundaries |

### 2.3 Advanced Patterns

- **Supervisor/Worker** — hierarchical delegation with monitoring
- **Pipeline with Gates** — programmatic validation between steps (critical for compliance)
- **Map-Reduce** — parallel chunk processing with aggregation
- **Blackboard** — shared state that agents read/write independently
- **Actor Model** — isolated agents communicating via messages only (fault-tolerant)
- **Evaluator-Optimizer Loop** — generate + critique cycle until quality threshold
- **Contract Net** — agents bid on tasks based on capability/cost (enables smart routing)

### 2.4 Pattern Composition

Production systems combine patterns. A typical enterprise workflow:

```
Handoff (route to right team)
  └── Hierarchical (manager delegates within team)
        ├── Sequential (ordered steps)
        ├── Parallel (independent sub-tasks)
        └── Loop (quality-sensitive steps)
```

---

## 3. Technical Architecture

### 3.1 Core Principles

1. **LLM-agnostic from day one** — adapter layer abstracts model differences
2. **CLI-first, web-enhanced** — terminal is primary; web dashboard is optional layer
3. **Local-first** — works fully offline with local models; cloud is additive
4. **Protocol-native** — MCP for tools, A2A for agent communication
5. **Recipe-driven** — YAML workflow definitions, not code (code is optional power-user path)
6. **Observable by default** — OpenTelemetry traces for every agent action
7. **Cross-platform** — macOS, Linux, Windows (native, not WSL-only)
8. **Security-first** — data classification, least privilege, audit trails from day one
9. **Progressive disclosure** — simple for beginners, powerful for experts

### 3.2 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACES                               │
├──────────┬───────────────┬───────────────┬──────────────┬───────────┤
│ Chat UI  │  CLI (TUI)    │ Web Dashboard │IDE Extension │Headless API│
│(non-devs)│  (developers) │  (monitoring) │  (editors)   │ (CI/CD)   │
└────┬─────┴───────┬───────┴───────┬───────┴──────┬───────┴─────┬─────┘
     │             │               │              │             │
┌────▼─────────────▼───────────────▼──────────────▼─────────────▼─────┐
│                        INTENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────┤
│  NL→Recipe Compiler │ Pattern Inferencer │ Cost Estimator │ Planner  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│                        CONTROL PLANE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Scheduler  │  Router   │ State Manager │ Cost Tracker │ Governance  │
│  (DAG exec) │  (model)  │ (checkpoint)  │  (budget)    │ (policies)  │
└──────┬──────┴─────┬─────┴──────┬────────┴──────┬───────┴──────┬────┘
       │            │            │               │              │
┌──────▼────────────▼────────────▼───────────────▼──────────────▼────┐
│                       AGENT RUNTIME                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Agent Pool  │  Isolation (worktree/container)  │  Communication Bus │
└──────┬───────┴──────────────┬───────────────────┴──────────┬───────┘
       │                      │                              │
┌──────▼──────────────────────▼──────────────────────────────▼───────┐
│                       PROVIDER LAYER                                  │
├────────────┬──────────────┬───────────────┬────────────────────────┤
│  Anthropic │    OpenAI    │  Ollama/Local │   Any OpenAI-compatible │
│  (Claude)  │(GPT/o-series)│(llama/mistral)│  (Groq/Together/etc)   │
└────────────┴──────────────┴───────────────┴────────────────────────┘
       │                      │                              │
┌──────▼──────────────────────▼──────────────────────────────▼───────┐
│                       TOOL LAYER (MCP)                                │
├────────────┬──────────────┬───────────────┬────────────────────────┤
│   Office   │  Thomson     │   Web/SaaS    │    Custom MCP          │
│ Excel/Word │  Reuters CS  │  (TaxCaddy)   │    Servers             │
│  Outlook   │  UltraTax    │  (portals)    │    (user-built)        │
└────────────┴──────────────┴───────────────┴────────────────────────┘
```

### 3.3 Module Breakdown

#### Provider Adapter (`packages/providers/`)

```
anthropic.ts      — Claude API, streaming, tool use
openai.ts         — OpenAI/compatible APIs (GPT, o-series)
ollama.ts         — Local models via Ollama REST API
litellm.ts        — Universal proxy fallback (100+ models)
router.ts         — Smart routing: cost/quality/speed/privacy decisions
budget.ts         — Spend tracking, limit enforcement, auto-downgrade
```

**Smart Model Routing:**
- Route by task complexity: classification → small model, reasoning → large model
- Route by budget: track spend, auto-downgrade when approaching limit
- Route by latency: local model for instant responses, cloud for quality
- Route by privacy: restricted data → local only, public data → any model
- Fallback chains: if primary fails or is over budget, try secondary

#### Orchestration Engine (`packages/engine/`)

```
scheduler.ts      — DAG execution (topological sort, parallel dispatch)
patterns.ts       — All 5 patterns + compositions
state.ts          — Shared state with event-sourced checkpointing
gates.ts          — Validation gates (programmatic, quality, human-approval)
budget.ts         — Per-pipeline cost tracking and enforcement
intent.ts         — NL→Recipe compiler (the "magic" for non-devs)
```

#### Agent Runtime (`packages/runtime/`)

```
spawn.ts          — Create agent processes (tmux/container/subprocess)
communicate.ts    — Inter-agent messaging (A2A protocol)
isolate.ts        — Worktree/container/sandbox isolation
monitor.ts        — Health checks, timeout enforcement, iteration limits
lifecycle.ts      — Start, pause, resume, kill, checkpoint
adapters/
  claude-code.ts  — Claude Code CLI adapter
  aider.ts        — Aider CLI adapter
  generic.ts      — Generic subprocess adapter (any CLI tool)
  custom.ts       — User-defined agent runtimes
```

#### Workflow Engine (`packages/workflows/`)

```
parser.ts         — Parse YAML/Markdown workflow definitions
validator.ts      — Validate structure, dependencies, security policies
compiler.ts       — NL description → YAML recipe (via LLM)
templates/        — Domain-specific recipe library
```

#### Observability (`packages/observe/`)

```
tracer.ts         — OpenTelemetry integration (spans per agent action)
cost.ts           — Per-agent, per-task, per-pipeline cost attribution
dashboard.ts      — Real-time metrics (SSE/WebSocket)
replay.ts         — Time-travel debugging from traces
audit.ts          — Immutable compliance-grade action log
```

#### Security (`packages/security/`)

```
classifier.ts     — Data classification engine (restricted/confidential/internal/public)
redactor.ts       — PII redaction before model calls
sandbox.ts        — Agent permission enforcement
policies.ts       — Role-based access, tool allowlists, action limits
credentials.ts    — OS keychain integration (never plaintext)
incident.ts       — Anomaly detection, auto-suspend, alerting
```

#### Governance (`packages/governance/`)

```
approval.ts       — Human-in-the-loop gates
policies.ts       — Permission policies (role-based, pattern-based, domain-specific)
guardrails.ts     — Input/output validation, safety checks
compliance.ts     — Regulatory profile enforcement (SOC2, HIPAA, IRS 7216, FERPA)
```

### 3.4 Workflow Definition Format (Recipe)

```yaml
# recipes/software-dev/code-review.yaml
name: "Parallel Code Review"
description: "Multi-perspective code review with synthesis"
domain: software-development
version: 1
audience: developer

providers:
  default: anthropic/claude-sonnet
  complex: anthropic/claude-opus
  fast: ollama/llama3.2

budget:
  max_cost: $2.00
  fallback_on_budget: ollama/llama3.2

security:
  data_classification: internal
  cloud_allowed: true

agents:
  - id: security-reviewer
    role: "Security vulnerability scanner"
    model: ${providers.default}
    tools: [grep, read, glob]
    permissions: {file_access: read-only}

  - id: logic-reviewer
    role: "Logic and correctness checker"
    model: ${providers.default}
    tools: [grep, read, glob]
    permissions: {file_access: read-only}

  - id: style-reviewer
    role: "Style and maintainability reviewer"
    model: ${providers.fast}
    tools: [grep, read]
    permissions: {file_access: read-only}

  - id: synthesizer
    role: "Combine reviews into actionable summary"
    model: ${providers.complex}
    tools: [read, write]
    permissions: {file_access: write, paths: [./review-output/]}

pipeline:
  - phase: review
    pattern: parallel
    agents: [security-reviewer, logic-reviewer, style-reviewer]
    input: ${diff}
    timeout: 5m

  - phase: synthesize
    pattern: sequential
    agents: [synthesizer]
    input: ${review.outputs}
    gate:
      type: quality
      check: "all reviews completed without errors"

  - phase: iterate
    pattern: loop
    condition: "synthesizer.confidence < 0.8"
    max_iterations: 2
    agents: [logic-reviewer, synthesizer]
```

### 3.5 CLI Interface

```bash
# Initialize in any project
kairos init

# Start interactive mode
kairos start                              # auto-detect best provider
kairos start --provider ollama/llama3.2   # fully local, free
kairos start --provider anthropic/opus    # cloud, high quality
kairos start --provider auto              # smart routing

# Run a recipe
kairos run recipes/code-review.yaml --diff "$(git diff main)"
kairos run recipes/tax-prep.yaml --client "Smith, John"

# Natural language (non-dev mode)
kairos ask "Grade these 30 essays and give feedback for each student"

# Manage agents
kairos agents list
kairos agents send researcher "also check the API docs"
kairos agents pause slow-agent
kairos agents kill stuck-agent

# Cross-project intelligence
kairos consult other-project "how does auth work?"

# Budget and cost
kairos budget set $5.00
kairos budget status
kairos cost report --period=today

# Observability
kairos trace show <task-id>
kairos trace replay <task-id>    # time-travel debugger
kairos logs --agent=researcher

# Security
kairos security status           # show connected tools, trust levels
kairos security scan             # check for policy violations

# Domain kits
kairos kit install accounting
kairos kit install education
kairos kit list
kairos connect ultratax          # configure tool integration
kairos connect outlook           # authenticate to MS Graph

# Configuration
kairos config set default-provider ollama/llama3.2
kairos config set security-profile tax-firm
kairos config set budget-default $10.00
```

### 3.6 Cross-Platform Strategy

| Platform | Agent Isolation | Terminal Mux | Process Management |
|----------|----------------|--------------|-------------------|
| **macOS** | tmux + git worktrees | tmux (native) | launchd / direct |
| **Linux** | tmux + git worktrees / containers | tmux (native) | systemd / direct |
| **Windows** | shelld (Rust daemon) + git worktrees | shelld / ConPTY | Windows Service / direct |
| **Docker** | Nested containers / processes | None needed | Direct process mgmt |

---

## 4. Dual-Audience Design

### 4.1 The Interface Spectrum

```
Natural Language ──→ Saved Workflows ──→ Recipes (YAML) ──→ Code (SDK)
       ↑                    ↑                   ↑                ↑
   Teachers            Power users        Business analysts  Developers
   Accountants         Ops teams          Product managers   Engineers
   Researchers         Managers           Consultants        Architects
```

### 4.2 Non-Developer Experience (Appliance Mode)

Non-developers interact via natural language. They never see YAML, config files, or technical details.

**What they see:**

```
$ kairos start

Welcome! Connected tools:
  ✓ Excel     ✓ Word     ✓ Outlook     ✓ UltraTax CS
  Model: Local (free, private) | Security: Tax Firm profile

> What would you like to do?

You: Check which clients haven't uploaded their W-2s to TaxCaddy yet
     and send them reminder emails.

Kairos: I'll do this in 3 steps:
  1. Check all client statuses on TaxCaddy
  2. Identify who's missing W-2 documents
  3. Draft and send reminder emails (with your approval)

  Estimated time: ~2 minutes | Cost: Free (local model)

  Proceed? [Yes / Edit steps / Cancel]

You: Yes

[Checking TaxCaddy... 23 clients scanned]
[12 clients missing W-2s identified]
[Drafting 12 reminder emails...]

Done! Here's what I found:
  - 12 clients still missing W-2s (list below)
  - Draft emails ready for your review

  ⚠️  Before sending, please review the emails:
  [Review emails] [Send all] [Edit individually] [Cancel]
```

### 4.3 Developer Experience (Workshop Mode)

Developers get full control: YAML recipes, custom agents, code extensions, direct CLI access.

```bash
$ kairos run recipes/code-review.yaml --diff "$(git diff main)" --budget $1.50

Pipeline: Parallel Code Review (3 agents)
├─ [security-reviewer]  ████████░░ analyzing...  (sonnet, $0.12)
├─ [logic-reviewer]     ██████████ complete      (sonnet, $0.08)
└─ [style-reviewer]     ██████████ complete      (local, $0.00)

Gate: quality check... ✓ passed
Synthesizing...

[synthesizer] ██████████ complete (opus, $0.31)

Total: $0.51 / $1.50 budget | Time: 47s
Output: ./review-output/synthesis.md
```

### 4.4 Progressive Disclosure Design

The same workflow exists at every abstraction level:

| Level | User Type | Interaction |
|-------|-----------|-------------|
| 1 | Non-technical | "Grade these essays" → system does everything |
| 2 | Power user | Uses saved workflow "essay-grading" with custom rubric |
| 3 | Builder | Edits YAML recipe, adds plagiarism-check gate |
| 4 | Developer | Extends with custom TypeScript evaluation function |

### 4.5 Intent Layer (NL → Recipe Compiler)

The Intent Layer is what makes non-dev usage possible:

```
User input: "Reconcile January bank statements against our QuickBooks export"
                                    ↓
Intent Layer infers:
  - Domain: accounting/finance
  - Pattern: Sequential (parse → match → flag → report)
  - Tools needed: file reader (PDF OCR), spreadsheet writer
  - Data classification: confidential (financial data)
  - Model recommendation: local (sensitive data)
  - Estimated steps: 4
  - Human gates needed: yes (before any external action)
                                    ↓
Generated recipe (internal, user never sees):
  phases: [parse_statements, parse_ledger, reconcile, generate_report]
  pattern: sequential with parallel parse
  security: local-only, confidential
                                    ↓
User confirmation: "I'll parse both files, match transactions, and
                    flag discrepancies over $500. ~1 minute. Proceed?"
```

---

## 5. Domain Kits & Tool Integration

### 5.1 Domain Kit Architecture

A "domain kit" bundles everything a user needs for their field:

```yaml
# kits/accounting-tax/manifest.yaml
name: "Tax Professional Kit"
domain: accounting
audience: non-technical
description: "Automate tax preparation workflows"

security_profile: tax-firm  # auto-applies strict policies

mcp_servers:
  - mcp-office        # Excel, Word, Outlook
  - mcp-ultratax      # Thomson Reuters UltraTax CS
  - mcp-fixed-assets  # Thomson Reuters Fixed Assets CS
  - mcp-tr-planner    # Thomson Reuters Planner CS
  - mcp-taxcaddy      # SurePrep TaxCaddy portal

recipes:
  - tax-season-document-chase.yaml
  - new-client-onboarding.yaml
  - depreciation-schedule-update.yaml
  - monthly-reconciliation.yaml
  - quarterly-estimates.yaml
  - engagement-letter-generator.yaml

setup_wizard:
  steps:
    - detect: ultratax    # auto-find installation
    - detect: office      # auto-find Office
    - authenticate: taxcaddy  # browser OAuth
    - configure: security     # confirm local-only for client data
```

### 5.2 Accounting Tool Integration

#### Integration Tiers

| Tier | Method | Tools | Reliability |
|------|--------|-------|-------------|
| **Tier 1: Native API** | REST/COM/SDK | Excel, Word, Outlook | High |
| **Tier 2: File-based** | Import/export CSV, XML | Fixed Assets, Planner, UltraTax | High |
| **Tier 3: Web automation** | Browser CDP | TaxCaddy portal | Medium |
| **Tier 4: RPA fallback** | UI automation | UltraTax complex ops | Lower |

#### Per-Tool MCP Servers

**Microsoft Office (`mcp-office`)**

```yaml
platforms: [windows, macos]
integration:
  windows: COM automation (Excel.Application, Word.Application, Outlook.Application)
  macos: JXA (JavaScript for Automation) / AppleScript
  fallback: file manipulation (openpyxl, python-docx) + Graph API

tools:
  excel:
    - read_spreadsheet(path, sheet, range)
    - write_cells(path, sheet, range, data)
    - create_workbook(path, sheets_config)
    - run_macro(path, macro_name)
    - create_pivot_table(path, config)
    - apply_formula(path, sheet, cell, formula)
  word:
    - read_document(path)
    - create_from_template(template, variables)
    - insert_table(path, position, data)
    - export_pdf(path)
    - mail_merge(template, data_source)
  outlook:
    - send_email(to, subject, body, attachments)
    - draft_email(to, subject, body)  # creates draft, doesn't send
    - read_inbox(filter, limit)
    - search_emails(query, folder, date_range)
    - create_calendar_event(details)
```

**UltraTax CS (`mcp-ultratax`)**

```yaml
platforms: [windows]  # UltraTax is Windows-only
integration:
  primary: file-bridge (CSV/XML import/export)
  secondary: batch-processing (command-line utilities)
  fallback: rpa (UI automation for complex operations)

tools:
  - import_trial_balance(client_id, csv_path)
  - export_return(client_id, format: pdf|xml-mef)
  - get_client_list()
  - read_diagnostics(client_id)
  - get_carryover_data(client_id, prior_year)
  - generate_estimate(client_id, quarter)

data_formats:
  import: [csv-trial-balance, excel-worksheet, prior-year-ult]
  export: [pdf-return, xml-mef, csv-diagnostics, csv-k1-data]

detection:
  registry_key: "HKLM\\SOFTWARE\\Thomson Reuters\\UltraTax CS"
  default_path: "C:\\Thomson Reuters\\CS Professional Suite\\UltraTax CS"
```

**Thomson Reuters Fixed Assets CS (`mcp-fixed-assets`)**

```yaml
platforms: [windows]
integration: file-bridge

tools:
  - import_assets(csv_path)           # bulk asset addition
  - export_depreciation(client_id, period, format)
  - export_form_4562(client_id)       # for UltraTax
  - get_asset_list(client_id, filters)
  - calculate_depreciation(client_id, method, period)

data_formats:
  import: [csv-asset-list, excel-bulk]
  export: [csv-depreciation-schedule, csv-form-4562, pdf-report]
```

**Thomson Reuters Planner CS (`mcp-tr-planner`)**

```yaml
platforms: [windows]
integration: file-bridge + ultratax-data-link

tools:
  - import_scenario(client_id, excel_path)
  - export_plan(client_id, format: pdf|excel)
  - update_assumptions(client_id, params)
  - compare_scenarios(client_id, scenario_a, scenario_b)
  - pull_from_ultratax(client_id)     # link to current tax data

data_formats:
  import: [excel-scenario, ultratax-client-link]
  export: [pdf-plan, excel-projections, word-summary]
```

**SurePrep TaxCaddy (`mcp-taxcaddy`)**

```yaml
platforms: [windows, macos, linux]  # web-based
integration:
  primary: browser-cdp (Chrome DevTools Protocol)
  secondary: http-session (if partner API access obtained)

tools:
  - get_client_list()
  - check_document_status(client_id)
  - get_organizer_completion(client_id)
  - download_documents(client_id, doc_types, destination)
  - send_document_request(client_id, doc_list)
  - send_reminder(client_id, message)
  - get_missing_documents(client_id)

authentication:
  method: browser-oauth
  session_persistence: encrypted-cookie-jar
  refresh: automatic
```

### 5.3 Example Accountant Workflows

#### Tax Season Document Chase

```
Accountant: "Check which of my clients haven't uploaded their W-2s and
             1099s to TaxCaddy yet. Send them a reminder and update my
             tracking spreadsheet."

Orchestrator executes:
  1. [Parallel]  → Check all client organizer statuses on TaxCaddy
  2. [Sequential]→ Identify clients missing W-2/1099 documents
  3. [Parallel]  → Draft personalized reminder emails
  4. [GATE: Human approval] → "Send reminders to 12 clients? [Review]"
  5. [Parallel]  → Send approved emails via Outlook
  6. [Sequential]→ Update tracking spreadsheet in Excel
```

#### New Client Onboarding

```
Accountant: "New client John Smith. Set him up in UltraTax, create his
             TaxCaddy organizer, and send him the welcome package."

Orchestrator executes:
  1. [Sequential] → Read client intake form data
  2. [Sequential] → Generate CSV import file for UltraTax
  3. [GATE: Human]→ "Import this client data to UltraTax? [Review CSV]"
  4. [Sequential] → Create TaxCaddy organizer (browser automation)
  5. [Sequential] → Generate welcome letter from Word template
  6. [Sequential] → Send welcome email with TaxCaddy link + doc checklist
  7. [Sequential] → Add to master client tracking spreadsheet
```

#### Depreciation Schedule Update

```
Accountant: "15 new assets acquired this quarter. Here's the Excel list.
             Add to Fixed Assets, run depreciation, export for UltraTax."

Orchestrator executes:
  1. [Sequential] → Read & validate asset list from Excel
  2. [Sequential] → Generate Fixed Assets CS import CSV
  3. [GATE: Human]→ "Import 15 assets? [Review formatted list]"
  4. [Sequential] → Trigger import (file bridge or user clicks)
  5. [Sequential] → Export updated depreciation schedules
  6. [Sequential] → Format for UltraTax Form 4562 import
  7. [Sequential] → Create summary report for partner review
```

#### Monthly Reconciliation

```
Accountant: "Reconcile January bank statements against QuickBooks export.
             Flag discrepancies over $500."

Orchestrator executes:
  1. [Parallel]   → Parse bank statement PDF (OCR) + Read QB export CSV
  2. [Sequential] → Match transactions, identify discrepancies > $500
  3. [Sequential] → Create Excel reconciliation report (color-coded)
  4. [Sequential] → Draft email to partner with summary + attachment
  5. [GATE: Human]→ "Send reconciliation report to [partner]?"
```

### 5.4 Other Domain Kit Examples

#### Education Kit

```yaml
name: "Educator Kit"
tools: [google-classroom, canvas-lms, excel, word, outlook, turnitin]
recipes:
  - batch-essay-grading.yaml
  - create-lesson-plan.yaml
  - parent-communication.yaml
  - progress-report-generator.yaml
  - plagiarism-check-pipeline.yaml
security_profile: education  # FERPA-aligned
```

#### Research Kit

```yaml
name: "Research Kit"
tools: [arxiv, semantic-scholar, zotero, excel, word, latex]
recipes:
  - literature-review.yaml
  - paper-summarization-pipeline.yaml
  - citation-network-analysis.yaml
  - grant-proposal-drafting.yaml
security_profile: personal
```

#### Small Business Kit

```yaml
name: "Small Business Kit"
tools: [quickbooks, excel, outlook, word, stripe, shopify]
recipes:
  - invoice-generation.yaml
  - expense-categorization.yaml
  - monthly-bookkeeping.yaml
  - customer-followup.yaml
security_profile: financial
```

---

## 6. Security & Legal Framework

### 6.1 Threat Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      THREAT SURFACE                               │
├────────────────┬────────────────┬────────────────┬──────────────┤
│  Data Leakage  │ Model Exposure │  Tool Misuse   │ Agent Hijack │
├────────────────┼────────────────┼────────────────┼──────────────┤
│ Client PII     │ Prompts to     │ Unauth email   │ Prompt       │
│ Tax data       │ cloud LLM      │ File deletion  │ injection    │
│ Financials     │ Training data  │ Wrong client   │ via tool     │
│ SSNs/EINs      │ Model logging  │ Submission     │ output       │
└────────────────┴────────────────┴────────────────┴──────────────┘
```

### 6.2 Data Classification Engine

All data is classified before any model interaction:

| Class | Examples | Allowed Models | Handling |
|-------|----------|---------------|----------|
| **Restricted** | SSN, EIN, bank account numbers, passwords | Local only, NEVER cloud | Encrypted at rest, redacted before model, process & discard |
| **Confidential** | Tax returns, financial statements, client names, grades | Local default, cloud with explicit consent | Encrypted, access-logged, session-only |
| **Internal** | Workflow configs, firm procedures, templates | Any model | Standard protection, persistent |
| **Public** | Tax rates, IRS deadlines, general guidance | Any model | No restriction, cacheable |

**Automatic Detection Patterns:**

```yaml
classifiers:
  - pattern: '\b\d{3}-\d{2}-\d{4}\b'           # SSN
    class: restricted
    action: redact_before_model

  - pattern: '\b\d{2}-\d{7}\b'                  # EIN
    class: restricted
    action: redact_before_model

  - pattern: '\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'  # Credit card
    class: restricted
    action: block_and_warn

  - pattern: '\b[A-Z0-9]{2}\d{9}\b'             # Bank routing
    class: restricted
    action: redact_before_model

  - context: [client_name, taxpayer, dependent, student_name]
    class: confidential
    action: local_model_only_unless_consented
```

**Redaction Layer:**

```
Agent processes: "John Smith, SSN 123-45-6789, earned $150,000"
                              ↓ REDACTION
Model receives: "Client [REDACTED-1], SSN [REDACTED-2], earned $150,000"
                              ↓ MODEL REASONING
Model responds: "[REDACTED-1]'s income of $150,000 qualifies for..."
                              ↓ REHYDRATION
Output shows: "John Smith's income of $150,000 qualifies for..."
```

### 6.3 Model Provider Security

```yaml
providers:
  local-ollama:
    trust_level: maximum
    data_classes_allowed: [restricted, confidential, internal, public]
    data_leaves_machine: never
    logging: user-controlled only

  anthropic:
    trust_level: high
    data_classes_allowed: [confidential, internal, public]  # NOT restricted
    data_policy: "Does not train on API inputs"
    requires_consent: true
    consent_message: "Data will be sent to Anthropic's API servers."

  openai:
    trust_level: high
    data_classes_allowed: [confidential, internal, public]
    data_policy: "Does not train on Business/Enterprise API inputs"
    requires_consent: true
    note: "Verify user is on Business/Enterprise tier"

  unknown-provider:
    trust_level: untrusted
    data_classes_allowed: [public]
    requires_consent: true
    consent_message: "⚠️ Unknown provider. Only non-sensitive data allowed."
```

**API Key Storage:** OS keychain only (macOS Keychain / Windows Credential Manager / Linux Secret Service). Never in config files, environment variables, or agent context.

### 6.4 Agent Isolation & Least Privilege

Each agent operates in a sandbox with explicit permissions:

```yaml
agent_policies:
  taxcaddy-checker:
    allowed_tools: [mcp-taxcaddy.check_status, mcp-taxcaddy.download_docs]
    denied_tools: [mcp-taxcaddy.send_reminder]  # can't contact clients
    file_access: read-only
    network: [taxcaddy.sureprep.com]  # allowlisted domains only
    max_runtime: 10m

  email-sender:
    allowed_tools: [mcp-outlook.send_email, mcp-outlook.draft_email]
    requires_approval: always          # NEVER auto-send
    max_recipients_per_action: 5       # prevent mass-email accidents
    blocked_domains: [irs.gov, *.state.*.us]  # never email gov agencies
    rate_limit: 10/hour

  ultratax-importer:
    allowed_tools: [mcp-ultratax.generate_import_csv]
    denied_tools: [mcp-ultratax.delete_client]  # destructive ops blocked
    requires_approval: always
    file_access: {write: [/tmp/kairos-imports/]}  # scoped write
    max_runtime: 5m
```

### 6.5 Prompt Injection Defense

When agents process external content (client documents, emails, uploaded PDFs):

| Layer | Mechanism |
|-------|-----------|
| **Input sanitization** | Strip non-visible characters, detect instruction-like patterns |
| **Structural isolation** | External content wrapped as `<user_data>` not mixed with instructions |
| **Output validation** | Actions checked against policy before execution (can't introduce new recipients, can't expand tool access) |
| **Action allowlist** | Even if agent is "convinced" by injected content, governance layer blocks disallowed actions structurally |
| **Human gates** | Any externally-facing action requires approval regardless of agent confidence |

### 6.6 Legal & Regulatory Compliance

#### Applicable Standards

| Standard | Applies To | Orchestrator Impact |
|----------|-----------|-------------------|
| **IRS Circular 230** | Tax practitioners | Maintain confidentiality; practitioner remains responsible for accuracy |
| **IRC Section 7216** | Tax return preparers | Cannot disclose tax return info without consent |
| **AICPA Code of Conduct** | CPAs | Confidentiality, due professional care; AI doesn't absolve responsibility |
| **GLBA** (Gramm-Leach-Bliley) | Financial data | Safeguard customer financial information |
| **SOC 2 Type II** | Service providers | Demonstrate security controls (if SaaS mode) |
| **FERPA** | Education data | Student record privacy |
| **HIPAA** | Healthcare data | Protected health information handling |
| **State privacy laws** | Varies (CCPA, etc.) | PII handling, right to deletion, data minimization |

#### Legal Risks & Mitigations

| Risk | Scenario | Mitigation |
|------|----------|-----------|
| **Unauthorized disclosure** | Cloud LLM processes client SSN | Data classification + local-only for restricted |
| **Malpractice liability** | Agent generates wrong tax calculation | Mandatory human review gates, no auto-filing, clear disclaimers |
| **Client consent** | Using AI on client data without disclosure | Consent template + engagement letter language provided |
| **Data breach** | Agent logs contain PII | Ephemeral context, encrypted logs, auto-purge policies |
| **Regulatory inquiry** | IRS asks "who prepared this return?" | Audit trail shows human approved every step |
| **Third-party data sharing** | Sending client data to cloud API | Explicit consent per provider, data processing agreements |
| **E-discovery** | Firm is sued, agent logs discoverable | Configurable retention policies, privilege markers |
| **Negligence** | Over-reliance on AI without review | System never claims accuracy; always defers to professional judgment |

#### Required Disclaimers

```yaml
disclaimers:
  on_first_use:
    - "This tool assists with workflow automation. It does NOT provide tax,
       legal, or financial advice."
    - "You remain professionally responsible for all work product.
       AI-generated outputs must be reviewed before use."
    - "By default, all data is processed locally. Cloud AI requires
       explicit consent per session."

  on_cloud_model_use:
    - "Client data will be sent to [provider]. Their data policy: [link]"
    - "Confirm you have client consent for AI-assisted processing."

  on_client_communication:
    - "You are sending a communication to a client. You are the sender
       of record. Review before sending."

  on_tax_return_interaction:
    - "Data imported to UltraTax must be reviewed by a qualified preparer
       before filing. This tool does not verify tax accuracy."
```

### 6.7 Audit Trail

Every action is logged immutably:

```json
{
  "timestamp": "2026-07-08T14:23:01Z",
  "session_id": "sess_abc123",
  "user": "jdoe@smithcpa.com",
  "agent": "taxcaddy-checker",
  "action": "read_client_status",
  "client_id": "CLI-2024-0042",
  "client_name_hash": "sha256:a1b2c3...",
  "result": "success",
  "data_classification": "confidential",
  "model_used": "local/llama3.2",
  "data_sent_to_cloud": false,
  "tokens_used": 1250,
  "cost_usd": 0.00,
  "approval_gate": null,
  "duration_ms": 1200
}
```

**Compliance reports auto-generated:**
- Which clients' data was processed by AI this month?
- Was any restricted data sent to cloud providers?
- Which actions were human-approved vs. auto-approved?
- Full audit trail for client X (exportable for regulatory inquiry)
- Cost and usage summary per period

**Retention policies:**
- Agent context/memory: Deleted at session end (ephemeral)
- Audit logs: 7 years (tax compliance, configurable per domain)
- Temporary files: Deleted on task completion
- Workflow outputs: User controls (their file system)
- Model interaction logs: 30 days default, then purge

### 6.8 Security Profiles (Pre-built)

```bash
$ kairos security set profile:tax-firm

Applying "Tax Firm" security profile:
  ✓ All client data: confidential minimum classification
  ✓ SSN/EIN auto-detection and redaction: enabled
  ✓ Cloud models: disabled by default (enable per-session with consent)
  ✓ Email sending: requires human approval (always)
  ✓ Tax return modifications: requires human approval (always)
  ✓ Audit logging: enabled (7-year retention)
  ✓ Session auto-lock: 15 minutes idle
  ✓ Agent sandbox: strict (no internet except allowlisted domains)
  ✓ File access: scoped per agent (no cross-client access)
  ✓ IRS Section 7216 compliance mode: active

Available profiles:
  profile:personal      — relaxed, for hobby/personal use
  profile:tax-firm      — IRS 7216 + Circular 230 aligned
  profile:enterprise    — SOC 2 aligned
  profile:healthcare    — HIPAA aligned
  profile:financial     — GLBA + SOX aligned
  profile:education     — FERPA aligned
  profile:legal         — attorney-client privilege aware
```

### 6.9 Incident Response

```yaml
scenarios:
  data_breach_suspected:
    actions:
      - Immediately suspend all cloud model calls
      - Lock all agent sessions
      - Generate affected-client report from audit logs
      - Notify user with assessment
      - Preserve all logs for investigation
      - Recommend: contact breach counsel

  agent_behaving_unexpectedly:
    actions:
      - Kill agent immediately
      - Preserve context snapshot for review
      - Flag in audit log with severity
      - Block similar actions until user reviews
      - Notify user with summary of suspicious behavior

  credential_compromise:
    actions:
      - Revoke all stored API keys
      - Rotate OAuth tokens
      - Alert user to change passwords
      - Review recent actions for unauthorized activity
      - Generate incident report
```

---

## 7. Implementation Roadmap

### Phase 1: Foundation (4-6 weeks)

Core infrastructure that everything else builds on.

- [ ] Project scaffold (TypeScript, monorepo with packages/)
- [ ] Provider adapter layer (Anthropic, OpenAI, Ollama)
- [ ] Smart model router (cost/quality/speed/privacy)
- [ ] Data classification engine (pattern-based, context-based)
- [ ] PII redaction layer (detect → redact → rehydrate)
- [ ] CLI interface (basic commands: start, run, config)
- [ ] YAML recipe parser and validator
- [ ] Cross-platform process spawning (replace tmux dependency for Windows)
- [ ] OS keychain integration for credentials
- [ ] Audit log infrastructure (append-only, encrypted)

### Phase 2: Core Orchestration (4-6 weeks)

The orchestration engine and all 5 patterns.

- [ ] DAG execution engine (topological sort, parallel dispatch)
- [ ] All 5 patterns: sequential, parallel, hierarchical, handoff, loop
- [ ] Pattern composition (nested patterns)
- [ ] State checkpointing and resumability
- [ ] Validation gates (programmatic, quality, human-approval)
- [ ] Budget tracking and enforcement (per-agent, per-pipeline)
- [ ] Inter-agent communication bus
- [ ] Agent lifecycle management (spawn, pause, resume, kill)
- [ ] Agent isolation and sandboxing (file access, network, tool scoping)
- [ ] Security profile system (tax-firm, enterprise, personal, etc.)

### Phase 3: Intent Layer & Non-Dev Experience (4-6 weeks)

Making it accessible to non-developers.

- [ ] NL→Recipe compiler (natural language to workflow)
- [ ] Pattern inferencer (auto-detect best pattern for task)
- [ ] Cost estimator (preview before execution)
- [ ] Chat UI mode (conversational interface)
- [ ] Confirmation/approval UX (simple, non-technical language)
- [ ] Saved workflows (run previously defined workflows by name)
- [ ] Domain kit framework (manifest, detection, setup wizard)
- [ ] First domain kit: Accounting/Tax

### Phase 4: Tool Ecosystem (4-6 weeks)

MCP servers for real-world professional tools.

- [ ] MCP server: Microsoft Office (Excel, Word, Outlook)
- [ ] MCP server: Thomson Reuters UltraTax CS (file bridge)
- [ ] MCP server: Thomson Reuters Fixed Assets CS (file bridge)
- [ ] MCP server: Thomson Reuters Planner CS (file bridge)
- [ ] MCP server: SurePrep TaxCaddy (browser automation)
- [ ] Tool detection and auto-configuration
- [ ] Connection wizard (authenticate, test, confirm)
- [ ] Graceful degradation (tool unavailable → skip or manual fallback)
- [ ] Second domain kit: Education
- [ ] Third domain kit: Research

### Phase 5: Production Hardening (4-6 weeks)

Enterprise readiness, observability, and polish.

- [ ] OpenTelemetry tracing (spans per agent action)
- [ ] Time-travel replay debugger
- [ ] Web dashboard (monitoring, approval UI, cost dashboard)
- [ ] Windows native support (shelld integration)
- [ ] Docker deployment (containerized orchestrator)
- [ ] Plugin system for custom providers/runtimes/tools
- [ ] Prompt injection detection and defense
- [ ] Incident response automation
- [ ] Compliance report generation
- [ ] CI/CD integration (GitHub Actions, GitLab CI)
- [ ] Documentation and getting-started guides
- [ ] Community recipe contribution system

### Phase 6: Scale & Community (Ongoing)

- [ ] A2A protocol support (agent-to-agent discovery and delegation)
- [ ] Visual pipeline editor in web UI
- [ ] Multi-user/firm deployment mode
- [ ] Additional domain kits (legal, healthcare, small business, creative)
- [ ] Recipe marketplace (community-contributed workflows)
- [ ] Performance optimization (streaming, caching, batching)
- [ ] Mobile companion app (approve actions on the go)
- [ ] Enterprise features (SSO, team management, centralized policies)

---

## 8. Success Metrics

| Metric | 3-Month Target | 6-Month Target | 12-Month Target |
|--------|---------------|---------------|----------------|
| Supported LLM providers | 3 (Claude, OpenAI, Ollama) | 5+ (add Groq, Together) | 10+ |
| Supported agent runtimes | 2 (Claude Code, generic) | 4+ (add Aider, custom) | Any CLI |
| Recipe templates | 5 (dev-focused) | 20+ across 3 domains | 50+ across 6 domains |
| MCP tool servers | 3 (Office suite) | 8+ (add TR, TaxCaddy) | 20+ |
| Domain kits | 1 (accounting) | 3 (+ education, research) | 6+ |
| GitHub stars | 200 | 1,000+ | 5,000+ |
| Active users | 50 (beta) | 500 | 5,000 |
| Cross-platform | macOS + Linux | + Windows | + Docker + cloud |
| Cost savings (smart routing) | 30% | 40%+ | 50%+ |
| Non-dev user satisfaction | Prototype | Usable | Delightful |

---

## 9. Competitive Positioning

### What Makes Kairos Unique

| Differentiator | Why It Matters |
|---------------|---------------|
| **LLM-agnostic** | No vendor lock-in; use the best model for each task |
| **Local-first** | Free, private, works offline; cloud is opt-in upgrade |
| **Dual-audience** | Devs get CLI power; professionals get natural language simplicity |
| **Security-native** | Data classification, PII redaction, audit trails from day one |
| **Domain kits** | Ready-to-use packages for specific professions |
| **Real tool integration** | Actually connects to UltraTax, Excel, TaxCaddy — not just chat |
| **Protocol-native** | Built on MCP + A2A — interops with entire ecosystem |
| **Cost-aware** | Budget tracking, smart routing, auto-downgrade |
| **Cross-platform** | macOS, Linux, Windows native (not WSL-only) |
| **Progressive disclosure** | Simple to start, powerful when you need it |

### The Pitch (by audience)

**For developers:** "kubectl for AI agents. Orchestrate any LLM, any CLI, any workflow — from your terminal."

**For accountants:** "Your AI assistant that connects to UltraTax, TaxCaddy, and Office. Process client work in minutes, not hours. Data never leaves your machine."

**For teachers:** "Grade 30 essays in 5 minutes. Generate lesson plans. Send parent updates. All from one place."

**For everyone:** "The orchestrator that works with YOUR tools, YOUR preferred AI, on YOUR terms."

---

## 10. Key Lessons Incorporated

1. **Start simple** — Single agent + tools covers 80% of use cases. Multi-agent for the 20% that genuinely need it.
2. **Graph-based orchestration is winning** — Explicit DAGs over autonomous agent chat.
3. **Event-driven > conversation-based** — Structured events, not chat-based coordination.
4. **MCP is the tool standard** — Adopt fully for all tool interfaces.
5. **Checkpointing is non-negotiable** — Agents fail. Make resumption cheap.
6. **Set iteration limits** — Unbounded loops are the #1 production failure mode.
7. **95% fail at orchestration, not agent quality** — This validates the entire project.
8. **The CLI gap is real** — No model-agnostic multi-agent CLI exists with polish.
9. **Local models make non-dev adoption viable** — Free, private, zero-config.
10. **Security is the competitive moat for professional domains** — "Your data stays on your machine" wins over every cloud-only competitor.

---

## 11. Open Questions

- [ ] Language choice: TypeScript (web+CLI) vs Rust (performance+cross-platform) vs both?
- [ ] Naming: "Kairos" is clear but may conflict with existing projects — verify availability
- [ ] Monetization: Open-source core + paid domain kits? Hosted version? Enterprise license?
- [ ] Should the web dashboard be a separate package or bundled?
- [ ] Partner API access for Thomson Reuters / SurePrep — pursue formal partnership?
- [ ] How to handle UltraTax being Windows-only when many accountants use Mac?
