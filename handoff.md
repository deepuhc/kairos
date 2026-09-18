# Kairos — Handoff (connect-to-Claude milestone)

> **⚠️ NEW AGENT: DELETE THIS FILE ONCE ABSORBED.** This is a one-time
> cross-laptop handoff, not permanent repo documentation. After you've read it
> and confirmed you can continue the work, remove it and commit the deletion:
>
> ```bash
> git rm handoff.md && git commit -m "Remove one-time cross-laptop handoff note"
> ```
>
> Do this on your first checkout of this branch so it doesn't linger in the repo.

_Written 2026-09-18. Purpose: let a new agent on a different laptop pick up exactly where this session left off — getting Kairos to connect to a local Claude CLI, then merging that backend into the shippable branch._

---

## TL;DR

1. **The installed app (`main`) cannot connect to Claude — by omission, not bug.** The UI opens WebSockets to `/acp`, but `main`'s server only serves `/ws`. There is no `/acp` handler on `main`.
2. **The working connect-to-Claude backend exists and is already pushed** — on the unmerged branch **`origin/v2-rebuild`** (~37 commits ahead of the merge base), with passing end-to-end tests.
3. **It is proven to work on this Mac.** A live ACP session drove the local `claude` CLI (via `devai launch`) and got the expected streamed reply. See [Proof](#proof-it-works) below.
4. **Next big decision (pending): merge `v2-rebuild` (backend) with `main` (installers/voice/feedback) so one shipped app actually connects to Claude.** Neither branch is complete alone.
5. A QE / UX / product-marketing fleet was launched against the running build; **their work was in-flight and is NOT committed** — it does not transfer to another laptop. Treat it as not-done on the new machine (re-run if needed).

---

## Repository state (what transfers via git)

| Branch | HEAD (at handoff) | What it has | What it lacks |
|--------|-------------------|-------------|---------------|
| `origin/main` | `bd119aa` | Unsigned one-click installers, embedded Node runtime, universal macOS `.dmg`, voice in/out, feedback + "Report on GitHub" | **No `/acp` connect-to-Claude backend** |
| `origin/v2-rebuild` | `2b20717` | Full ACP backend: `/acp` transport, stdio bridge to external CLIs, `devai→claude` launch seam, provider-backed agents, agent catalog, end-to-end tests | The installer/voice/feedback work from `main` (26 commits) |

- Merge base of the two branches: `eaff4b6`.
- **Nothing from this session is committed on `main`.** The only local untracked files in the `main` tree are pre-existing and unrelated (`docs/matlab-adoption-*.md`, `docs/assets/`, `docs/attachments/`).
- This `handoff.md` is the only new file added to the `main` tree by this task.

### Does NOT transfer via git (local-only on this Mac)
- The `v2-rebuild` **build** (a git worktree at `/Users/ddeepak/projects/kairos-v2rebuild` on this machine) — recreate it on the new laptop (recipe below).
- The **native-binary fix** placed into that worktree's `node_modules` — not tracked; the new laptop will hit the same npm bug and must redo it.
- The **running server** (port 3344) and the **in-flight QE/UX/PM agent work** — ephemeral; gone on a new machine.

---

## How to reproduce the working setup on a new laptop

Prereqs on the new machine: Node 20+ (this Mac used 26.7.0), the `claude` CLI, and — for the local-testing seam — `devai` on PATH. (`claude` was at `~/.config/devai/bin/claude`; `devai` at `~/.local/bin/devai`.)

```bash
# 1. Clone and get the backend branch
git clone https://github.com/deepuhc/kairos.git
cd kairos
git fetch origin v2-rebuild
git checkout v2-rebuild        # or: git worktree add ../kairos-v2rebuild origin/v2-rebuild

# 2. Install deps
npm install
```

### 2a. Beat the npm optional-deps native-binary bug (npm/cli#4828)

On a fresh `node_modules` you will likely see, on `npm run build`:
`Cannot find module @rollup/rollup-darwin-arm64` and/or esbuild
`Host version "X" does not match binary version "Y"`.

`rm -rf node_modules && npm install` did **not** fix it on this Mac. What worked: place a **version-exact** native binary next to each copy of the tool.

- **Rollup** (one copy, at root): ensure `node_modules/@rollup/rollup-<platform>/` exists (e.g. `rollup-darwin-arm64`). Version must match `node_modules/rollup` (was 4.62.4).
- **esbuild** — the trap: this repo pulls **four** esbuild versions, each needing its own `@esbuild/<platform>` at a version-exact path:
  - root `node_modules/esbuild` → `node_modules/@esbuild/<platform>`
  - `node_modules/vite/node_modules/esbuild` → nested `@esbuild`
  - `packages/ui/node_modules/esbuild` → nested `@esbuild`
  - `node_modules/tsx/node_modules/esbuild` → nested `@esbuild`
  - Versions on this Mac were: root 0.27.7, vite 0.21.5, ui 0.25.12, tsx 0.28.1 (verify yours; they drift).

Fetch any missing native package and drop it in place:
```bash
# example for one version — repeat per missing (version, location) pair
cd /tmp && npm pack @esbuild/darwin-arm64@0.25.12
mkdir -p <repo>/packages/ui/node_modules/@esbuild/darwin-arm64
tar -xzf esbuild-darwin-arm64-0.25.12.tgz -C /tmp/x && cp -R /tmp/x/package/. \
  <repo>/packages/ui/node_modules/@esbuild/darwin-arm64/
```
(On the new laptop, swap `darwin-arm64` for that machine's platform, e.g. `darwin-x64` or `linux-x64`.)

```bash
# 3. Build once native binaries resolve
npm run build           # server + UI + all packages should go green
```

### 2b. Run with the devai→claude seam
```bash
PORT=3344 KAIROS_ACP_USE_DEVAI=1 node packages/server/dist/main.js
```
- Health: `curl http://localhost:3344/api/health`
- Catalog (should show `claude` as `installed: true`): `curl http://localhost:3344/api/agents`

---

## The `devai → claude` shortcut (what "connect Kairos to Claude" actually is)

`packages/server/src/acp/launch-spec.ts` resolves how an external stdio ACP agent is launched, in this precedence:

1. `KAIROS_ACP_CMD` (+ optional `KAIROS_ACP_ARGS`) — full override.
2. `KAIROS_ACP_USE_DEVAI=1` — **the local-testing seam**: launches `devai launch -- npx -y @agentclientprotocol/claude-agent-acp` so devai's auth/proxy env is applied (this is what made it work on this Mac; auth resolved via AWS Bedrock, model `claude-opus-5`).
3. default (product form): runs the ACP adapter directly via `npx`.

`/acp` has **no token gate** — a client connects with just `ws://<host>:<port>/acp?agent=<id>&cwd=<abs-path>`. `agent=claude` → spawned over stdio via `StdioAcpAgent`; provider ids (`mock`, `anthropic`, `openai`, `gemini`, `ollama`) → in-process `ProviderAcpAgent`.

---

## Proof it works

An ACP probe (`initialize → session/new → session/prompt`) against `ws://localhost:3344/acp?agent=claude` returned the exact streamed reply `KAIROS_CONNECT_OK` with `stopReason: end_turn`, after the local `claude` CLI launched via `devai launch` and authed via AWS Bedrock. To re-verify, adapt this minimal client pattern (uses the repo's bundled `ws`):

```js
// initialize -> session/new -> session/prompt over ws://<host>/acp?agent=claude&cwd=<abs>
// auto-answer any session/request_permission by selecting the first "allow" option.
// Success = agent_message_chunk stream + a session/prompt result with stopReason "end_turn".
```
(The original probe was written to `/tmp/acp-probe.mjs` on this Mac — not in git; recreate as above.)

---

## Verify the backend independently

```bash
cd <v2-rebuild checkout>
npx vitest run                              # whole suite
npx vitest run packages/server/src/acp      # just the ACP layer
```

---

## Open decisions / next steps for the new agent

1. **Merge strategy — the headline task.** User's stated preference this session: _"test v2-rebuild now, merge after."_ Connect is now confirmed, so the follow-up is the merge. Options discussed:
   - Merge `v2-rebuild` into `main` (full integration; expect conflicts).
   - Cherry-pick just the `packages/server/src/acp/*` + `main.ts` upgrade-router + catalog commits onto `main`.
   - Decide which branch becomes the shipping trunk.
2. **Re-run the QE / UX / PM fleet** against a working build if you want their findings (previous run did not persist). Suggested foci carried over:
   - QE: `/acp` edge cases (empty prompt, cancel mid-turn, bad `agent=`, resume via `session/load`), suite pass/fail, regression tests.
   - UX: connect / first-run / error-recovery flows (real pain points: Gatekeeper block, wrong-app-opened-browser, "Agent connection closed" dead-end).
   - PMM: honest positioning + release notes for the connect milestone.
3. **Two-apps-named-Kairos confusion** (deferred): the supervisor-based installer creates `~/Kairos/Kairos.app` that opens a browser, distinct from the Tauri `.dmg` app that opens a native window. Consider renaming/retiring one.
4. **Cargo.lock** not committed (no Rust toolchain locally); CI generates it.

---

## Standing constraints (carry these forward)

- **Do not** commit `package-lock.json` churn that rewrites resolved URLs to an internal artifactory mirror — `package.json` is the source of truth.
- **Avoid `npm install` in the `main` working tree** — it re-triggers npm/cli#4828 and wipes native rollup/esbuild binaries. Use an isolated worktree/checkout for builds.
- Git identity is repo-local: `user.name "Kairos Dev"`, `user.email "dev@kairos.local"`.
- On this enterprise setup, prefix git/gh network ops with `env -u GH_HOST -u GH_ENTERPRISE_TOKEN` (e.g. `env -u GH_HOST -u GH_ENTERPRISE_TOKEN git push`). May not be needed on a personal laptop.
- Do not push/commit unless asked.

---

## Key files (on `v2-rebuild`)

- `packages/server/src/main.ts` — central `server.on('upgrade')` router: dispatches `/ws` (hub), `/acp` (ACP), `/events` (bus).
- `packages/server/src/acp/server.ts` — `AcpServer` (noServer WSS on `/acp`).
- `packages/server/src/acp/stdio-bridge.ts` + `child-process-io.ts` — spawn/proxy an external ACP CLI.
- `packages/server/src/acp/launch-spec.ts` — the `devai→claude` seam (env precedence above).
- `packages/server/src/acp/provider-agent.ts` — in-process provider-backed agent.
- `packages/server/src/rest/agent-catalog.ts` — the selectable-agent list the UI picker consumes.
- `packages/ui/src/services/acp.ts` / `acp-ws.ts` — UI's ACP client (connects to `/acp`).
- `packages/ui/docs/reference/acp-websocket.md` — the external `/acp` client protocol.
