# Kairos — 5-Item Feedback Delivery Brief

**Owner:** orchestrator agent. **Mode:** fully autonomous. **Repo:** /Users/ddeepak/projects/kairos, branch `v2-rebuild` (git — this is a 2p repo, use git NOT perforce).

## Standing rules (non-negotiable)
- Work autonomously. Do NOT ask the user questions. Pick sensible defaults, state them in your log, proceed. Only stop for genuinely irreversible/destructive forks.
- Sub-agents you spawn must ALSO work autonomously and never block on questions. Tell them so explicitly.
- The shipped product invokes Claude Code DIRECTLY without devai. devai is testing-only via `KAIROS_ACP_USE_DEVAI=1`. Never bake devai into product code paths.
- Keep author and review in separate passes. Verify (build + tests) before claiming done. Commit verified increments with clear messages; end commit messages with the Co-Authored-By trailer for Claude.
- Prefer the lightest path that preserves quality. Land low-risk isolated changes first.

## Verification commands
- Typecheck/build: `npm run build` (tsc -b project refs across packages).
- Tests: `npx vitest run` in the affected package (node env). Server tests live in packages/server.
- UI is Lit 3 in packages/ui.

## The 5 items

### Item 4 (DO FIRST — lowest risk, fully specified): Remove the Frames feature
- ~135 refs across ~34 files. `packages/ui/src/components/agents-frames.ts` (313 lines). PanelId `'frames'`, `framesOpen` state, rail button at agents-view.ts ~5694-5705, localStorage key(s), recordFrame() calls.
- Remove cleanly: delete the component, the PanelId member, the state field, the rail button + separator, all recordFrame call sites, and any imports. Ensure build + tests stay green.

### Item 1 (decided by user): Wire up top-nav Files & Prompts as real global views; remove Files/Prompts from the right rail
- User verbatim choice: "Keep top-nav, wire them up" with preview: "TOP NAV: Chat | Files | Prompts | History | … / RIGHT RAIL: (Files/Prompts removed; only Plan/Review/Summary/Terminal)".
- Today: top-nav Files/Prompts are placeholder dead-end cards (app.ts renderView ~1139). The REAL working panels are in the right rail (agents-view.ts renderPanelRail ~5583).
- Backend /api/files/* endpoints now EXIST (files-routes.ts). Prompts today = the "prompts" right-rail panel.
- Design wrinkle: Files/Prompts are session-scoped; global top-nav views must track the ACTIVE session's cwd/agent. Make the top-nav views render the real panels bound to the active session; remove the Files & Prompts buttons from the right rail. If no active session, show a graceful empty state prompting to start/select a session.

### Item 2: Replace boolean "Auto accept" with a tiered permission model
- Recommend + implement a tiered model (e.g. Ask / Auto-edit / Full-auto) mapped to ACP `session/request_permission` optionIds, accounting for heterogeneous agents.
- KEY FINDING: two concepts exist — (a) client-side boolean Auto-accept (agents-view.ts onPermissionRequest ~3539 short-circuits to first `allow*`), and (b) agent-side `mode` SessionConfigOption (Default/Accept Edits/Plan/Don't Ask) already flowing via session/set_config_option. Prefer aligning the client tier with the agent `mode` where present, falling back to the client-side auto-select predicate. Edit sites: AgentSession.autoAccept (agents-session.ts 110/173), loadAutoAccept/saveAutoAccept (agents-view.ts 311-324), header button (5964-5992), onPermissionRequest (3536-3553), toggleAutoAccept (4587-4602), prefs-sync mirror (agent-prefs-sync.ts 27/76/86/93).
- The two background research agents (permission modes across Claude Code/Aider/Cline/Cursor/Codex/Gemini/Goose/OpenHands) may still be running; incorporate their findings if available, else proceed on the above.

### Item 3: Market research + 7 agent personas + autonomous orchestrator
- Personas: Product Marketing (does market research), UX Designer, QA Engineer, Software Architect, Software Project Manager, Software Documentation Engineer, Program Manager (tracks progress + logs it in the repo).
- NOTE: subagent types with these exact roles already exist in this environment (product-marketing, ux-designer, qa-engineer, software-architect, project-manager, docs-engineer, program-manager, orchestrator). Reuse/mirror their definitions.
- Home for persona defs: `packages/personas/` (currently orphaned — nothing imports @kairos/personas; you'll be first to wire it). Add the 7 personas there; wire into server/UI via the roles/personas seam.
- Orchestrator requirements: probe agents every 3 minutes so they're not blocked; enforce a timeout; be able to run the project autonomously when asked. Model the probe on ConnectionMonitor's injectable-timer pattern (acp/connection-monitor.ts). Server-side orchestrator can drive multiple sessions in-process via the AcpAgent/Peer seam + shared SessionStore (no socket needed). `_ext/stalled` notification is ready for server-side emit (UI already renders it). PipelineEngine gate/approveGate is the coordination-checkpoint analog. WorktreeManager gives per-agent git isolation (exists, unused).

### Item 5: Orchestrator/subagent activity view
- Add a left-rail section OR top tab showing what the orchestrator and subagents are doing. Design a very nice view. Should surface: which agents/personas are active, their current task/phase, last activity, stalled/timeout state, and the DAG/pipeline progress. Reuse the `stalled` signal and pipeline events.

## Sequencing
1. Item 4 (Frames removal) — isolated, verify green, commit.
2. Item 1 (Files/Prompts rewire) — verify, commit.
3. Item 2 (tiered permissions) — verify, commit.
4. Item 3 (personas + orchestrator) — largest; land in verified increments (personas package first, then wiring, then probe/timeout, then autonomous runner).
5. Item 5 (activity view) — depends on item 3's orchestrator surface; land last.

Log progress to PROGRESS.md and commit as you go. Do not stop until all 5 are implemented, verified, and committed, or you hit a genuine hard blocker (then log it and continue with the next independent item).
