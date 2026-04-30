# Simo CLI — Agentic Browser Control

Remote Chrome tab monitor and controller — query and manipulate open tabs from your terminal via a lightweight WebSocket relay. Designed for high-stakes agentic automation.

## Quick Start

```bash
./install.sh
```

Then load the extension in Chrome:

1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension` directory inside this project

## Usage

The `obs` command is your unified entry point for monitoring and control.

| Command | Description |
|---|---|
| `./start-observer.sh` | Start the relay server (background) |
| `./obs` | Show open tabs (pretty list) |
| `./obs snap <tab_id>` | Get a YAML ARIA snapshot (Playwright-grade) |
| `./obs shot <tab_id> [-o path]` | Take a screenshot (PNG) |
| `./obs hover <tab_id> <ref>` | Hover an element to reveal hidden menus |
| `./obs click <tab_id> <ref>` | Click an element (e.g. `e1`) using CDP mouse events |
| `./obs type <tab_id> <ref> <text>` | Focus element and type text (Hardware-emulated) |
| `./obs drag <tab_id> <from> <to>` | Drag an element to another element |
| `./obs nav <tab_id> <url>` | Navigate a tab to a new URL |
| `./obs exec <tab_id> <code>` | Execute JS code (with CDP fallback) |
| `./obs status --json` | Show open tabs as JSON |

### Quick Examples

```bash
./obs                        # List tabs, find ID (e.g. 42)
./obs snap 42                # View tree, find input ref (e.g. e3)
./obs hover 42 e1            # Hover to reveal menu
./obs type 42 e3 "Hello"     # Fill in a text field
./obs click 42 e7            # Submit / click a button
```

### Intelligence Layer
Simo CLI v1.9.9 includes a "Self-Healing" interaction layer. When you perform a `click`, `type`, or `hover`, the engine automatically:
1.  **Verifies the Target**: Checks if the reference ID (`ref`) is still valid and present.
2.  **Semantic Recovery**: If the ID is "stale" (common on dynamic React sites), it re-scans the accessibility tree to find the best match by role and name.
3.  **Hardware Emulation**: Dispatches low-level mouse and keyboard events that are indistinguishable from human input.

## Architecture

```
Chrome Extension  ◄──WS:8765──►  server.py (relay)  ◄──WS:8765──►  observer.py (CLI)
```

- **background.js** — persistent service worker, reconnects with exponential backoff
- **server.py** — lightweight asyncio WebSocket relay
- **observer.py** — CLI client that queries tabs through the relay

## Documentation
- [Agent Skills](skills.md) — Detailed sensory and motor capabilities.
- [Working with Agent](agent.md) — Guide for developers and AI agents.

## Pro Tips

### Suppress Debugger Banner
To avoid the persistent "Spectre started debugging this browser" banner, launch Chrome with:
```bash
google-chrome --silent-debugger-extension-api
```
Essential for stealthy automation on sites with strict security.
