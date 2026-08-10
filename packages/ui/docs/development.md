# Kairos Development Guide

This guide is for people editing Kairos. For end-user workflows, use [Getting Started](getting-started.md) and the [Guides & Docs](guide/README.md).

## Prerequisites

- Node.js >= 18.20.0 for frontend tooling and `npx` ACP adapters.
- Rust/Cargo via `rustup` (<https://rustup.rs/>) for Tauri desktop work and backend development. This is a developer prerequisite you install yourself — Kairos never downloads or installs a Rust toolchain for you.
- `kairos` CLI installed and on your `PATH`.

## Local Setup

```bash
npm install
npm run dev
```

`npm run dev` builds the frontend, starts the Rust backend on port `3334`, and opens `http://localhost:3334` in your default browser.

`npm run desktop:dev` launches the Tauri shell with Vite hot reload, defaulting the Rust backend to port `3334` unless `KAIROS_PORT` is set. `npm run desktop` builds the ignored `dist/` directory and launches the Tauri shell against the Rust-served frontend instead of Vite, defaulting to port `3335` so it can run beside an installed Kairos app on `3333`. `npm start` is a compatibility path for older source-checkout users: it pulls the latest checkout, installs changed dependencies, then opens the published desktop-app downloads page.

Admin usage telemetry uses embedded internal DB defaults so ordinary desktop launches are zero-config. Managed launches can override them with `KAIROS_USAGE_DB_HOST`, `KAIROS_USAGE_DB_NAME`, `KAIROS_USAGE_DB_USER`, and `KAIROS_USAGE_DB_PASSWORD`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build the frontend, run the Rust backend on port `3334`, and open it in the browser |
| `npm run dev:client` | Vite dev server only |
| `npm run desktop` | Build the frontend and launch the Tauri desktop shell against the Rust-served UI on port `3335` by default |
| `npm run desktop:dev` | Launch the Tauri desktop shell with Vite hot reload on backend port `3334` by default |
| `npm run desktop:rust:check` | Run `cargo check` and `cargo test` for the Rust backend |
| `npm run desktop:build` | Build the packaged Tauri desktop app |
| `npm run desktop:codesign:mac` | Send the macOS app updater tarball through the production Code Sign Service with the test certificate type |
| `npm run desktop:codesign:mac:test` | Legacy alias for `npm run desktop:codesign:mac` |
| `npm run desktop:codesign:win -- --artifact <installer.exe>` | Send a Windows installer through the production Code Sign Service with the test certificate type |
| `npm run desktop:codesign:win:test -- --artifact <installer.exe>` | Legacy alias for `npm run desktop:codesign:win` |
| `npm run build` | Build the frontend for production |
| `npm start` | Pull source updates, refresh dependencies if needed, then open the published desktop-app downloads page |
| `npm run download` | Open the published desktop-app downloads page without pulling |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run tests in watch mode |

## Project Shape

```text
kairos/
  src-tauri/             Tauri app and Rust backend
    src/backend/
      mod.rs             Backend startup, static files, shared state
      api.rs             REST API surface for kairos/catalog/config/customization
      acp.rs             ACP WebSocket bridge and agent subprocess runtime
      agents.rs          Built-in/custom ACP agent registry and launch resolution
      process.rs         kairos/system process helpers and streamed operations
      parser.rs          CLI output parsing
      config.rs          ~/.kairos config and JSON registries
      git.rs             Git worktree/checkpoint primitives
      git_routes.rs      /api/worktrees and /api/checkpoints routes
      sessions.rs        /api/sessions routes
      workspaces.rs      /api/workspaces routes
      events.rs          Native /events WebSocket event bus
  src/                   Lit frontend
    app.ts               Root app shell and mounted top-level views
    components/          Web components
    services/            API, ACP, transcript, session, and helper services
    styles/theme.css     Design tokens and theme system
  docs/                  End-user and reference docs
```

`AGENTS.md` is the deeper architecture map for coding agents and should be kept current when internals change.

## Main Architecture

The Rust backend carries three transports on one local HTTP server:

| Transport | Purpose |
|---|---|
| REST under `/api/*` | Data fetching and command orchestration. Handlers spawn `kairos`, parse output, and return JSON. |
| WebSocket at `/events` | Streaming install/update/uninstall/self-update output keyed by operation id. |
| WebSocket at `/acp` | Pure ACP JSON-RPC 2.0, one WebSocket per live agent process. |

The frontend is a Lit application bundled by Vite. Top-level views are kept mounted rather than torn down; the Agents view must remain mounted so live WebSocket sessions and spawned agent subprocesses survive navigation.

## Two Code Paths To Keep Separate

### Catalog / CLI Wrapper

This is the point-and-click layer over `kairos` apps, plugins, skills, config, sessions, diagnostics, updates, security, and workspaces.

Main flow:

```text
kairos CLI output -> src-tauri/src/backend/parser.rs -> REST JSON -> src/services/api.ts -> Lit components
```

Important files:

- `src-tauri/src/backend/api.rs`
- `src-tauri/src/backend/process.rs`
- `src-tauri/src/backend/parser.rs`
- `src-tauri/src/backend/config.rs`
- `src-tauri/src/backend/sessions.rs`
- `src-tauri/src/backend/workspaces.rs`
- `src/components/catalog.ts`
- `src/components/item-card.ts`
- `src/components/terminal-panel.ts`

### Agents / ACP Client

This is the live coding cockpit. The frontend opens:

```text
ws://<host>:<port>/acp?agent=<id>&cwd=<absolute-path>
```

The Rust backend spawns the selected agent, bridges JSON-RPC frames, and answers the agent's filesystem and terminal callbacks server-side, scoped to the session working directory.

Important files:

- `src-tauri/src/backend/acp.rs`
- `src-tauri/src/backend/agents.rs`
- `src-tauri/src/backend/git.rs`
- `src-tauri/src/backend/git_routes.rs`
- `src-tauri/src/backend/sessions.rs`
- `src/services/acp*.ts`
- `src/services/agents-session.ts`
- `src/components/agents-view.ts`
- `src/components/agents-sidebar.ts`
- `src/components/agents-*.ts`

See [ACP over WebSocket](reference/acp-websocket.md) for the external client protocol.

## Route Overview

| Route area | Purpose |
|---|---|
| `/api/apps`, `/api/plugins`, `/api/skills` | List, status, catalog metadata |
| `/api/execute`, `/api/execute-batch`, `/api/launch` | Allowlisted CLI execution and system terminal launches |
| `/api/auth` | Login/logout, vault status, SSH setup, passphrase/key/proxy certificate operations |
| `/api/config`, `/api/features` | Config and feature flag list/get/explain/set/unset |
| `/api/sessions` | Session list, resume, export, preview, transcript edit/fork support |
| `/api/doctor` | Parsed `kairos doctor` status and fixes |
| `/api/system` | Version, self-update, UI update status/actions |
| `/api/workspaces` | Workspace discovery, pin/hide/rename/sort |
| `/api/agents` | Agent list, custom agent CRUD, per-agent auth, force restart, terminal auth |
| `/api/files` | Read-only file tree and preview scoped to session cwd |
| `/api/worktrees` | Isolated git worktree create/inspect/remove |
| `/api/checkpoints` | Prompt snapshot create/list/diff/restore |
| `/api/rules` | Project `AGENTS.md` rule files |
| `/api/usage` | Admin-only usage telemetry |

## Testing

Frontend/static tests live in `src/__tests__/` and run under Vitest:

```bash
npm test
npm run test:watch
```

Rust backend verification runs through Cargo:

```bash
npm run desktop:rust:check
```

Vitest has no jsdom DOM harness. Lit component changes are usually verified with TypeScript, build, static template/theme tests, and manual checks in the running app.

High-value test areas:

- Parser coverage for CLI table/status changes.
- Route response shape and security boundaries in Rust backend code.
- ACP JSON-RPC bridge, session lifecycle, transcript, and conversation helpers.
- Config migration and persistence behavior.
- Filesystem/worktree/checkpoint security boundaries.
- Pure frontend helper logic in `src/services/*`.

A pre-commit hook in `.githooks/` runs the suite automatically after `npm install` configures `core.hooksPath`.

## Security Notes

- Mutating CLI endpoints go through `src-tauri/src/backend/allowlist.rs`.
- CLI commands use process argument arrays; shell execution is limited to explicit hook/terminal flows.
- ACP filesystem and terminal callbacks are confined to the session `cwd`.
- The working-directory guard is not a full process sandbox; local/BYO agents still run as the current user.
- Admin-only Usage routes are enforced in the Rust backend via the OS username.

## Windows Release Signing

Windows releases should be Authenticode-signed. The Tauri updater `.sig` file protects updater integrity, but it does not give the installed `kairos.exe` or NSIS installer Windows publisher reputation.

`scripts/tauri-build.mjs` injects Windows signing config when CI provides one of these:

- `KAIROS_WINDOWS_CERTIFICATE_THUMBPRINT` — SHA1 thumbprint for Tauri's default `signtool.exe` path. Optional companions: `KAIROS_WINDOWS_DIGEST_ALGORITHM` (defaults to `sha256`), `KAIROS_WINDOWS_TIMESTAMP_URL`, and `KAIROS_WINDOWS_TIMESTAMP_TSP`.
- `KAIROS_WINDOWS_SIGN_COMMAND` — custom Tauri sign command containing `%1`, useful for cloud/trusted-signing tools.
- `KAIROS_WINDOWS_REQUIRE_SIGNING=1` — fail the build if neither signing path is configured.

GitLab Windows release builds set `KAIROS_WINDOWS_SIGN_COMMAND` to `scripts/ci/codesign-windows-in-place.mjs`, which calls the configured Code Sign Service before NSIS packages `kairos.exe`. The wrapper verifies the Authenticode signature immediately after signing and writes a marker consumed by the build job, proving Tauri invoked signing for the app executable during packaging. The later `sign:windows:x64` job still signs the final NSIS installer and regenerates its Tauri updater `.sig`.

If Defender reports `Trojan:Win32/Wacatac.C!ml` or another malware quarantine for a published Windows build, treat it as a release incident until the artifact is validated. Compare the user's installer hash with CI artifacts, submit the installer and installed `kairos.exe` to Microsoft Security Intelligence as a false-positive candidate, and publish a signed replacement build after Microsoft clears or explains the detection. Do not ask users to broadly whitelist the install directory.

## Code Sign Service

The release signing path uses the configured Code Sign Service endpoint (set via `KAIROS_CODESIGN_SERVICE_URL`) with `certtype=test`. macOS app bundles use workflow #4 (`/api/sign-notarize/`) because workflow #2 signs only a single submitted file and does not correctly sign the `.app` inside Tauri's updater tarball. Windows installers and standalone binaries use workflow #2 (`/api/codesign/`).

Configure the Code Sign Service token without committing it. Either set the token directly:

```bash
export KAIROS_CODESIGN_API_TOKEN=<api-token>
```

Or point to a local token file:

```bash
export KAIROS_CODESIGN_API_TOKEN_FILE=.cache/codesign-api-token
```

Build the macOS app updater artifact:

```bash
KAIROS_TAURI_BUNDLES=app npm run desktop:build
```

Then sign it:

```bash
npm run desktop:codesign:mac
```

The signed macOS artifact is written to `signed-artifacts/src-tauri/target/release/bundle/macos/Kairos.app.tar.gz`, with a regenerated updater signature at the same path plus `.sig`. The script packages `Kairos.app` with `__notarize__metadata.json`, posts it to workflow #4, verifies the returned `.app` with `codesign --verify --deep --strict`, then creates the updater tarball.

For Windows, build the NSIS installer and pass its path:

```bash
npm run desktop:codesign:win -- --artifact src-tauri/target/<target>/release/bundle/nsis/<installer>.exe
```

On non-Windows hosts the Windows Authenticode verification step is skipped; verify the returned `.exe` on Windows with `Get-AuthenticodeSignature`.

GitLab signing jobs run automatically for tagged releases and schedules. Configure a masked `KAIROS_CODESIGN_API_TOKEN` variable in GitLab before running a release pipeline. `KAIROS_FULL_PIPELINE=1` is only needed when forcing the release build/sign/deploy jobs from a non-tag pipeline. The default CI signing service is production with the test certificate type:

| Variable | Value |
|---|---|
| `KAIROS_CODESIGN_SERVICE_URL` | Your code sign service URL |
| `KAIROS_CODESIGN_CERTTYPE` | `test` |

Set `KAIROS_FULL_PIPELINE=1` only when forcing a non-tag pipeline through the full build/sign/deploy flow.

Optional URL-based signing remains available for CI or pre-staged artifacts:

| Variable | Purpose |
|---|---|
| `KAIROS_CODESIGN_ARTIFACTORY_BASE_URL` | Artifactory folder URL used to stage signing inputs. The script appends a unique artifact filename. |
| `KAIROS_CODESIGN_ARTIFACTORY_AUTH_HEADER` | Optional full upload auth header, such as `Authorization: Bearer ...`. |
| `KAIROS_ARTIFACTORY_USERNAME` and `KAIROS_ARTIFACTORY_TOKEN` | Optional upload credentials used when no auth header is provided. |
| `KAIROS_CODESIGN_INPUT_URL` | Optional pre-staged artifact URL. Set `KAIROS_CODESIGN_UPLOAD=0` when using this instead of uploading. |

The test service path does not prove macOS notarization; the current service documentation says workflow #4 signs the app bundle but skips notarization and stapling on the test path.

## Contributing

Direct commits to `main` are acceptable for focused, tested changes.

Before committing:

1. Run `npm test`.
2. Run `npm run desktop:rust:check`.
3. Add or update tests/checks for changed behavior.
4. Manually verify the affected golden path.
5. Call out unverified platform-specific behavior in the commit message.
