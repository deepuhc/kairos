#!/bin/bash
# Kairos Dashboard Launcher
#
# This is the ONLY supported way to start Kairos.
# It ensures auth tokens are present by running inside a devai session if needed.
#
# Usage: ./start.sh

set -e

# Kill any existing instance
lsof -ti :${KAIROS_PORT:-3000} 2>/dev/null | xargs kill -9 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$SCRIPT_DIR/packages/web/dist/server.js"

# If auth token is already set (e.g., inside a devai/claude session), just run.
if [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then
  exec node "$SERVER" "$@"
fi

# Try devai env to get tokens
eval "$(devai env 2>/dev/null)" || true
if [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then
  exec node "$SERVER" "$@"
fi

# Last resort: wrap in a devai session
echo "  Starting Kairos inside devai session (for auth)..."
exec devai launch node "$SERVER" "$@"
