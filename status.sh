#!/bin/bash
# Check relay status and query open tabs from the Spectre extension.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="$SCRIPT_DIR/.venv/bin/python"
PORT=8765

JSON_FLAG=false
DIRECT_FLAG=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --json)   JSON_FLAG=true;  shift ;;
        --direct) DIRECT_FLAG=true; shift ;;
        *) shift ;;
    esac
done

# Ensure the relay server is running
if ! ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
    echo "[Spectre] Relay server is not running."
    if [[ "$DIRECT_FLAG" == true ]]; then
        echo "[Spectre] Starting relay server…"
        "$SCRIPT_DIR/start-observer.sh"

        # Wait for relay server to accept connections (up to 10s)
        echo "[Spectre] Waiting for relay server…"
        for i in $(seq 1 10); do
            if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
                break
            fi
            sleep 1
        done

        # Poll until extension connects (handles backoff, up to 30s)
        echo "[Spectre] Waiting for extension to connect…"
        CONNECTED=false
        for attempt in $(seq 1 30); do
            if "$PYTHON" "$SCRIPT_DIR/observer.py" > /dev/null 2>&1; then
                CONNECTED=true
                break
            fi
            sleep 1
        done

        if [[ "$CONNECTED" == false ]]; then
            echo "[Spectre] Extension did not connect within 30s."
            exit 1
        fi

        # Extension is connected — run the actual query
        if [[ "$JSON_FLAG" == true ]]; then
            "$PYTHON" "$SCRIPT_DIR/observer.py" --json
        else
            "$PYTHON" "$SCRIPT_DIR/observer.py"
        fi
        exit 0
    else
        echo "         Start it with: ./start-observer.sh"
        echo "         Or run:        ./status.sh --direct"
        exit 1
    fi
fi

# Query tabs
if [[ "$JSON_FLAG" == true ]]; then
    "$PYTHON" "$SCRIPT_DIR/observer.py" --json
else
    "$PYTHON" "$SCRIPT_DIR/observer.py"
fi
