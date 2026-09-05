#!/usr/bin/env bash
# One-line Kairos installer for macOS and Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/deepuhc/kairos/main/install/install.sh | bash
#
# Checks for git + Node.js 20+, downloads the installer, and runs it. The
# installer clones Kairos to ~/Kairos, installs dependencies, builds, and creates
# a double-clickable launcher (Kairos.app on macOS, an app-menu entry on Linux).
set -eu

RAW="https://raw.githubusercontent.com/deepuhc/kairos/main/install/kairos-install.mjs"

echo "Kairos installer"
echo "================"

command -v git >/dev/null 2>&1 || { echo "Error: git is required. Install it and re-run."; exit 1; }

# Find Node 20+.
NODE=""
for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node /usr/bin/node; do
  [ -x "$c" ] || continue
  m="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$m" -ge 20 ] 2>/dev/null; then NODE="$c"; break; fi
done
[ -n "$NODE" ] || { echo "Error: Node.js 20+ is required. Get it from https://nodejs.org and re-run."; exit 1; }

TMP="$(mktemp).mjs"
echo "Downloading installer…"
curl -fsSL "$RAW" -o "$TMP" || { echo "Error: could not download $RAW"; exit 1; }

echo "Running installer with $NODE…"
"$NODE" "$TMP"
rm -f "$TMP"
