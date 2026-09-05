#!/bin/sh
# Double-click this file to install Kairos on macOS.
#
# It checks for git + Node.js 20+, downloads the installer, and runs it. The
# installer clones Kairos to ~/Kairos, installs dependencies, builds, and creates
# a double-clickable Kairos.app. After that, updates are one click inside the app.
#
# First launch: macOS may block an unsigned downloaded script — if so, right-click
# this file → Open, or run `xattr -d com.apple.quarantine "Install Kairos (macOS).command"`.

RAW="https://raw.githubusercontent.com/deepuhc/kairos/main/install/kairos-install.mjs"

echo "Kairos installer"
echo "================"

# git check
if ! command -v git >/dev/null 2>&1; then
  osascript -e 'display alert "Git is required" message "Install the Xcode Command Line Tools (xcode-select --install) or Git from https://git-scm.com, then re-run." as critical' 2>/dev/null
  echo "Error: git not found. Install it and re-run."
  exit 1
fi

# Node 20+ check (probe common locations; a double-clicked script gets a bare PATH)
NODE=""
for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node /usr/bin/node; do
  [ -x "$c" ] || continue
  m="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$m" -ge 20 ] 2>/dev/null; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  osascript -e 'display alert "Node.js 20+ is required" message "Install Node.js 20 or newer from https://nodejs.org, then re-run this installer." as critical' 2>/dev/null
  echo "Error: Node.js 20+ not found. Get it from https://nodejs.org and re-run."
  exit 1
fi

TMP="$(mktemp -t kairos-install-XXXXXX).mjs"
echo "Downloading installer…"
if ! curl -fsSL "$RAW" -o "$TMP"; then
  echo "Error: could not download the installer from $RAW"
  exit 1
fi

echo "Running installer with $NODE…"
"$NODE" "$TMP"
STATUS=$?
rm -f "$TMP"

echo ""
if [ "$STATUS" -eq 0 ]; then
  echo "Install complete. Look for Kairos.app in ~/Kairos (double-click it, or move it to /Applications)."
else
  echo "Install did not complete (exit $STATUS)."
fi
echo "Press Return to close."
read _ignored
