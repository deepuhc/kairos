# Kairos desktop app (macOS)

There are two ways to get a Kairos desktop app. Pick based on whether you have a
Rust toolchain.

## Option A — Standalone `.app` (no Rust required) ← recommended for quick testing

`packages/desktop/build-app.sh` assembles a self-contained `Kairos.app` by hand:
the single-file server bundle + the built UI + a small launcher, wrapped in the
standard macOS `.app` layout. **No Rust, no Tauri compile, no `npm install` on
the target machine** — the only runtime requirement is Node.js 20+.

### Build it

```bash
npm run app:build
# → packages/desktop/dist-app/Kairos.app
# → packages/desktop/dist-app/Kairos-macos-<version>.zip
```

Re-assemble without rebuilding the workspace (faster, if `dist` is fresh):

```bash
bash packages/desktop/build-app.sh --no-build
```

### Run it on another Mac

1. Copy `Kairos-macos-<version>.zip` to the other Mac and unzip it.
2. Make sure **Node.js 20+** is installed (`node -v`). If not, get it from
   <https://nodejs.org>.
3. **Right-click `Kairos.app` → Open** (needed only on first launch, because the
   app is unsigned). Thereafter, double-click.

The launcher picks a free port, starts the bundled server pointed at the bundled
UI, waits for it to come up, then opens your default browser at
`http://localhost:<port>`. Quitting the app stops the server.

### Where things go

- **Logs:** `~/Library/Logs/Kairos/kairos.log` — attach this to a feedback report
  if startup fails.
- **Provider config:** `~/.kairos/providers.json` (see [homelab.md](homelab.md)).
- **Feedback:** the in-app **Feedback** button builds a copyable report; a durable
  copy is also written to `~/.kairos/feedback/`.

### Limitations

- **macOS only**, and **unsigned** — first launch needs the right-click → Open
  gesture (or `xattr -dr com.apple.quarantine Kairos.app`). Not notarized.
- **Node 20+ must already be on the machine.** We ship the server as JavaScript,
  not an embedded Node runtime — the honest, low-risk choice. If Node is missing
  or too old, the launcher shows an alert and points at the log.

## Option B — Full Tauri bundle (`.dmg`, needs Rust)

`npm run desktop:build` produces a native Tauri `.dmg` with a real webview shell.
This requires a Rust toolchain (`rustup`) and the platform build tools. See
`packages/desktop/` and `src-tauri/tauri.conf.json`. This path is heavier but
yields a conventional installer.
