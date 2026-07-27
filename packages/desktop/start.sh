#!/bin/bash
# Start Kairos Desktop in dev mode
# Works on macOS and Linux (Ubuntu)

set -e
cd "$(dirname "$0")"

# --- Helper: kill process on port (cross-platform) ---
kill_port() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
  elif command -v fuser &>/dev/null; then
    fuser -k "$port"/tcp 2>/dev/null || true
  fi
}

# --- Preflight checks ---
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed."
  echo "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo "Error: npx not found. Install Node.js >= 18."
  exit 1
fi

# Install deps if node_modules missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Create default config if missing
CONFIG_DIR="$HOME/.kairos"
CONFIG_FILE="$CONFIG_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$CONFIG_DIR"
  # Auto-detect best available backend
  if command -v ollama &>/dev/null; then
    echo '{"command":"ollama","args":["run","mistral"],"promptMode":"stdin","streamJson":false}' > "$CONFIG_FILE"
    echo "Created config: Ollama + Mistral (local)"
  elif command -v interpreter &>/dev/null; then
    echo '{"command":"interpreter","args":["--model","ollama/mistral"],"promptMode":"stdin","streamJson":false}' > "$CONFIG_FILE"
    echo "Created config: Open Interpreter + Mistral (local)"
  else
    echo '{"command":"ollama","args":["run","mistral"],"promptMode":"stdin","streamJson":false}' > "$CONFIG_FILE"
    echo "Created config: Ollama + Mistral (install ollama first: curl -fsSL https://ollama.ai/install.sh | sh)"
  fi
fi

# Kill stale processes
kill_port 1420
kill_port 9222
sleep 0.3

echo ""
echo "Starting Kairos Desktop..."
echo "  Proxy: ws://localhost:9222 (bridges to agent CLI)"
echo "  UI:    http://localhost:1420"
echo ""

# Start proxy in background
npx tsx scripts/acp-dev-proxy.ts &
PROXY_PID=$!

# Trap to clean up on exit
trap "kill $PROXY_PID 2>/dev/null" EXIT INT TERM

# Start vite (bind to all interfaces so remote access works on Ubuntu)
npx vite --host
