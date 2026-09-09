#!/usr/bin/env bash
# Stages everything the Tauri bundle ships as resources:
#   - the Express+WS server as ONE self-contained CJS file (no node_modules)
#   - the built Lit UI (index.html + assets)
# Both land under src-tauri/resources/ and are declared in tauri.conf.json's
# bundle.resources. main.rs resolves them at runtime via the resource dir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RES="$SCRIPT_DIR/src-tauri/resources"

echo "[prepare-bundle] Building workspace packages…"
cd "$REPO_ROOT"
npm run build

echo "[prepare-bundle] Bundling server into a single file…"
cd "$SCRIPT_DIR"
npx tsup --config tsup.server.ts

echo "[prepare-bundle] Staging UI dist…"
rm -rf "$RES/ui"
mkdir -p "$RES/ui"
cp -R "$REPO_ROOT/packages/ui/dist/." "$RES/ui/"

# --- Embedded Node runtime ----------------------------------------------------
# Ship a Node binary inside the app so users install nothing. The bundled server
# is pure JS (no native modules), so a stock Node binary is sufficient — no
# node-gyp/native-addon rebuild. main.rs runs THIS binary by absolute path, so a
# double-clicked app with a stripped PATH still works.
NODE_VERSION="${KAIROS_NODE_VERSION:-20.18.1}"
DIST_BASE="https://nodejs.org/dist/v${NODE_VERSION}"
RUNTIME="$RES/runtime"
NODE_TMP="$(mktemp -d)"
trap 'rm -rf "$NODE_TMP"' EXIT
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"

echo "[prepare-bundle] Staging embedded Node ${NODE_VERSION} runtime…"

# Extract the `node` binary from a nodejs.org .tar.gz into $2.
fetch_node_targz() {
  local tag="$1" out="$2"
  local tb="node-v${NODE_VERSION}-${tag}.tar.gz"
  curl -fsSL "$DIST_BASE/${tb}" -o "$NODE_TMP/${tb}"
  tar -xzf "$NODE_TMP/${tb}" -C "$NODE_TMP"
  cp "$NODE_TMP/node-v${NODE_VERSION}-${tag}/bin/node" "$out"
  chmod +x "$out"
}

case "$(uname -s)" in
  Darwin)
    # One universal `node` (arm64 + x86_64) to match the universal .dmg.
    fetch_node_targz "darwin-arm64" "$NODE_TMP/node-arm64"
    fetch_node_targz "darwin-x64" "$NODE_TMP/node-x64"
    lipo -create "$NODE_TMP/node-arm64" "$NODE_TMP/node-x64" -output "$RUNTIME/node"
    chmod +x "$RUNTIME/node"
    ;;
  Linux)
    tb="node-v${NODE_VERSION}-linux-x64.tar.xz"
    curl -fsSL "$DIST_BASE/${tb}" -o "$NODE_TMP/${tb}"
    tar -xJf "$NODE_TMP/${tb}" -C "$NODE_TMP"
    cp "$NODE_TMP/node-v${NODE_VERSION}-linux-x64/bin/node" "$RUNTIME/node"
    chmod +x "$RUNTIME/node"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    zip="node-v${NODE_VERSION}-win-x64.zip"
    curl -fsSL "$DIST_BASE/${zip}" -o "$NODE_TMP/${zip}"
    # Git Bash's tar can't unzip; use PowerShell with Windows-native paths.
    winzip="$(cygpath -w "$NODE_TMP/${zip}")"
    windst="$(cygpath -w "$NODE_TMP/node-win")"
    powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '$winzip' -DestinationPath '$windst'"
    cp "$NODE_TMP/node-win/node-v${NODE_VERSION}-win-x64/node.exe" "$RUNTIME/node.exe"
    ;;
  *)
    echo "[prepare-bundle] WARNING: unrecognized OS '$(uname -s)'; embedded Node not staged."
    ;;
esac

echo "[prepare-bundle] Done. Resources staged under $RES"
