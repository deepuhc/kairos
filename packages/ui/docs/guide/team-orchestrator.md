# Team Orchestrator & Activity View

Kairos includes an **autonomous delivery orchestrator** that drives a built-in team of AI personas through a project's full lifecycle — from market research through architecture, planning, QA, and documentation — with no human in the loop for routine phase handoffs. The **Activity view** (developer mode) shows you what the orchestrator and its personas are doing in real time.

- [How the orchestrator works](#how-the-orchestrator-works)
- [The team-role personas](#the-team-role-personas)
- [The dependency pipeline](#the-dependency-pipeline)
- [Artifact contracts and the gate](#artifact-contracts-and-the-gate)
- [Liveness and the watchdog](#liveness-and-the-watchdog)
- [Starting an orchestrator run](#starting-an-orchestrator-run)
- [The Activity view](#the-activity-view)

---

## How the orchestrator works

The orchestrator is a server-side DAG coordinator (`packages/server/src/orchestrator/`). When you start a run, it walks the persona dependency graph and executes each phase in order:

1. Each **persona** is a configured ACP coding agent session given a role-specific system prompt and a defined deliverable (an artifact file it must produce and write to disk).
2. Before a persona starts, its upstream artifacts must already exist on disk — that is the DAG edge.
3. After a persona's agent completes, the orchestrator reads the artifact and runs a **gate check** (minimum byte length and required section keywords). If the check fails, the phase is retried up to three times; if it still fails, the phase is marked **blocked** and a reason is recorded.
4. A **blocked phase stops all downstream phases** that depend on it — the run ends in a blocked state rather than stalling silently.
5. The orchestrator runs one project at a time. Progress streams over the `/events` bus as `orchestrator:*` events; the machine state is persisted to `.kairos/orchestrator-state.json` and is readable via `GET /api/orchestrator/state`.

The orchestrator is **provider-agnostic** — it routes each persona to a model tier (frontier, mid, cheap) via Kairos's `SmartRouter`, so it works with any configured provider (Anthropic, OpenAI, Ollama, etc.).

---

## The team-role personas

Seven built-in personas, each with a specific role, model tier, and artifact contract:

| Persona | Artifact | Depends on | Model tier |
|---|---|---|---|
| **Product Marketing** | `docs/market-research.md` | — (entry point) | Frontier |
| **UX Designer** | `docs/ux-spec.md` | Product Marketing | Frontier |
| **Software Architect** | `docs/architecture.md` | UX Designer | Frontier |
| **Project Manager** | `docs/task-plan.md` | Software Architect | Mid |
| **QA Engineer** | `docs/test-plan.md` + tests | Project Manager | Mid |
| **Documentation Engineer** | `docs/README.md` | QA Engineer | Cheap |
| **Program Manager** | `PROGRESS.md` (running ledger) | — (supervisor, throughout) | Cheap |

The **Program Manager** is different from the others: it runs throughout the pipeline on a heartbeat rather than as a discrete phase, maintaining an append-only, timestamped `PROGRESS.md` ledger of every state change. It never writes code or designs; it tracks and surfaces blockers.

The implementing "Engineer" (the coding agent that writes the actual code) is a regular Kairos ACP session (Claude Code or similar) launched per the task plan — not one of the seven named personas above.

---

## The dependency pipeline

The default SOP pipeline runs phases in this order, each unlocking only after the previous phase's artifact passes the gate:

```
Product Marketing → UX Designer → Software Architect → Project Manager → QA Engineer → Documentation Engineer
```

The Program Manager supervisor runs in parallel throughout. The dependency graph is derived from each persona's `dependsOn` list in `packages/personas/src/agent-roles.ts` — the same source the Activity view renders.

---

## Artifact contracts and the gate

Each persona owns exactly one typed artifact. The orchestrator reads the on-disk file after the agent completes and validates it against the contract before marking the phase done:

- **Minimum size** — the file must be at least N bytes (varies per role; the Software Architect and market research roles require at least 400 bytes, task plan and test plan at least 300 bytes, documentation at least 200 bytes).
- **Required sections** — the file content must contain specific keywords (e.g., the market research artifact must mention both "competit" and "recommend"; the architecture artifact must mention "component" and "interface").

A validation failure causes a retry (up to three attempts per phase). If validation never passes, the phase is blocked with the specific failure reason shown in the Activity view and recorded in `PROGRESS.md`.

---

## Liveness and the watchdog

Each running phase is supervised by an `AgentWatchdog` that enforces three layered timeouts (inspired by Temporal's activity model):

| Timeout | Default | Effect |
|---|---|---|
| **Heartbeat gap** | 3 minutes | Any ACP update (a chunk, tool call, plan item, usage update) resets this. Silence past the threshold → phase is presumed stalled. |
| **Start-to-close** | 30 minutes | Caps a single attempt's wall-clock time. A hung phase can't block the run indefinitely. |
| **Schedule-to-close** | 2 hours | Caps the total time across all retries for the whole task. |

Additionally, the watchdog detects **soft stalls**: if the same tool-call fingerprint (the hash of the latest tool IDs / files touched) is unchanged across three consecutive sweeps, the agent is looping even though updates keep arriving.

The liveness verdict (`ok`, `soft-stall`, `stalled`, `timeout`) appears live in the Activity view next to each running phase.

---

## Starting an orchestrator run

A run is started via `POST /api/orchestrator/start` with a `{ goal, projectDir }` body:

```http
POST /api/orchestrator/start
Content-Type: application/json

{ "goal": "Build a minimal markdown note-taking app", "projectDir": "/path/to/project" }
```

The endpoint returns `{ started: true }` immediately. Progress then streams over the `/events` bus as `orchestrator:update` events, each carrying a full state snapshot. Only one run can be active at a time; a second `POST` while a run is active returns `409 Conflict`.

---

## The Activity view

The **Activity** tab in developer mode (visible when the app is in Developer mode — toggle via the mode switcher in the bottom-left of the nav bar) shows the orchestrator's live state.

### What it shows

- **Goal** — the project goal the current run is building toward, with the run's overall status (`running`, `done`, `blocked`, `idle`).
- **Pipeline rows** — one card per phase persona, in pipeline order. Before a run starts, the full catalog is shown so you can see the pipeline shape. During a run, each row reflects the live phase state.

Each row shows:

| Element | What it means |
|---|---|
| **Status dot** | Color-coded: blue (running, animated), green (done), amber (ready), red (blocked), gray (pending). |
| **Role name** | The persona's name (e.g., "Software Architect"). |
| **Artifact path** | The repo-relative file the persona writes (e.g., `docs/architecture.md`). |
| **Status label** | Waiting / Ready / Working / Blocked / Done. |
| **Liveness** | Shown only for running phases: Healthy / Looping / Stalled / Timed out. |
| **Last activity** | Relative time since the last heartbeat (e.g., "2m ago"). Updates every 5 seconds. |
| **Attempt count** | Shown when a phase has retried (e.g., "attempt 2"). |
| **Blocked reason** | Appears on a blocked phase — the specific gate failure or watchdog verdict. |

### Live updates

The view subscribes to `orchestrator:update` events from the server's `/events` bus. Events carry the full state snapshot and a monotonic `seq` number, so the UI never applies a stale event over a newer one. The initial snapshot is fetched via `GET /api/orchestrator/state` on load (used as the reconnect fallback too).

### When there is no active run

The Activity view shows a placeholder: *"No orchestrator run is active. Start one to watch the personas work here."*
