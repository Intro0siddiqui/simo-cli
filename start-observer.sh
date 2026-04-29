#!/bin/bash
# Start the Spectre relay server in the background.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="$SCRIPT_DIR/.venv/bin/python"

echo "[Spectre] Starting relay server on ws://127.0.0.1:8765 …"
nohup "$PYTHON" "$SCRIPT_DIR/server.py" > /dev/null 2>&1 &
echo "[Spectre] Server started (PID $!)."
