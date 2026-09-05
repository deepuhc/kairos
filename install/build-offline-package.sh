#!/usr/bin/env bash
#
# Build a fully self-contained, GitHub-free Kairos installer package.
#
# The output zip carries the entire repo history as a single git bundle plus the
# installer scripts, so a tester can install with ZERO network access to GitHub:
# copy the zip (AirDrop/USB), unzip, double-click the installer for their OS. The
# installer clones from the bundled history to ~/Kairos, npm-installs, builds
# (auto-repairing the npm native-binary bug), and creates a double-clickable
# launcher wired to the self-update supervisor.
#
# npm install still needs the npm registry (that's how JS deps work); what this
# removes is any dependency on the Kairos repo being reachable on GitHub.
#
# Usage:  bash install/build-offline-package.sh
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$INSTALL_DIR/.." && pwd)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
OUT_DIR="$REPO_ROOT/dist-offline"
STAGE="$OUT_DIR/Kairos-Installer"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version || require('$REPO_ROOT/packages/desktop/package.json').version" 2>/dev/null || echo 0.1.0)"

log() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }

log "Packaging Kairos ($BRANCH @ $(git -C "$REPO_ROOT" rev-parse --short HEAD)) for offline install"

rm -rf "$STAGE"
mkdir -p "$STAGE"

# 1. The whole repo history as one file.
log "Creating git bundle…"
git -C "$REPO_ROOT" bundle create "$STAGE/kairos.bundle" --all

# 2. The installer core + a manifest so the entry points know the branch.
cp "$INSTALL_DIR/kairos-install.mjs" "$STAGE/kairos-install.mjs"
cat > "$STAGE/manifest.json" <<JSON
{ "branch": "$BRANCH", "version": "$VERSION" }
JSON

# 3. Double-clickable entry points that install FROM THE BUNDLE (offline).
#    They locate a Node, then run the installer core with KAIROS_BUNDLE set.

# macOS
cat > "$STAGE/Install Kairos (macOS).command" <<MAC
#!/bin/sh
# Double-click to install Kairos (offline — no GitHub needed).
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
BRANCH="\$(node -p "require('\$DIR/manifest.json').branch" 2>/dev/null || echo $BRANCH)"
NODE=""
for c in "\$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "\$HOME/.nvm/versions/node"/*/bin/node /usr/bin/node; do
  [ -x "\$c" ] || continue
  m="\$("\$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "\$m" -ge 20 ] 2>/dev/null; then NODE="\$c"; break; fi
done
if [ -z "\$NODE" ]; then
  osascript -e 'display alert "Node.js 20+ is required" message "Install Node.js 20+ from https://nodejs.org, then re-run this installer." as critical' 2>/dev/null
  echo "Node.js 20+ not found. Get it from https://nodejs.org and re-run."; echo "Press Return to close."; read _; exit 1
fi
KAIROS_BUNDLE="\$DIR/kairos.bundle" KAIROS_BRANCH="\$BRANCH" "\$NODE" "\$DIR/kairos-install.mjs"
STATUS=\$?
echo ""; [ "\$STATUS" -eq 0 ] && echo "Done. Kairos.app is in ~/Kairos — double-click it or move it to /Applications." || echo "Install did not complete (exit \$STATUS)."
echo "Press Return to close."; read _
MAC
chmod +x "$STAGE/Install Kairos (macOS).command"

# Linux
cat > "$STAGE/install-linux.sh" <<LNX
#!/usr/bin/env bash
# Run to install Kairos on Linux (offline — no GitHub needed).
set -eu
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BRANCH="\$(node -p "require('\$DIR/manifest.json').branch" 2>/dev/null || echo $BRANCH)"
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required. Get it from https://nodejs.org and re-run."; exit 1; }
m="\$(node -p 'process.versions.node.split(".")[0]')"
[ "\$m" -ge 20 ] || { echo "Node.js 20+ is required (found \$(node -v))."; exit 1; }
KAIROS_BUNDLE="\$DIR/kairos.bundle" KAIROS_BRANCH="\$BRANCH" node "\$DIR/kairos-install.mjs"
LNX
chmod +x "$STAGE/install-linux.sh"

# Windows
cat > "$STAGE/Install Kairos (Windows).bat" <<'WIN'
@echo off
REM Double-click to install Kairos (offline — no GitHub needed).
setlocal
set DIR=%~dp0
where node >nul 2>&1 || (echo Node.js 20+ is required. Get it from https://nodejs.org and re-run. & pause & exit /b 1)
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 (echo Node.js 20+ is required. Get it from https://nodejs.org and re-run. & pause & exit /b 1)
for /f "delims=" %%b in ('node -p "require('%DIR%manifest.json').branch"') do set BRANCH=%%b
set KAIROS_BUNDLE=%DIR%kairos.bundle
set KAIROS_BRANCH=%BRANCH%
node "%DIR%kairos-install.mjs"
echo.
pause
WIN

# 4. A short README inside the package.
cat > "$STAGE/READ ME FIRST.txt" <<TXT
Kairos — offline installer
==========================

Requirements: Git and Node.js 20+ on this machine.
  - Node: https://nodejs.org  (get version 20 or newer)
  - Git:  https://git-scm.com

To install:
  - macOS:   double-click "Install Kairos (macOS).command"
             (first time: right-click it -> Open, to get past Gatekeeper)
  - Windows: double-click "Install Kairos (Windows).bat"
  - Linux:   run  bash install-linux.sh

This installs Kairos to your home folder (~/Kairos), builds it, and creates a
launcher you can double-click. It needs the internet only to download JavaScript
dependencies from npm — it does NOT need access to the Kairos GitHub repo.

Updating later:
  Once this machine can reach GitHub, the in-app "Update Kairos" button will
  fetch and apply new versions with one click. Until then, you can install a
  newer offline package the same way — it updates in place.
TXT

# 5. Zip it.
log "Zipping…"
ZIP="$OUT_DIR/Kairos-Installer-$VERSION.zip"
rm -f "$ZIP"
( cd "$OUT_DIR" && (command -v ditto >/dev/null 2>&1 && ditto -c -k --keepParent "Kairos-Installer" "$ZIP" || zip -qr "$ZIP" "Kairos-Installer") )

log "Done."
echo
echo "  Package: $ZIP"
echo "  Contents: git bundle + installer + per-OS double-click entry points"
echo
echo "  Copy the zip to the other machine (AirDrop/USB/etc), unzip, and run the"
echo "  installer for that OS. No GitHub access required."
