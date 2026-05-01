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
| `./simo serve` | Start the WebSocket relay server (background) |
| `./simo stop` | Stop the relay server |
| `./simo status` | Show open tabs (pretty list) |
| `./simo snap <id> [--ref eN]` | **Adaptive Lens**: High-res snapshot (zoom into ref) |
| `./simo click <id> <ref> [--verify]` | **Verified Strike**: Click and confirm state change |
| `./simo grid <id> <ref> "Query"` | **Grid-Solver**: Atomic row-by-row interaction |
| `./simo scroll <id> <delta>` | **Viewport Control**: Scroll page or element |
| `./simo shot <id> [-o path]` | Take a screenshot (PNG) |
| `./simo hover <id> <ref>` | Hover an element to reveal hidden menus |
| `./simo type <id> <ref> <text>` | **Human-Paced**: Type with randomized delays |
| `./simo nav <id> <url>` | Navigate a tab to a new URL |

### Advanced Capabilities (v1.9.9+)

1.  **The Adaptive Lens**: Use the `--ref` flag on `snap` to perform a targeted "Zoom". This bypasses standard depth limits to resolve deeply nested elements (like individual items in a complex grid) with 100% fidelity.
2.  **Grid-Solver Logic**: The `grid` command automates the "Strike" protocol for surveys. It identifies rows inside a container and systematically clicks columns matching your semantic query (e.g., "Highly Likely").
3.  **Closed-Loop Verification**: Use the `--verify` flag on `click` to eliminate "False Positives." Simo will re-scan the AXTree after the click to ensure the checkbox/radio was actually registered.
4.  **Human-like Pacing**: Every interaction now uses randomized `mousePressed` and `mouseReleased` jitter (40ms-100ms) to bypass basic bot-detection pattern matching.

## Architecture

```
Chrome (CDP) ◄──► Extension ◄──WS:8765──► server.py ◄──► Go Wrapper (simo)
```

- **background.js** — The "Nervous System" (CDP bridge)
- **axtree.js** — The "Visual Cortex" (Semantic filtration)
- **server.py** — The "Relay" (Async WebSocket gateway)
- **main.go** — The "Brain" (Cross-platform CLI orchestrator)

## Documentation
- [Agent Protocol](AGENTS.md) — Technical guide for AI and Human developers.

