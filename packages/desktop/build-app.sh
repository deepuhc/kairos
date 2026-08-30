#!/usr/bin/env bash
#
# Build a self-contained, downloadable Kairos.app for macOS — WITHOUT Rust/Tauri.
#
# Why this exists: the full Tauri bundle (npm run desktop:build) needs a Rust
# toolchain to compile the shell. This machine has no Rust, and the tester on
# the other Mac shouldn't need it either. A macOS .app is just a directory tree
# with a known layout, so we assemble one by hand:
#
#   Kairos.app/Contents/
#     Info.plist          — makes Finder/Launchpad treat it as an app
#     MacOS/Kairos        — launcher: starts the bundled server, opens the browser
#     Resources/
#       kairos.icns       — Dock/Finder icon
#       server/           — the single-file CJS server bundle (no node_modules)
#       ui/               — the built UI (served by the bundled server)
#
# The ONLY runtime requirement on the target Mac is Node.js 20+. There is no
# npm install (which sidesteps the npm optionalDependencies native-binary
# hazard) and no Rust compile. Ship the resulting Kairos.app in a .zip; the
# tester unzips, right-click → Open (first launch, unsigned), and it runs.
#
# Usage:  bash build-app.sh            # builds packages, then assembles the app
#         bash build-app.sh --no-build # skip the npm build, just re-assemble
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
DIST_DIR="$DESKTOP_DIR/dist-app"
APP="$DIST_DIR/Kairos.app"
VERSION="$(node -p "require('$DESKTOP_DIR/package.json').version" 2>/dev/null || echo 0.1.0)"

log() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }

if [ "${1:-}" != "--no-build" ]; then
  log "Building workspace packages (server + UI)…"
  ( cd "$REPO_ROOT" && npm run build )
  log "Bundling the server into a single self-contained file…"
  ( cd "$DESKTOP_DIR" && npx tsup --config tsup.server.ts )
fi

# Sanity: the two artifacts the app depends on must exist.
SERVER_BUNDLE="$DESKTOP_DIR/src-tauri/resources/server/kairos-server.js"
UI_DIST="$REPO_ROOT/packages/ui/dist"
[ -f "$SERVER_BUNDLE" ] || { echo "ERROR: server bundle missing: $SERVER_BUNDLE (run without --no-build)"; exit 1; }
[ -f "$UI_DIST/index.html" ] || { echo "ERROR: UI dist missing: $UI_DIST/index.html (run without --no-build)"; exit 1; }

log "Assembling $APP …"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/server" "$APP/Contents/Resources/ui"

cp "$SERVER_BUNDLE" "$APP/Contents/Resources/server/kairos-server.js"
cp -R "$UI_DIST/." "$APP/Contents/Resources/ui/"

# Icon (optional — Finder falls back to a generic icon if absent).
if [ -f "$DESKTOP_DIR/src-tauri/icons/icon.icns" ]; then
  cp "$DESKTOP_DIR/src-tauri/icons/icon.icns" "$APP/Contents/Resources/kairos.icns"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kairos</string>
  <key>CFBundleDisplayName</key><string>Kairos</string>
  <key>CFBundleIdentifier</key><string>com.kairos.app</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Kairos</string>
  <key>CFBundleIconFile</key><string>kairos.icns</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# The launcher. Kept POSIX-simple so it runs under whatever /bin/sh macOS ships.
# It finds a Node 20+, picks a free port, starts the bundled server pointed at
# the bundled UI, waits for the port, then opens the default browser. It logs to
# ~/Library/Logs/Kairos so a tester can attach the log to a feedback report.
cat > "$APP/Contents/MacOS/Kairos" <<'LAUNCHER'
#!/bin/sh
# Kairos launcher — starts the bundled server and opens the browser.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
RES="$(cd "$HERE/../Resources" && pwd)"
SERVER="$RES/server/kairos-server.js"
UI="$RES/ui"

LOG_DIR="$HOME/Library/Logs/Kairos"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/kairos.log"

# Locate a Node 20+. GUI apps don't inherit a login shell's PATH, so probe the
# common install locations in addition to whatever PATH we do have.
find_node() {
  for c in \
    "$(command -v node 2>/dev/null)" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node \
    /usr/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    major="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 20 ] 2>/dev/null; then echo "$c"; return 0; fi
  done
  return 1
}

NODE="$(find_node)" || {
  osascript -e 'display alert "Kairos needs Node.js 20+" message "Install Node.js 20 or newer from https://nodejs.org, then reopen Kairos." as critical' >/dev/null 2>&1
  echo "$(date): no Node 20+ found on PATH" >> "$LOG"
  exit 1
}

# Pick a free port so multiple copies / a busy 3333 don't collide.
PORT="$("$NODE" -e 'const n=require("net"),s=n.createServer();s.listen(0,()=>{const p=s.address().port;s.close(()=>console.log(p))})' 2>/dev/null || echo 3333)"

echo "$(date): starting Kairos on port $PORT with $NODE" >> "$LOG"
KAIROS_UI_DIST="$UI" PORT="$PORT" "$NODE" "$SERVER" >> "$LOG" 2>&1 &
SERVER_PID=$!

# Wait (up to ~15s) for the server to accept connections, then open the browser.
i=0
while [ "$i" -lt 60 ]; do
  if "$NODE" -e 'require("net").connect('"$PORT"',"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' 2>/dev/null; then
    break
  fi
  # Server died during startup? Surface the tail of the log.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    osascript -e 'display alert "Kairos failed to start" message "The bundled server exited during startup. See ~/Library/Logs/Kairos/kairos.log." as critical' >/dev/null 2>&1
    exit 1
  fi
  i=$((i + 1))
  sleep 0.25
done

open "http://localhost:$PORT"

# Keep the launcher alive so the Dock icon maps to the running server; when the
# user quits the app, take the server down with it.
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM
wait "$SERVER_PID"
LAUNCHER
chmod +x "$APP/Contents/MacOS/Kairos"

# Package it for download. A zip preserves the executable bit and is the
# friendliest thing to hand to a tester.
log "Zipping for download…"
ZIP="$DIST_DIR/Kairos-macos-$VERSION.zip"
rm -f "$ZIP"
( cd "$DIST_DIR" && ditto -c -k --keepParent "Kairos.app" "$ZIP" )

log "Done."
echo
echo "  App:   $APP"
echo "  Zip:   $ZIP"
echo
echo "  Send the .zip to the other Mac. There: unzip, then right-click Kairos.app"
echo "  → Open (first launch only, because it's unsigned). Requires Node.js 20+."
