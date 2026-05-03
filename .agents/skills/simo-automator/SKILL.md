---
name: simo-skills
description: >
  Controls a live Chrome browser from the terminal using the Simo CLI framework.
  Use this skill whenever the user wants to automate, scrape, interact with, or
  observe a web page — especially on dynamic, JavaScript-heavy platforms like
  Instagram, LinkedIn, or Google. Triggers on requests to click, type, navigate,
  take screenshots, inspect page elements, or perform any multi-step browser
  automation flow. Use it even if the user doesn't say "Simo" explicitly — any
  request to "open a tab", "click a button", "fill in a form", "take a screenshot
  of a page", or "interact with a website" should invoke this skill.
---

# Simo Automator

> **"Trust but Verify."** — Every action is semantic, every result is witnessed.

Simo Automator gives agent direct, stealthy control over a live Chrome browser via the Chrome DevTools Protocol (CDP). It translates high-level intent (e.g., "click the Send button") into low-level, human-emulated browser interactions that bypass standard bot detection. 

---

## System Requirements (Pre-Flight Check)

Before issuing any commands, verify the system is ready:

```bash
simo status          # Must show at least one active tab
```

If you see `Error: Extension not connected`:
1. Run `simo serve` in a separate terminal to start the relay.
2. Reload the Simo extension at `chrome://extensions`.
3. Re-run `simo status`.

---

## Architecture: The Multiplexed Relay Model

Before describing skills, understand the system topology — because every skill operates within these constraints.

```text
[Operator Terminal]
       │  simo <command>
       ▼
[Go Orchestrator: `simo`]
       │  delegates to
       ▼
[Brain: observer.py]
       │  JSON payload over WebSocket
       ▼
[Relay: server.py (ws://localhost:8765)]
       │  forwards to registered extension
       ▼
[Agent: Chrome Extension (background.js)]
       │  CDP commands
       ▼
[Target Browser Tab]
```

**Why this matters for skill design:**
- Commands travel asynchronously. Network latency between the relay and extension is real.
- The extension runs in an isolated browser context — it cannot access `chrome://` internal pages via CDP.
- The relay only accepts one registered extension at a time (`extension_ws`).
- Tab IDs are ephemeral — always run `simo status` to get fresh IDs before acting.

---

## 1. 👁️ Sensory Skills (Perception)

These are Simo's eyes. They determine *what* the agent can see before it acts.

### 1.1 Deep-Sight Semantic Traversal (Adaptive Lens)
- **Standard Command**: `simo snap <tab_id>` — Walks AXTree up to **30 levels deep**.
- **Zoom Command**: `simo snap <tab_id> --ref <ref>` — **Adaptive Lens Mode**. Targeted walk of a specific subtree up to **100 levels deep**. 
- **Why it matters**: Modern SPAs (Instagram/LinkedIn) often bury actionable elements (like message inputs or grid items) 50+ levels deep. Standard snapshots miss these. The Adaptive Lens isolates the target and dives deep without bloating the context with irrelevant sidebar noise.

### 1.2 Spatial Awareness
- Every node in the snapshot includes `[box=cx,cy,w,h]` bounding box data.
- The box stores the **center x**, **center y**, **width**, and **height** in screen pixels.
- The CDP click system derives click coordinates from the box center. **Simo v1.9.9+ automatically handles scrolling** to bring off-screen elements into the viewport if they are not actionable.

### 1.3 Visual Witnessing (Screenshot)
- **Command**: `simo shot <tab_id> [-o path]`
- **What it does**: Captures a full-page screenshot via `Page.captureScreenshot` CDP, saves as `screenshot.png` (or custom path) in the working directory.
- **When to use**: Always after a critical action (sending a message, clicking a submit button, navigating). This is Simo's equivalent of "opening your eyes" to verify the outcome.
- **Protocol**: **Snap → Act → Shot.** Never assume an action succeeded without visual confirmation.

---

## 2. 🖐️ Motor Skills (Interaction)

### 2.1 Hardware-Pulse Typing
- **Command**: `simo type <tab_id> <ref> "<text>"`
- **Human Emulation**: Dispatches character-level events with randomized delays (**40ms–120ms**).
- **Strike Pacing**: Now includes randomized `mousePressed` and `mouseReleased` jitter (50ms–150ms) to defeat pattern-matching bot detection.

### 2.2 Synthetic Hover
- **Command**: `simo hover <tab_id> <ref>`
- **What it does**: Dispatches a `mouseMoved` CDP event to the semantic center of a target element.
- **When to use**: On React-heavy sites, many buttons (e.g., "Unsend", "Delete", "Edit") only *appear* in the AXTree after a hover event triggers a state change. If `snap` doesn't show a button you expect, `hover` a nearby element first, then `snap` again.
- **Critical pattern**: `hover` → `snap` → `click`. This is the unlock sequence for hidden UI.

### 2.3 Viewport Control (Scrolling)
- **Command**: `simo scroll <tab_id> <delta_pixels> [--ref <ref>]`
- **What it does**: Scrolls the window or a specific overflow container.
- **Why**: Essential for infinite-scroll platforms like Reddit or long lists on Instagram where elements are "Hidden" until scrolled into view.

### 2.4 Intent Strike (Click System)
- **Verified Command**: `simo click <tab_id> <ref> [--verify]`
- **Verified Strike**: After clicking, Simo performs a secondary AXTree scan to confirm the element's state actually updated (e.g., checking if a radio button is now `checked: true`).
- **Failure Warning**: If the click is ignored by the site (Shadow State), Simo issues a warning rather than a false positive.

### 2.5 Grid-Solver (The Survey Engine)
- **Command**: `simo grid <tab_id> <grid_ref> "<column_query>"`
- **Atomic Iteration**: Finds all rows inside a grid container and systematically clicks the column matching your query (e.g., "Highly Likely").
- **Pacing**: Includes randomized "Think Time" between row clicks (200ms–600ms) to emulate human survey completion.


### 2.6 Navigation
- **Command**: `simo nav <tab_id> <url>` — Navigate an existing tab.
- **Command**: `simo open <url>` — Open a brand new tab and navigate to URL.
- **Note**: After `nav`, always wait for the page to stabilize before running `snap`. Large SPAs can take 1–3 seconds to hydrate.

### 2.7 JavaScript Execution
- **Command**: `simo exec <tab_id> "<js_code>"`
- **What it does**: Runs arbitrary JavaScript in the page context via `Runtime.evaluate` CDP.
- **Use sparingly**: Prefer CDP-native actions (click, type, hover) over JS execution. Direct JS can be detected by anti-bot scripts that monitor `Runtime.evaluate` calls.


---

## 3. 🧠 Cognitive Skills (Reasoning)

These are Simo's brain. They allow the agent to *recover* from failure and *adapt* to dynamic environments.

### 3.1 Self-Healing Reference Resolution
- **The problem**: After a React re-render, a node's internal `backendNodeId` becomes stale and CDP commands fail.
- **The solution (`resolveTarget`)**: When a `ref` fails to resolve via direct ID, the system automatically:
  1. Re-fetches the full AXTree.
  2. Scans for a node whose `role` AND `name` match the stale node's last known values.
  3. Updates the `backendNodeId` transparently and retries.
- **Result**: The operator never needs to manually re-snap just because a button re-rendered.

### 3.2 Wait-for-Target (`waitForTarget`)
- **Flag**: `--wait` on `click`, `hover`, `type` commands.
- Polls for a target to appear and become actionable for up to **20 retries** with **500ms intervals** (10 seconds total).
- Essential for SPAs where clicking a link triggers an async navigation, and the next element only appears after a network request.

---

## 4. 🥷 Stealth Skills (Evasion)

These are Simo's cloak. They determine how *undetectable* the agent's actions are.

### 4.1 CDP-First Protocol
- All interactions go through the Chrome DevTools Protocol (`chrome.debugger` API), not JavaScript injected into the page.
- CDP operates at the browser engine level — below the JavaScript sandbox where anti-bot scripts live.
- A CDP click is indistinguishable from a click made by a human using Chrome's built-in DevTools.

### 4.2 Passive Relay Model
- The CLI (`simo` binary) never touches the browser directly.
- Commands are translated to JSON and sent over a WebSocket to a lightweight relay (`server.py`), which forwards them to the extension.
- This separation means the target page cannot detect the CLI process via browser fingerprinting or network monitoring.

---

## 5. ⚡ Command Reference

| Command | Syntax | Description |
|---------|--------|-------------|
| `serve` | `simo serve` | Start the WebSocket relay server |
| `status` | `simo status` | List all open browser tabs with IDs |
| `snap` | `simo snap <id> [--ref eN]` | **Adaptive Lens**: High-res snapshot |
| `click` | `simo click <id> <ref> [--verify]` | **Verified Strike**: Click and confirm |
| `grid` | `simo grid <id> <ref> "Query"` | **Grid-Solver**: Atomic row interaction |
| `scroll` | `simo scroll <id> <delta> [--ref eN]` | **Viewport Control**: Scroll page/element |
| `hover` | `simo hover <id> <ref>` | Trigger JS listeners / reveal UI |
| `type` | `simo type <id> <ref> "<text>"` | **Human-Paced**: Type with jitter |
| `shot` | `simo shot <id> [-o path]` | Take a screenshot → `screenshot.png` |
| `drag` | `simo drag <id> <from> <to>` | Physical drag-and-drop interaction |
| `wait` | `simo wait <id> <ref>` | Wait for element to become actionable |
| `wait-text` | `simo wait-text <id> <text>` | Wait for text to appear in AXTree |
| `open` | `simo open <url>` | Open a new tab |
| `nav` | `simo nav <id> <url>` | Navigate existing tab to URL |
| `exec` | `simo exec <id> "<code>"` | Execute arbitrary JavaScript |


---

## 6. 🔁 Standard Operating Procedures

### The "Adaptive Mission" Flow
```bash
1. simo status                          # Get tab ID
2. simo snap <id>                       # Identify container ref (e.g. e29)
3. simo snap <id> --ref e29             # Adaptive Lens: Zoom into the container
4. simo scroll <id> 400 --ref e29       # Bring hidden items into view
5. simo click <id> <target> --verify    # Execute and confirm
6. simo shot <id>                       # Visual verification
```

### Grid Strike (Survey Automation)
```bash
1. simo snap <id>                       # Find grid container ref
2. simo grid <id> <ref> "Highly Likely" # Strike all rows
3. simo click <id> <next_button_ref>    # Proceed to next page
```


