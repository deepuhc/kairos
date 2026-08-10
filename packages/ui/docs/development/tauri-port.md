# Tauri Port

This branch ports Kairos from a Node/Express runtime to a Tauri desktop app with a Rust backend. Node remains acceptable for frontend build tooling and for launching published ACP adapters through `npx`; it is not required for Kairos's own backend.

## Runtime Shape

- Tauri owns the app process and creates the main webview window, except for browser-mode source development.
- A Rust HTTP/WebSocket backend binds to `127.0.0.1:${KAIROS_PORT:-3333}`. Source dev scripts (`npm run dev` / `npm run desktop:dev`) set a default `KAIROS_PORT` of `3334`; the near-production source launch (`npm run desktop`) defaults to `3335` so it can run beside an installed app on `3333`.
- The frontend contract remains HTTP/WebSocket based: `/api/*`, `/events`, and `/acp`.
- `npm run dev` builds the frontend, runs the Rust backend, and opens `http://localhost:3334` in the system browser.
- `npm run desktop:dev` launches the desktop webview against Vite at `http://127.0.0.1:5174`; Vite proxies backend traffic to the Rust server.
- In production, the Rust backend serves the generated `dist/` frontend and the webview loads the backend URL directly. `dist/` is a local build output and is not tracked in git.
- `npm start` remains a compatibility path for older source-checkout users: it pulls the latest checkout, refreshes dependencies if needed, then opens the published desktop-app downloads page.

## Ported Runtime Areas

| Area | Rust module |
| --- | --- |
| Backend startup/static serving | `src-tauri/src/backend/mod.rs` |
| REST API/catalog/config/auth/system/files/rules/usage | `src-tauri/src/backend/api.rs`, `src-tauri/src/backend/usage.rs` |
| Streamed operation bus | `src-tauri/src/backend/events.rs` |
| kairos/system process helpers | `src-tauri/src/backend/process.rs` |
| CLI output parsing | `src-tauri/src/backend/parser.rs` |
| Config and JSON registries | `src-tauri/src/backend/config.rs` |
| ACP bridge/session/client callbacks | `src-tauri/src/backend/acp.rs` |
| ACP agent registry/launch resolution | `src-tauri/src/backend/agents.rs` |
| ACP adapter cache | `src-tauri/src/backend/adapter_cache.rs` |
| Public toolkit/catalog enrichment | `src-tauri/src/backend/public_toolkits.rs`, `src-tauri/src/backend/skill_meta.rs` |
| MCP preset installs | `src-tauri/src/backend/mcp_presets.rs` |
| Workspaces | `src-tauri/src/backend/workspaces.rs` |
| Sessions/history/export/resume-point | `src-tauri/src/backend/sessions.rs` |
| Git worktrees/checkpoints | `src-tauri/src/backend/git.rs`, `src-tauri/src/backend/git_routes.rs` |

## Runtime Notes

- Node packages for Express, Socket.io, ws, and MariaDB were removed from `package.json`; Node is still used for frontend tooling and `npx` ACP adapters.
- Rust unit tests cover the new helper ports for adapter caching, public toolkit gating, skill metadata parsing, and P4 root parsing; frontend Vitest still covers the browser-side static behavior.
