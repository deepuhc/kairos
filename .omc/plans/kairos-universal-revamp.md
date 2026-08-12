# Kairos Universal AI Assistant - Requirements, Functional Design & Architecture

> Version: 1.0 | Date: 2026-08-08 | Status: DRAFT
>
> **Progress note (2026-08-12):** Several themes from this vision have landed on
> `v2-rebuild` via the 5-item feedback delivery (see `.omc/plans/feedback-5items-brief.md`
> and `PROGRESS.md`):
> - **Multi-agent orchestration (§3.4):** a server-side DAG coordinator now drives
>   7 built-in team-role personas (`packages/personas`) autonomously, guarded by a
>   layered liveness watchdog. Docs: `packages/ui/docs/guide/team-orchestrator.md`.
> - **Security & permissions (§3.7):** the boolean auto-accept was replaced by a
>   4-tier permission model (Plan / Ask / Auto / Full-auto) with an always-on danger floor.
> - **Navigation/IA (§4.1):** top-nav Files & Prompts are now real session-bound
>   global views; the Frames protocol-inspector feature was removed.
> - A developer-mode **Activity** view surfaces the orchestrator pipeline live.
>
> This doc remains the broader vision; the task list in §7 is not yet fully delivered.

---

## 1. Vision & Positioning

Kairos is the universal AI assistant that meets every user where they are. Unlike developer-focused tools that intimidate non-technical users, or consumer chatbots that frustrate power users, Kairos provides persona-adaptive AI orchestration -- a warm, intelligent desktop companion that transforms from a simple conversational assistant into a multi-agent workflow powerhouse based on who is using it and what they need. It is the OS-level AI layer that handles any file, connects to any AI provider (cloud or local), and orchestrates complex multi-step work invisibly, whether that work is debugging a distributed system, preparing quarterly tax filings, building a school presentation, or drafting a compensation analysis.

---

## 2. Target Personas

### 2.1 Maya - Senior Full-Stack Developer
- **Role**: Tech lead at a startup, manages 3 engineers
- **Key workflows**: Code review, architecture planning, multi-repo refactoring, CI/CD debugging
- **Pain points**: Context switching between tools, losing AI conversation context across sessions, managing multiple coding agents
- **Needs from Kairos**: Multi-agent orchestration with DAG pipelines, terminal integration, git worktree isolation, code-aware chat with file diffs

### 2.2 Jordan - UX/Product Designer
- **Role**: Design systems lead at a mid-size company
- **Key workflows**: Design critique, accessibility audits, copy writing, user research synthesis, prototype iteration
- **Pain points**: AI tools don't understand visual context, can't process Figma exports or design specs easily
- **Needs from Kairos**: Image/PDF understanding, structured feedback workflows, markdown report generation, mood board analysis

### 2.3 Priya - HR Business Partner
- **Role**: Supports 200-person engineering org
- **Key workflows**: Comp analysis, offer letter drafting, policy Q&A, employee handbook updates, interview scheduling
- **Pain points**: Repetitive document generation, maintaining consistency across templates, salary benchmarking across multiple data sources
- **Needs from Kairos**: Template-driven workflows, Excel/CSV processing, confidential local-only mode, document generation with merge fields

### 2.4 Marcus - CPA / Financial Analyst
- **Role**: Senior tax accountant at a regional firm
- **Key workflows**: Tax return preparation, financial statement analysis, client correspondence, regulatory research, audit trail documentation
- **Pain points**: Sensitive financial data cannot go to cloud AI, needs citations for compliance, spreadsheet analysis is manual
- **Needs from Kairos**: Local-only AI (Ollama), Excel/PDF processing, citation tracking, audit-ready output with provenance

### 2.5 Sarah - Account Executive
- **Role**: Enterprise SaaS sales, manages $2M pipeline
- **Key workflows**: Prospect research, email sequences, proposal generation, CRM data synthesis, competitive analysis, meeting prep
- **Pain points**: Spends 40% of time on non-selling activities, data scattered across tools
- **Needs from Kairos**: Multi-step research workflows, template personalization, CRM integration hooks, quick summaries from long documents

### 2.6 Alex - Tax Assistant / Paralegal
- **Role**: Junior associate at an accounting/law firm
- **Key workflows**: Document review, form filling, data extraction from PDFs, cross-referencing regulations, client intake
- **Pain points**: Tedious data entry, checking multiple regulatory sources, maintaining accuracy across dozens of similar documents
- **Needs from Kairos**: Batch document processing, form auto-fill from context, regulatory lookup pipelines, accuracy verification gates

### 2.7 Zara - 12-Year-Old Student
- **Role**: 7th grader, curious about science and storytelling
- **Key workflows**: Homework help, creative writing, science project research, learning new topics, building simple apps
- **Pain points**: Most AI tools feel intimidating or give adult-level responses, parents worry about safety
- **Needs from Kairos**: Kid-safe mode with content filtering, age-appropriate responses, guided learning workflows, visual/interactive outputs, parental controls

### 2.8 Team Admin / IT Operator
- **Role**: Manages Kairos deployment for a small team (5-20 people)
- **Key workflows**: User provisioning, model routing rules, usage monitoring, shared workflow templates, cost allocation
- **Pain points**: Each person configures AI differently, no visibility into team usage, model costs unpredictable
- **Needs from Kairos**: Centralized config, team-shared pipelines, usage dashboard, model cost controls, network deployment (Open WebUI bridge)

---

## 3. Requirements Specification

### 3.1 Universal Chat & File Handling

| ID | Requirement | Priority |
|----|-------------|----------|
| UC-01 | Accept any file type via drag-drop, paste, or file picker (PDF, Excel, CSV, images, audio, video, code, archives) | P0 |
| UC-02 | Render inline previews for common formats (images, PDF pages, spreadsheet tables, code blocks) | P0 |
| UC-03 | Extract text/data from uploaded files using local processing (no cloud upload for extraction) | P0 |
| UC-04 | Support multi-turn conversations with persistent file context | P0 |
| UC-05 | Stream AI responses with real-time token display | P0 |
| UC-06 | Support voice input and text-to-speech output | P1 |
| UC-07 | Render rich outputs: tables, charts, diagrams (mermaid), LaTeX math, code with syntax highlighting | P0 |
| UC-08 | @-mention files from filesystem, attach from recent files, reference previous messages | P0 |
| UC-09 | Export conversations to Markdown, HTML, PDF | P1 |
| UC-10 | Inline annotations on file content (highlight text in PDF, cells in spreadsheet) | P2 |

### 3.2 Persona-Based Experience

| ID | Requirement | Priority |
|----|-------------|----------|
| PE-01 | First-run persona selection wizard (pick role, customize later) | P0 |
| PE-02 | Persona-specific home dashboards with relevant quick actions | P0 |
| PE-03 | Adaptive system prompts based on active persona | P0 |
| PE-04 | Persona-specific workflow templates pre-installed | P1 |
| PE-05 | Ability to switch personas or create custom hybrid personas | P1 |
| PE-06 | Kid mode: content filtering, simplified UI, parental PIN | P1 |
| PE-07 | Progressive disclosure: hide advanced features until user demonstrates readiness or opts in | P0 |
| PE-08 | Persona-specific keyboard shortcuts and slash commands | P2 |

### 3.3 Multi-Provider AI Backend

| ID | Requirement | Priority |
|----|-------------|----------|
| MP-01 | Support providers: Anthropic (Claude), OpenAI (GPT/Codex), Google (Gemini), Ollama (local), Custom HTTP endpoints | P0 |
| MP-02 | Smart routing: automatically select model based on privacy setting, task complexity, cost budget | P0 |
| MP-03 | Explicit model picker: user can override and pin a model for a session | P0 |
| MP-04 | Local-only mode: guarantee zero network calls, route everything through Ollama | P0 |
| MP-05 | Model capability detection: know which models support vision, function calling, long context | P1 |
| MP-06 | Cost tracking: real-time token usage and estimated cost per session/day/month | P0 |
| MP-07 | Fallback chains: if primary model fails or rate-limits, cascade to alternatives | P1 |
| MP-08 | Custom model registration: user can add any OpenAI-compatible endpoint | P1 |
| MP-09 | Provider health monitoring: latency, availability, error rates | P2 |

### 3.4 Orchestration & Workflows

| ID | Requirement | Priority |
|----|-------------|----------|
| OW-01 | Visual workflow builder: drag-and-drop nodes for non-developers | P1 |
| OW-02 | Markdown pipeline definitions for developers (existing DAG format) | P0 |
| OW-03 | Workflow templates marketplace: install, share, rate community workflows | P2 |
| OW-04 | Multi-agent execution with parallel phases, gates, fan-out | P0 |
| OW-05 | Human-in-the-loop gates: approval steps with context display | P0 |
| OW-06 | Workflow scheduling: run at specific times or on triggers (file change, webhook) | P2 |
| OW-07 | Three-tier hierarchy: Planner -> Coordinator -> Agent (from Claude Orchestrator) | P1 |
| OW-08 | Cross-session consultation: agents can query other running sessions | P2 |
| OW-09 | Pipeline monitoring dashboard with real-time phase visualization | P0 |
| OW-10 | Workflow version history and rollback | P2 |
| OW-11 | Natural language workflow creation: "Every Monday, summarize my inbox and create a priorities list" | P1 |

### 3.5 Knowledge & Context Management

| ID | Requirement | Priority |
|----|-------------|----------|
| KC-01 | Session persistence with full conversation history, searchable | P0 |
| KC-02 | Knowledge base: user can add documents, notes, bookmarks that persist across sessions | P1 |
| KC-03 | Automatic context assembly: relevant past conversations and knowledge injected into new chats | P1 |
| KC-04 | Project-scoped context: rules, personas, and knowledge tied to working directories | P0 |
| KC-05 | RAG pipeline for knowledge base: chunk, embed (local), retrieve | P2 |
| KC-06 | Session bookmarks and tags for organization | P1 |
| KC-07 | Prompt library: save, organize, share reusable prompts | P0 |
| KC-08 | Edit/Fork (rewind): branch from any point in conversation history | P0 |

### 3.6 Collaboration Features

| ID | Requirement | Priority |
|----|-------------|----------|
| CF-01 | Team network mode: share Kairos instance over local network (Open WebUI bridge) | P2 |
| CF-02 | Shared workflow templates within team | P2 |
| CF-03 | Export/import complete sessions for handoff | P1 |
| CF-04 | Shared knowledge bases across team members | P3 |
| CF-05 | Activity feed: see what workflows are running across the team | P3 |

### 3.7 Security & Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| SP-01 | Credentials stored in OS keychain (existing) | P0 |
| SP-02 | Local-only mode with network kill switch (no DNS resolution) | P0 |
| SP-03 | File sandbox: working directory scoped access with explicit grants | P0 |
| SP-04 | Permission gates for file writes, command execution, network access | P0 |
| SP-05 | Audit log: all AI interactions logged locally with timestamps | P1 |
| SP-06 | Content filtering for kid mode (block inappropriate responses) | P1 |
| SP-07 | Data classification labels: mark sessions as confidential/internal/public | P2 |
| SP-08 | Encrypted local storage for sensitive knowledge base entries | P1 |

### 3.8 Platform & Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| PI-01 | Cross-platform: macOS, Windows, Linux (Tauri 2) | P0 |
| PI-02 | Auto-updates with rollback capability | P0 |
| PI-03 | VS Code integration: workspace discovery, launch with tools on PATH | P0 |
| PI-04 | MCP server integration for tool extensibility | P0 |
| PI-05 | Plugin architecture: community-built extensions | P1 |
| PI-06 | System tray with quick access (global hotkey) | P1 |
| PI-07 | Deep links: kairos:// protocol handler | P2 |
| PI-08 | CLI companion: `kairos chat`, `kairos run <workflow>`, `kairos ask "question"` | P1 |
| PI-09 | Webhook receiver for external triggers | P2 |
| PI-10 | Accessibility: full keyboard navigation, screen reader support, high contrast modes | P0 |

---

## 4. Functional Design

### 4.1 Navigation Model & Information Architecture

```
[Global Header Bar]
  - Kairos logo + persona indicator
  - Global search (Cmd+K) -- searches sessions, files, workflows, knowledge
  - Model selector pill (shows active model + cost ticker)
  - Quick actions (new chat, new workflow, voice)
  - Settings gear + profile avatar

[Left Sidebar] (collapsible, ~240px)
  - Sections (context-aware by persona):
    - Pinned / Favorites
    - Recent Sessions
    - Workflows (running/scheduled)
    - Knowledge Base
    - Workspaces (dev persona only)
  - Footer: Usage summary, Local/Cloud indicator

[Main Canvas] (flexible)
  - Chat view (default)
  - Workflow builder view
  - Dashboard view
  - Settings view

[Right Panel] (slide-over, contextual)
  - File preview
  - Pipeline monitor
  - Session inspector (frames/protocol)
  - Knowledge browser
```

**Key principle**: The left sidebar organizes WHAT you're working on. The main canvas is WHERE you work. The right panel shows supplementary CONTEXT.

### 4.2 Landing Experience (First Run)

**Step 1: Welcome Screen**
- Warm illustration (not corporate, not developer-y)
- "Welcome to Kairos. I adapt to how you work."
- "Let's get you set up in 60 seconds."

**Step 2: Persona Selection**
- Cards with illustrations for each persona type
- "I mostly work with..." -> Developer | Designer | HR | Finance | Sales | Legal | Student | Other
- Selection pre-configures: home dashboard, system prompts, visible features, default workflows

**Step 3: AI Provider Setup**
- "Where should I think?"
- Options: "Use my own models (local, free)" / "Connect to Claude" / "Connect to GPT" / "I'll decide later"
- Auto-detect Ollama if running locally
- API key entry for cloud providers

**Step 4: First Task**
- Pre-populated prompt based on persona:
  - Dev: "Let's set up your first project workspace"
  - HR: "Drop a job description and I'll create an interview rubric"
  - Finance: "Upload a spreadsheet and I'll analyze it"
  - Student: "What are you learning about this week?"

### 4.3 Chat Interface Design

**Beyond developer chat -- the Adaptive Conversation Canvas:**

```
+------------------------------------------------------+
| [Session Title - editable]            [Model] [Cost] |
+------------------------------------------------------+
|                                                      |
|  [AI Message]                                        |
|  +-------------------------------------------------+ |
|  | Structured response with:                       | |
|  | - Formatted text (headers, lists, bold)         | |
|  | - Inline file previews (thumbnail + expand)     | |
|  | - Data tables (sortable, exportable)            | |
|  | - Charts (auto-generated from data)             | |
|  | - Action buttons ("Apply", "Save", "Run")       | |
|  | - Citations [1] with hover-preview              | |
|  +-------------------------------------------------+ |
|  [Copy] [Edit] [Fork from here] [Save to knowledge] |
|                                                      |
|  [User Message with attachments]                     |
|  "Analyze Q3 revenue" + [revenue-q3.xlsx preview]    |
|                                                      |
+------------------------------------------------------+
| [Composer]                                           |
| +--------------------------------------------------+ |
| | Type or paste... (/ for commands, @ for files)   | |
| |                                                  | |
| | [Attachments bar: file1.pdf, image.png]          | |
| +--------------------------------------------------+ |
| [+Files] [Voice] [Template] [Workflow]  [Send ->]    |
+------------------------------------------------------+
```

**Composer Features:**
- Rich text input with markdown preview toggle
- File attachment bar with thumbnails
- Slash commands (/) for persona-specific actions
- @-mentions for file references
- Template insertion from prompt library
- "Think deeper" toggle (switches to reasoning model)
- Queue messages while AI is responding

**Response Features:**
- Streaming with cancelation
- Collapsible thinking/reasoning sections
- Interactive elements: buttons that trigger follow-up actions
- "Apply" buttons for file modifications (shows diff first)
- Confidence indicators where applicable
- Source citations with preview popover

### 4.4 File Handling UX

**Upload Methods:**
- Drag and drop anywhere in the chat
- Paste from clipboard (images, text)
- File picker button
- @-mention to reference without uploading
- Folder drop for batch processing

**File Processing Pipeline (user-facing):**
1. Drop file -> instant thumbnail/preview
2. Progress indicator: "Extracting text..." / "Reading spreadsheet..."
3. File becomes a persistent context attachment (stays in session)
4. AI can reference specific parts: "In row 42 of your spreadsheet..."

**Format Support Matrix:**

| Format | Preview | Extract | Edit |
|--------|---------|---------|------|
| PDF | Page thumbnails | Full text + tables | Annotate |
| Excel/CSV | Table view | All sheets/cells | Formula assist |
| Images | Inline display | Vision analysis | - |
| Audio | Waveform + duration | Transcription | - |
| Video | Thumbnail + duration | Key frame analysis | - |
| Code files | Syntax highlighted | Full content | Diff editor |
| Markdown | Rendered view | Full content | WYSIWYG |
| Archives | File tree | Extract & process | - |

### 4.5 Workflow Builder

**Two modes:**

**A) Visual Builder (for non-developers)**
- Canvas with draggable nodes
- Node types: AI Task, Human Review, File Input, File Output, Condition, Loop, Delay
- Connect nodes with lines showing data flow
- Each node has a simple form: "What should AI do?" + model selection
- Test run with sample data before saving
- Natural language: "Create a workflow that..." generates initial nodes

**B) Pipeline DSL (for developers)**
- Enhanced existing markdown format
- Live preview as visual graph alongside code
- IntelliSense for phase references, model names, gate types
- Import/export between visual and code formats

**Pre-built Workflow Templates by Persona:**
- Developer: Code review pipeline, Multi-repo refactor, Release notes generator
- HR: Interview rubric builder, Comp analysis workflow, Policy Q&A chain
- Finance: Financial statement analyzer, Tax form processor, Audit trail builder
- Sales: Prospect research pipeline, Proposal generator, Win/loss analysis
- Student: Research paper assistant, Study guide creator, Project planner

### 4.6 Dashboard / Home Screen

**Persona-adaptive home with these sections:**

**Universal:**
- Greeting with time-aware context ("Good morning, Marcus")
- Quick actions row (3-5 buttons based on persona)
- Recent sessions (last 5, one-click resume)
- Active workflows (running/scheduled, with progress)

**Developer additions:**
- Workspace quick-switch
- Agent status indicators
- Pipeline health summary

**Finance additions:**
- Document queue (files awaiting processing)
- Confidentiality mode toggle (prominent)
- Compliance checklist

**Student additions:**
- Learning streak / progress
- Saved projects
- Fun fact of the day (AI-generated, age-appropriate)

### 4.7 Settings & Personalization

**Organized by concern:**

```
Settings
├── Profile & Persona
│   ├── Active persona
│   ├── Custom persona editor
│   └── Display name & avatar
├── AI Providers
│   ├── Provider connections (API keys, endpoints)
│   ├── Model preferences (default, fallback chain)
│   ├── Local models (Ollama config)
│   ├── Cost limits (daily/monthly budgets)
│   └── Privacy mode (local-only toggle)
├── Appearance
│   ├── Theme (14+ themes, light/dark/auto)
│   ├── Font size & family
│   ├── Density (comfortable/compact)
│   └── Motion (reduced motion toggle)
├── Workflows
│   ├── Installed workflows
│   ├── Scheduling
│   └── Default gates (auto-approve settings)
├── Knowledge
│   ├── Knowledge base management
│   ├── Context window preferences
│   └── Session retention policy
├── Security
│   ├── File access permissions
│   ├── Network policy
│   ├── Kid mode / Parental controls
│   └── Audit log viewer
├── Integrations
│   ├── VS Code
│   ├── MCP servers
│   └── Plugins
└── Advanced
    ├── Feature flags
    ├── Diagnostics (Doctor)
    ├── Debug/Protocol inspector
    └── Data export/import
```

### 4.8 Accessibility & Internationalization

**Accessibility (P0):**
- Full keyboard navigation with visible focus indicators
- ARIA labels on all interactive elements
- Screen reader announcements for streaming content
- High contrast mode (separate from theme)
- Reduced motion mode (respects `prefers-reduced-motion`)
- Minimum touch targets: 44x44px
- Focus trap in modals/dialogs
- Live regions for real-time updates

**Internationalization (P2):**
- UI string externalization (i18n-ready from day 1)
- RTL layout support in CSS architecture
- Date/number/currency formatting per locale
- AI response language preference (separate from UI language)

---

## 5. Architecture Specification

### 5.1 Package Restructuring

```
packages/
├── protocol/          — [KEEP] ACP types + JSON-RPC 2.0 codec
├── shared/            — [EXPAND] Themes, tokens, i18n strings, persona configs
├── providers/         — [EXPAND] Add Gemini, custom HTTP, capability detection
├── orchestrator/      — [EXPAND] Visual builder export, scheduling, three-tier hierarchy
├── agents/            — [KEEP] Process lifecycle, adapters
├── server/            — [EXPAND] REST API alongside WS, file processing endpoints
├── files/             — [NEW] File processing pipeline (extract, preview, transform)
├── knowledge/         — [NEW] Knowledge base, embeddings, RAG, context assembly
├── personas/          — [NEW] Persona definitions, adaptive prompts, feature gates
├── workflows/         — [NEW] Template registry, visual->DAG compiler, scheduler
├── ui/                — [REDESIGN] New design system, persona-adaptive shell
│   ├── core/          — Design system primitives (buttons, inputs, cards, layout)
│   ├── chat/          — Conversation canvas components
│   ├── workflows/     — Visual builder components
│   ├── dashboard/     — Home screen, widgets
│   ├── files/         — File preview, upload, processing UI
│   ├── settings/      — Settings panels
│   └── shell/         — App shell, navigation, sidebars
├── desktop/           — [KEEP] Tauri 2 shell
└── cli/               — [EXPAND] Chat, run, ask commands
```

### 5.2 New Service Layers

**FileProcessingService** (`packages/files/`)
```
Input (any file) -> Detector (mime, encoding) -> Extractor -> Transformer -> Output

Extractors:
- PDFExtractor (pdf-parse, local)
- SpreadsheetExtractor (xlsx, csv-parse)
- ImageExtractor (metadata, send to vision model)
- AudioExtractor (whisper via Ollama or API)
- CodeExtractor (tree-sitter for structure)
- ArchiveExtractor (decompress, recurse)

Output formats:
- TextContent (plain extracted text)
- StructuredData (tables, key-value pairs)
- Preview (thumbnail, rendered page)
```

**KnowledgeService** (`packages/knowledge/`)
```
Components:
- DocumentStore: SQLite-backed storage for knowledge entries
- Chunker: Split documents into semantic chunks
- Embedder: Generate embeddings (local via Ollama or API)
- Retriever: Similarity search for context assembly
- ContextAssembler: Merge retrieved context + conversation history + persona prompt
```

**PersonaService** (`packages/personas/`)
```
Components:
- PersonaRegistry: Built-in + custom persona definitions
- FeatureGate: Show/hide UI features based on persona + experience level
- PromptAdapter: Modify system prompts based on active persona
- DashboardConfigurator: Persona-specific home screen layout
```

**WorkflowService** (`packages/workflows/`)
```
Components:
- TemplateRegistry: Browse, install, rate workflow templates
- VisualCompiler: Convert visual builder graph to PipelineDefinition
- Scheduler: Cron-based + event-triggered workflow execution
- NLParser: "Every Monday summarize..." -> workflow definition
```

### 5.3 Provider Abstraction Enhancement

```typescript
// Enhanced Provider interface
interface Provider {
  readonly name: string;
  readonly isLocal: boolean;

  // Existing
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;

  // New capabilities
  supportsVision(): boolean;
  supportsToolUse(): boolean;
  supportsStreaming(): boolean;
  maxContextWindow(model: string): number;
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}

// New: StreamChunk replaces plain string for richer streaming
interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'citation' | 'done';
  content: string;
  metadata?: Record<string, unknown>;
}

// New: Multi-modal message support
interface MessageContent {
  type: 'text' | 'image' | 'file' | 'audio';
  text?: string;
  mediaType?: string;
  data?: Uint8Array;  // For inline content
  uri?: string;       // For file references
}

// New: Enhanced Message
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MessageContent[];
}
```

### 5.4 File Processing Pipeline

```
User Action          Server Processing         AI Integration
-----------          -----------------         --------------
Drag & drop    ->    MIME detection       ->   (none yet)
                     |
                     v
               Size/type validation
                     |
                     v
               Extraction (local)        ->   Store extracted text
                     |
                     v
               Preview generation        ->   Send thumbnail to UI
                     |
                     v
               Chunking (if large)       ->   Embed chunks (knowledge)
                     |
                     v
               Context attachment         ->   Include in next prompt
```

**Key design decisions:**
- All extraction happens locally (no file content sent to cloud for extraction)
- Extracted content is what gets sent to AI (not raw binary)
- Large files are chunked; only relevant chunks sent per turn
- Previews are generated server-side, served as static assets

### 5.5 Orchestration Engine Enhancements

Building on existing `PipelineEngine`:

1. **Three-tier hierarchy** (from Claude Orchestrator):
   - Planner: Breaks down goals into pipeline definitions
   - Coordinator: Manages multiple pipelines across sessions
   - Agent: Executes individual phases

2. **Visual Pipeline Export**: `PipelineDefinition` <-> visual graph JSON (bidirectional)

3. **Scheduling**: New `SchedulerService` wraps engine, triggers on cron/events

4. **Natural Language Pipelines**: `NLParser` uses AI to convert descriptions into `PipelineDefinition`

5. **Enhanced Gate Types**:
   - `budget_gate`: Pause if cumulative cost exceeds threshold
   - `quality_gate`: Run evaluation model, proceed only if score > threshold
   - `time_gate`: Wait until specific time
   - `file_gate`: Wait until file appears in watched directory

### 5.6 State Management

```
State Architecture:
├── Server State (authoritative)
│   ├── SessionStore (SQLite): conversations, messages, files
│   ├── WorkflowStore (SQLite): pipeline definitions, run history
│   ├── KnowledgeStore (SQLite + vector index): documents, embeddings
│   ├── ConfigStore (JSON + keychain): settings, credentials
│   └── EventLog (append-only): all state transitions
│
├── Client State (reactive)
│   ├── Lit @state() for component-local state
│   ├── SharedState service (singleton) for cross-component state
│   ├── WebSocket subscription for real-time server state
│   └── LocalStorage for UI preferences (theme, sidebar state)
│
└── Sync Protocol
    ├── Initial: HTTP GET /state -> full snapshot
    ├── Updates: WebSocket events -> patch local state
    └── Mutations: HTTP POST/PUT -> server validates -> broadcasts
```

### 5.7 Plugin / Extension Architecture

```
Plugin Manifest (kairos-plugin.json):
{
  "id": "kairos-plugin-jira",
  "name": "Jira Integration",
  "version": "1.0.0",
  "capabilities": ["tool", "ui-panel", "workflow-node"],
  "permissions": ["network:*.atlassian.net", "storage:1MB"],
  "entrypoints": {
    "tool": "./dist/tool.js",      // MCP-compatible tool definition
    "panel": "./dist/panel.js",    // Lit web component
    "node": "./dist/node.js"       // Workflow builder node type
  }
}

Plugin Types:
- Tool plugins: Add MCP-compatible tools (search Jira, query Salesforce, etc.)
- UI panel plugins: Add right-rail panels or dashboard widgets
- Workflow node plugins: Add new node types to visual builder
- Provider plugins: Add custom AI providers
- Persona plugins: Add new persona definitions with templates
```

---

## 6. Visual Design Direction

### 6.1 Mood & Principles

**Warm Ambient Intelligence** -- Kairos should feel like a well-lit, organized workspace with natural materials, not a dark terminal or a sterile corporate tool.

- **Warm**: Subtle warm undertones in neutrals, amber/gold accents (the "kairos golden moment")
- **Spacious**: Generous whitespace, content doesn't fight for attention
- **Layered**: Subtle depth via soft shadows and translucency (not glassmorphism -- more like frosted paper)
- **Alive**: Gentle motion that communicates state (breathing dots, smooth transitions)
- **Inclusive**: Approachable at first glance, doesn't assume technical literacy

### 6.2 Differentiation

| Aspect | Polygent | Claude Orchestrator | Kairos |
|--------|----------|--------------------|---------|
| Palette | Dark glass, neon accents | Monochrome, terminal green | Warm neutrals, amber gold, variable per persona |
| Layout | Dense panels, developer IDE | Terminal-heavy split | Spacious canvas with contextual panels |
| Typography | Mono-heavy | System default | Mixed: humanist sans (Inter) for UI, readable serif option for long content |
| Motion | Minimal | None | Purposeful micro-animations (state communication) |
| Feel | "Power tool" | "CLI dashboard" | "Intelligent companion" |

### 6.3 Palette (Default: "Kairos Dawn")

```
-- Light mode (default for non-developers):
Background:        #FAFAF8 (warm white)
Surface:           #F5F3EF (parchment)
Surface elevated:  #FFFFFF (pure white cards)
Border:            #E8E4DE (soft warm gray)
Text primary:      #1C1917 (warm black)
Text secondary:    #78716C (stone)
Accent:            #D97706 (amber-600, the "golden moment")
Accent hover:      #B45309 (amber-700)
Success:           #059669 (emerald-600)
Error:             #DC2626 (red-600)
Info:              #2563EB (blue-600)

-- Dark mode (default for developers):
Background:        #1C1917 (warm charcoal)
Surface:           #292524 (stone-800)
Surface elevated:  #44403C (stone-700)
Border:            #57534E (stone-600)
Text primary:      #FAFAF9 (warm white)
Text secondary:    #A8A29E (stone-400)
Accent:            #F59E0B (amber-500)
```

### 6.4 Typography

- **UI**: Inter (variable weight, excellent legibility at small sizes)
- **Content reading**: Optional toggle to system serif (Georgia, Charter) for long-form content
- **Code**: JetBrains Mono (ligatures optional)
- **Scale**: 14px base, modular scale 1.25x (14, 17.5, 22, 27.5, 34)

### 6.5 Motion Design

- **Transitions**: 200ms ease-out for panels, 150ms for micro-interactions
- **Loading**: Gentle pulsing dots (amber) instead of spinners
- **Streaming**: Characters appear with subtle fade (not typewriter), thinking indicator is slow amber breathe
- **Navigation**: Crossfade between views (no sliding -- feels app-like, not mobile-like)
- **Reduced motion**: All animations collapse to instant state changes

### 6.6 Iconography

- Line icons (Lucide or Phosphor set), 1.5px stroke weight
- Filled variants for active/selected states
- Custom illustrations for onboarding and empty states (warm, hand-drawn feel)

---

## 7. Implementation Task List

### Phase 1: Foundation (Weeks 1-3)

| # | Task | Package | Acceptance Criteria |
|---|------|---------|-------------------|
| 1 | Create `packages/files` scaffolding with MIME detection and base extractor interface | files | `detectMime(buffer)` returns correct type for PDF, XLSX, PNG, MP3 |
| 2 | Create `packages/knowledge` with SQLite document store and CRUD operations | knowledge | Can store, retrieve, update, delete knowledge entries; 10ms query time |
| 3 | Create `packages/personas` with persona registry and feature gate system | personas | Load built-in personas, resolve feature visibility for each |
| 4 | Create `packages/workflows` with template registry and visual-to-DAG compiler types | workflows | Type definitions compile; template CRUD operations work |
| 5 | Enhance Provider interface: add capability detection, cost estimation, multi-modal messages | providers | Existing tests still pass; new interface types available |
| 6 | Add Gemini provider implementation | providers | Can list models, complete, and stream with Gemini API |
| 7 | Add custom HTTP provider (OpenAI-compatible endpoints) | providers | Can connect to any OpenAI-compatible API at arbitrary URL |
| 8 | Implement StreamChunk protocol replacing plain string streaming | providers, server | Streaming delivers typed chunks (text, thinking, tool_call) |
| 9 | Restructure `packages/ui` into subpackages (core, chat, shell, dashboard, files, workflows, settings) | ui | All existing components still render; new folder structure in place |
| 10 | Implement new design system primitives: Button, Input, Card, Dialog, Tooltip | ui/core | Components render correctly in Storybook; keyboard accessible |

### Phase 2: Universal Chat & Personas (Weeks 4-7)

| # | Task | Package | Acceptance Criteria |
|---|------|---------|-------------------|
| 11 | Build file upload pipeline: drag-drop -> detect -> extract -> preview | files, ui/files | Drop a PDF, see thumbnail + extracted text within 2s |
| 12 | PDF extractor with page-level text extraction | files | Extract text from multi-page PDF; handle scanned PDFs gracefully (return empty with warning) |
| 13 | Spreadsheet extractor (XLSX, CSV) with table structure preservation | files | Extract all sheets, maintain row/col structure, handle formulas as values |
| 14 | Image handler: generate thumbnail, pass to vision-capable model | files, providers | Image in message -> provider receives base64 image content |
| 15 | Build new chat canvas with rich message rendering (tables, code, charts, citations) | ui/chat | Render markdown with tables, fenced code (highlighted), mermaid diagrams |
| 16 | Implement inline file previews in chat messages | ui/chat, ui/files | Attached files show thumbnail; click expands to full preview panel |
| 17 | Build new composer with attachment bar, slash commands, @-mentions | ui/chat | Can type, attach files, insert templates, @reference files from filesystem |
| 18 | Implement persona selection wizard (first-run flow) | ui/shell, personas | First launch shows wizard; selection persists; skip option available |
| 19 | Build persona-adaptive home dashboard with quick actions | ui/dashboard | Dashboard layout changes based on active persona; shows recent + actions |
| 20 | Implement adaptive system prompts based on persona | personas, server | Persona system prompt prepended to AI messages; adjusts tone/expertise |
| 21 | Add multi-modal message support to WebSocket protocol | server, protocol | Client can send messages with file attachments; server routes to provider |
| 22 | Implement model selector pill with cost ticker | ui/shell | Shows active model; click to switch; real-time cost display per session |
| 23 | Build global search (Cmd+K) across sessions, files, knowledge | ui/shell, server | Search returns results from conversations, attached files, knowledge base |

### Phase 3: Orchestration & Workflows (Weeks 8-11)

| # | Task | Package | Acceptance Criteria |
|---|------|---------|-------------------|
| 24 | Visual workflow builder: canvas with draggable nodes and connections | ui/workflows | Can place nodes, connect them, configure each node via form |
| 25 | Visual-to-DAG compiler: convert node graph to PipelineDefinition | workflows | Round-trip: visual -> DAG -> execute -> same result as hand-written DAG |
| 26 | Pre-built workflow templates (5 per persona, 30 total) | workflows | Templates installable; run successfully with sample data |
| 27 | Three-tier hierarchy: Planner agent that breaks goals into pipelines | orchestrator | "Build me a landing page" -> generates multi-phase pipeline automatically |
| 28 | Natural language workflow creation | workflows | "Every time I drop a PDF, extract tables to CSV" -> creates valid workflow |
| 29 | Workflow scheduling (cron-based) | workflows | Schedule workflow for "every Monday at 9am"; executes on time |
| 30 | Pipeline monitoring dashboard with real-time phase visualization | ui/workflows | Can see all running pipelines; each phase shows status with live updates |
| 31 | Enhanced gate types: budget, quality, time, file gates | orchestrator | Budget gate pauses when cost > threshold; quality gate runs eval |
| 32 | Cross-session agent consultation protocol | orchestrator, server | Agent in pipeline A can query agent in session B; response incorporated |
| 33 | Workflow version history and rollback | workflows | Can view past versions of a workflow; restore any previous version |

### Phase 4: Polish & Quality (Weeks 12-14)

| # | Task | Package | Acceptance Criteria |
|---|------|---------|-------------------|
| 34 | Implement new theme system with Kairos Dawn (warm light) and Kairos Dusk (warm dark) | shared, ui | New default themes render correctly; contrast ratios pass WCAG AA |
| 35 | Add micro-animations: streaming breathe, panel transitions, loading states | ui | Animations visible in normal mode; instant in reduced-motion |
| 36 | Full keyboard navigation audit and fix | ui | Tab through all interactive elements; focus visible; no traps |
| 37 | Screen reader testing and ARIA improvements | ui | VoiceOver can navigate full app; streaming content announced |
| 38 | Kid mode implementation: content filter, simplified UI, parental PIN | personas, server | Enable kid mode; inappropriate content blocked; PIN to exit |
| 39 | Implement Edit/Fork (conversation rewind) with branching UI | ui/chat, server | Click "Fork" on any message; creates new branch; can switch between |
| 40 | Session export to Markdown, HTML, PDF | server, ui | Export button produces clean document in each format |
| 41 | Cost tracking dashboard: per-session, daily, monthly, by provider | ui/dashboard, server | Accurate token counts and cost estimates; budget alerts |
| 42 | Local-only mode with network kill switch | server, desktop | Toggle kills all outbound connections; Ollama still works |
| 43 | Audit log implementation | server | All AI interactions logged with timestamps; viewable in settings |

### Phase 5: Platform & Ecosystem (Weeks 15-18)

| # | Task | Package | Acceptance Criteria |
|---|------|---------|-------------------|
| 44 | Plugin architecture: manifest, loader, sandboxed execution | server, ui | Can install a sample plugin; it adds a tool + UI panel |
| 45 | MCP server integration refresh (align with latest spec) | server | Can connect to MCP servers; tools appear in chat |
| 46 | System tray with global hotkey (Cmd+Shift+K) | desktop | Hotkey brings up Kairos from anywhere; quick prompt input |
| 47 | CLI companion: `kairos chat`, `kairos run`, `kairos ask` | cli | CLI commands work from terminal; pipe-friendly output |
| 48 | Team network mode: share instance over LAN | server | Machine accessible at LAN IP; other users can connect via browser |
| 49 | Knowledge base with RAG: chunk, embed (local Ollama), retrieve | knowledge | Add document -> chunked -> embedded; relevant chunks retrieved in chat |
| 50 | Voice input (system speech recognition) and TTS output | desktop, ui | Can speak prompts; AI responses can be read aloud |
| 51 | Deep link protocol handler (kairos://) | desktop | `kairos://chat?prompt=hello` opens app with pre-filled prompt |
| 52 | Auto-update with rollback | desktop | Update downloads silently; applies on restart; can rollback from settings |
| 53 | End-to-end test suite (Playwright) for critical paths | tests | 20+ E2E tests covering onboarding, chat, file upload, workflow |

---

## Appendix A: Technology Choices for New Packages

| Package | Key Dependencies | Rationale |
|---------|-----------------|-----------|
| files | pdf-parse, xlsx, sharp, file-type | Proven libraries, all work locally |
| knowledge | better-sqlite3, @xenova/transformers (local embeddings) | Zero cloud dependency for embeddings |
| personas | (pure TypeScript, no deps) | Simple config-driven, no runtime deps |
| workflows | (depends on orchestrator) | Reuses existing DAG engine |
| ui redesign | Lit 3, @open-wc/testing, Storybook | Keeps existing framework, adds tooling |

## Appendix B: Migration Strategy

The revamp is additive, not a rewrite:
1. New packages (`files`, `knowledge`, `personas`, `workflows`) are created alongside existing ones
2. The UI is restructured into subpackages but components are migrated incrementally
3. Existing WebSocket protocol is extended (new message types), not replaced
4. Existing themes are kept; new themes added; default changes
5. Provider interface is extended with backward compatibility (new methods optional with defaults)

## Appendix C: Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Scope creep from 6 personas | High | High | Implement persona system generically; content (templates, prompts) added incrementally |
| Local file processing performance | Medium | Medium | Use worker threads; process in background; show progress |
| Embedding quality with local models | Medium | Low | Start with simple keyword search; RAG is P2 |
| Kid mode content filtering accuracy | Medium | High | Use conservative blocklist + model-based filter; err on side of safety |
| Visual workflow builder complexity | High | Medium | Start with linear-only workflows; add branching in Phase 4 |
