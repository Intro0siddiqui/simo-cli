#!/bin/bash
# Set up the Spectre extension — create venv and install dependencies.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV" ]; then
    echo "[Spectre] Creating virtual environment…"
    python3 -m venv "$VENV"
fi

echo "[Spectre] Installing dependencies…"
"$VENV/bin/pip" install --quiet --upgrade websockets

echo ""
echo "[Spectre] Setup complete."
echo ""
echo "  1. Open Chrome → chrome://extensions"
echo "  2. Enable Developer mode"
echo "  3. Click 'Load unpacked' → select this folder"
echo ""
echo "Then use:"
echo "  ./start-observer.sh   — start the relay server"
echo "  ./status.sh           — check status and view tabs"
echo "  ./status.sh --json    — JSON output"
echo ""
