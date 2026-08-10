#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

echo "Building all packages..."
cd "$REPO_ROOT"
npm run build

echo "Starting Kairos server..."
node packages/server/dist/main.js &
SERVER_PID=$!

echo "Server started (PID $SERVER_PID)"

# Give the server a moment to bind the port
sleep 1

echo "Opening http://localhost:3333 in default browser..."
if command -v open &>/dev/null; then
  open "http://localhost:3333"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:3333"
elif command -v start &>/dev/null; then
  start "http://localhost:3333"
fi

echo "Press Ctrl+C to stop the server."
wait "$SERVER_PID"
