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
| 1 | Top-nav Files & Prompts as global views | DONE | (see commit below) |
| 2 | Tiered permission model | PENDING | — |
| 3 | 7 personas + autonomous orchestrator | IN PROGRESS (backend, parallel) | — |
| 5 | Orchestrator/subagent activity view | PENDING (depends on #3) | — |

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
