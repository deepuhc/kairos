#!/bin/bash
# Kairos Desktop — Ubuntu setup script
# Run this once after cloning the repo on your Ubuntu machine.
#
# Usage: bash setup-ubuntu.sh

set -e
cd "$(dirname "$0")"

echo "=== Kairos Desktop — Ubuntu Setup ==="
echo ""

# 1. Check/install Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    echo "[ok] Node.js $(node --version)"
  else
    echo "[!] Node.js $(node --version) is too old. Need >= 18."
    echo "    Run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
  fi
else
  echo "[!] Node.js not found. Installing..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
  echo "[ok] Node.js $(node --version) installed"
fi

# 2. Check Ollama
if command -v ollama &>/dev/null; then
  echo "[ok] Ollama installed"
  # Check if mistral model is pulled
  if ollama list 2>/dev/null | grep -q "mistral"; then
    echo "[ok] mistral model available"
  else
    echo "[..] Pulling mistral model (this takes a few minutes)..."
    ollama pull mistral
    echo "[ok] mistral model ready"
  fi
else
  echo "[!] Ollama not found."
  echo "    Install: curl -fsSL https://ollama.ai/install.sh | sh"
  echo "    Then: ollama pull mistral"
  echo ""
  echo "    Continuing setup — you'll need Ollama before running Kairos."
fi

# 3. Install npm dependencies
echo ""
echo "[..] Installing npm dependencies..."
npm install
echo "[ok] Dependencies installed"

# 4. Create config
CONFIG_DIR="$HOME/.kairos"
CONFIG_FILE="$CONFIG_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_FILE" << 'EOF'
{
  "command": "ollama",
  "args": ["run", "mistral"],
  "promptMode": "stdin",
  "streamJson": false
}
EOF
  echo "[ok] Config created at $CONFIG_FILE"
else
  echo "[ok] Config exists at $CONFIG_FILE"
fi

# 5. Optional: check for other tools
echo ""
echo "--- Optional tools detected ---"
command -v interpreter &>/dev/null && echo "  [ok] Open Interpreter" || echo "  [ ] Open Interpreter (pip install open-interpreter)"
command -v goose &>/dev/null && echo "  [ok] Goose" || echo "  [ ] Goose"
command -v claude &>/dev/null && echo "  [ok] Claude Code" || echo "  [ ] Claude Code (cloud, needs API key)"
echo ""

# 6. Done
echo "=== Setup complete ==="
echo ""
echo "To start Kairos Desktop:"
echo "  ./start.sh"
echo ""
echo "Then open http://localhost:1420 in your browser."
echo "Press Cmd+N (or Ctrl+N) to create an agent."
