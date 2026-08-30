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

echo "[prepare-bundle] Done. Resources staged under $RES"
