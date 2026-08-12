# Kairos — 5-Item Feedback Delivery Progress

Owner: delivery orchestrator (autonomous). Repo branch: `v2-rebuild`.
Brief: `.omc/plans/feedback-5items-brief.md`.

## Baseline (verified green before any changes)
- `npm run build` — PASS (all workspaces).
- UI tests (`npx vitest run packages/ui`) — 314 passed / 44 files.
- Server tests (`npx vitest run packages/server`) — 95 passed / 16 files.
- Starting HEAD: `071e6f8 feat(server): implement read-only workspace file routes`

## Item status

| # | Item | Status | Commit |
|---|------|--------|--------|
| 4 | Remove Frames feature | DONE | d009897 |
| 1 | Top-nav Files & Prompts as global views | DONE | cf0d616 |
| 2 | Tiered permission model | DONE | 0ae099d |
| 3 | 7 personas + autonomous orchestrator | DONE | 8a31f77, 522e356 |
| 5 | Orchestrator/subagent activity view | DONE | 522e356 + finish increment |

ALL 5 ITEMS DONE. Also fixed alongside: session rename/pin (55f20f0) — the /api/sessions/*
mutation family had no real routes, so rename silently no-op'd.

## Decisions log
- Sequencing: UI items (4→1→2) run serially since all edit `agents-view.ts`. Item 3
  backend (packages/personas + packages/server) runs in parallel — disjoint files.
  Item 5 lands last (depends on #3 orchestrator surface).
- Author/reviewer separated: each increment gets an independent code-reviewer/verifier
  pass before the orchestrator commits. No self-approval.
- devai stays testing-only (`KAIROS_ACP_USE_DEVAI=1`); product paths invoke Claude Code directly.
- Item 3 personas are TEAM-ROLE agent personas (distinct from the existing end-user UI
  personas in built-in.ts); added as agent-role definitions in packages/personas.

## Running log
- (init) Baseline captured, task list created.
- Subagent spawning was blocked by the auto-mode classifier (Stage-2 denials) and,
  as a teammate, I can only run subagents synchronously/unnamed. Adapted: authored
  the UI edits directly, kept an INDEPENDENT code-reviewer pass before each commit
  (author != reviewer preserved).
- Item 4 (Frames removal): deleted agents-frames.ts + acp-frames.ts; stripped PanelId
  'frames', framesOpen state, frameLog/frameSeq/FRAME_LOG_CAP, recordFrame + all 7 call
  sites, render block, rail button+separator, CSS, togglePanel/applyPanelState/panelOpen
  arms; adjusted Behind-the-Scenes prose (removed "Watch it live" section, nav entry,
  hero clause, FEATURE_TIP, stale comments); updated agents-view-style.test.ts PanelId
  assertions. code-reviewer flagged 2 major prose leftovers + 2 stale comments — all fixed.
  Verified: build PASS, UI 314/314 pass. Committed d009897.
- Item 1 (top-nav Files & Prompts as global views): added `globalPanel` property to
  kairos-agents; render() early-returns a full-page panel (agents-file-tree /
  agents-prompts, new `fullBleed` prop hides the side-panel close button) bound to the
  ACTIVE session, with a "No active session → Go to Chat" empty state. app.ts keeps
  kairos-agents mounted+active for views agents|files|prompts (new `agentsHosted`
  getter), passes globalPanel, handles new `open-chat` event → navigate('agents');
  removed the placeholder Files/Prompts cards. Removed Files & Prompts buttons from the
  right rail. Pruned now-dead promptsOpen plumbing + 'prompts' PanelId member (the
  in-session Files side panel via openLinkedFile stays). Decision: switching sessions in
  the global view re-targets the panel (intended); new-session/resume/behind-scenes route
  through goToChat() first so they aren't dead-ends. code-reviewer flagged the dead-end
  MAJOR + dead promptsOpen MINOR — both fixed. Verified: build PASS, UI 314/314. Committing.
- Item 2 (tiered permission model): replaced the boolean Auto-accept with a 4-tier model
  (Plan / Ask [default] / Auto [guarded] / Full-auto). New PURE module
  packages/ui/src/services/permission-policy.ts: decidePermission(tier, toolCall, cwd) →
  allow|reject|prompt; pickOption() maps the decision onto the agent's optionId (prefers
  _once, never guesses — no matching option ⇒ prompt). Always-on danger floor (isDangerous)
  applies in EVERY tier: destructive/system commands (rm -r/-R/--recursive/--force,
  curl|bash, sudo, dd if/of, git push --force / reset --hard, chmod 777), redirects that
  escape the workspace, and edit/delete/move outside cwd (pathEscapesWorkspace handles
  ~/$HOME/absolute/.. ). Auto tier auto-allows reads + in-workspace edits/moves + an
  allowlist of safe command heads (every segment must pass), prompts for deletes/fetch/
  risky cmds. Wired through AgentSession.permissionTier, loadPermissionTier/
  savePermissionTier, AgentPrefs.permissionTier (+legacy autoAccept mirror: on→full-auto),
  agent-prefs-sync mirror, server stub. onPermissionRequest intercepts per tier; header
  button became a 4-way picker (renderPermissionControl) with re-decide-on-change and the
  reused first-approval nudge (now "Switch to Auto"). Native `mode` alignment: only `plan`
  delegates natively — auto/full-auto stay in `default` so the agent keeps asking and the
  client-side danger floor is never bypassed (KEY security decision). 19→24 policy unit
  tests. code-reviewer (round 1) flagged 3 MAJOR bypasses: redirect-out-of-workspace,
  rm -R/long-opts, and native bypassPermissions/acceptEdits nullifying the floor — ALL
  fixed; +5 MINOR (~ paths, auto→autoAccept downgrade, dd/chmod precision, menu mutual
  close) addressed. Round-2 code-reviewer: PASS on all 3 MAJOR fixes; noted 1 MEDIUM
  residual (interpreter one-liners `node -e`/`python3 -c` auto-run under Auto) — closed by
  treating inline-code flags on interpreter heads as unsafe. Verified: build PASS (tsc -b
  clean), UI+server 442/442 pass. Committed 0ae099d.
- Item 3 (7 personas + autonomous orchestrator): committed 8a31f77 (personas package:
  7 team-role AgentRoles with systemPrompt/artifact-contract/DAG dependsOn + getAgentRole/
  DEFAULT_PIPELINE_ROLES, agent-roles.test.ts 12 tests; server orchestrator: AgentWatchdog
  on the ConnectionMonitor injectable-timer shape with layered heartbeat/start-to-close/
  schedule-to-close + fingerprint soft-stall; dual-write state store under ~/.kairos via the
  shared kairos-home helper) and 522e356 (Coordinator: pure SOP-DAG pipeline w/ artifact
  gates + retry→block; RunManager: router-backed executeRole streaming each persona's
  artifact to disk, watchdog-guarded per attempt, emitting orchestrator:* + _ext/stalled on
  /events; read-only GET /orchestrator/state|roles). Product path only — router-backed, NO
  devai. Single run at a time.
- Follow-up done by team-lead (context handoff — feedback-orchestrator hit a context-length
  limit mid-Item-3): fixed compile errors in the two uncommitted test files (TS18046
  res.json()→readJson helper in orchestrator-routes.test.ts; threaded AgentRoleId through
  run-manager.test.ts helpers). Also refactored session-overrides.ts onto the shared
  kairos-home.js path resolver (single state home, KAIROS_HOME override, atomic temp+rename,
  serialized mutate queue) so it and orchestrator state.json share one write discipline.
- Item 5 (orchestrator/subagent activity view): committed within 522e356 + this finish
  increment. New `kairos-activity` component (packages/ui/src/components/activity-view.ts):
  renders the pipeline DAG + per-persona status/liveness from GET /orchestrator/state, live
  via orchestrator:* events; static role catalog from GET /orchestrator/roles. Added an
  `activity` top-nav tab (developer mode only) with icon; api.ts getOrchestratorState/Roles
  clients + shared types. Read-only (POST /start registered server-side only when a
  RunManager is present). app-mode-gating test updated 7→8 dev tabs.

## Final verification (team-lead)
- `npx tsc -b` — clean (exit 0).
- Server + personas — 152 passed / 23 files.
- UI — 345 passed / 46 files.
- All 5 feedback items DONE; session-rename bug fixed alongside.
