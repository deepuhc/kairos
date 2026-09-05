# Installing Kairos and keeping it updated

Kairos runs on **macOS, Linux, and Windows**. The recommended install gives you a
double-clickable launcher **and** in-app updates: when a new version ships, you
click **Update Kairos** in the app and it rebuilds and restarts itself — no
reinstall, same on every platform.

Prerequisites on the target machine: **Git** and **Node.js 20+**. The installer
checks for both and tells you what's missing.

## Install (double-click)

Download the `install/` folder from the repo, then:

| OS | Do this |
|----|---------|
| **macOS** | Double-click **`Install Kairos (macOS).command`**. First time, macOS may block it — right-click → **Open**. |
| **Windows** | Double-click **`Install Kairos (Windows).bat`**. |
| **Linux** | Run **`bash install/install.sh`** (or make `install.sh` executable and double-click it). |

Each one downloads the installer, clones Kairos to **`~/Kairos`**, installs
dependencies, builds, and creates a launcher:

- **macOS:** `~/Kairos/Kairos.app` — double-click it (or drag to `/Applications`).
- **Windows:** a **Kairos** shortcut on your Desktop (and `~/Kairos/Kairos.cmd`).
- **Linux:** a **Kairos** entry in your app menu (and `~/Kairos/kairos`).

### One-line install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/deepuhc/kairos/main/install/install.sh | bash
```

### What the launcher does

The launcher runs the **supervisor** (`packages/desktop/supervisor.mjs`), which
starts the server on a free port, opens your browser, and — crucially — handles
self-update: when the app asks for an update, the supervisor rebuilds and
restarts on the same port.

## Updates (one click, in-app)

When Kairos is behind the latest commit on its branch, the header shows an
**Update Kairos** button. Click it:

1. The server fast-forwards the local clone to the latest commit.
2. It exits with a restart signal; the supervisor rebuilds
   (`npm install` **only if dependencies changed**, then `npm run build`).
3. The browser waits for the server to come back and reloads into the new build.

That's the whole loop — the same on macOS, Linux, and Windows. Because we skip
`npm install` unless `package.json`/`package-lock.json` changed, code-only
updates (the common case for feedback fixes) are fast and avoid npm's
optional-dependency native-binary bug.

If the update can't fast-forward (you have local changes that diverge from the
remote), the app says so and leaves your install running the previous build.

## Config and data

- **Provider config:** `~/.kairos/providers.json` — see [homelab.md](homelab.md).
- **Feedback:** the in-app **Feedback** button builds a copyable report; a durable
  copy is written to `~/.kairos/feedback/`.
- **Logs (macOS app):** `~/Library/Logs/Kairos/kairos.log`.

## Manual install (any OS)

If you'd rather not use the installer, the plain flow works everywhere:

```bash
git clone https://github.com/deepuhc/kairos.git
cd kairos
npm install
npm run build
node packages/desktop/supervisor.mjs   # serves + enables in-app updates
# or: npm start                         # serves without the self-update supervisor
```

## Alternatives

- **Standalone `.app` (macOS, no auto-update):** `npm run app:build` bundles a
  self-contained `Kairos.app` (server + UI + launcher) you can zip and hand off.
  It requires only Node 20+ on the target Mac but does **not** self-update. See
  [desktop-app.md](desktop-app.md).
- **Full Tauri installers (`.dmg`/`.msi`/`.deb`):** `npm run desktop:build` —
  native installers with the Tauri auto-updater, but they require a Rust
  toolchain and code-signing/hosting to set up. See [desktop-app.md](desktop-app.md).
