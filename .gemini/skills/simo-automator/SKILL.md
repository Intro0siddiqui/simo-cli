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
./simo status          # Must show at least one active tab
```

If you see `Error: Extension not connected`:
1. Run `./simo serve` in a separate terminal to start the relay.
2. Reload the Simo extension at `chrome://extensions`.
3. Re-run `./simo status`.

---

## Architecture: The Multiplexed Relay Model

Before describing skills, understand the system topology — because every skill operates within these constraints.

```text
[Operator Terminal]
       │  ./simo <command>
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
- Tab IDs are ephemeral — always run `./simo status` to get fresh IDs before acting.

---

## 1. 👁️ Sensory Skills (Perception)

These are Simo's eyes. They determine *what* the agent can see before it acts.

### 1.1 Deep-Sight Semantic Traversal
- **Command**: `./simo snap <tab_id>`
- **What it does**: Walks the full Accessibility Tree (AXTree) via `Accessibility.getFullAXTree` CDP command, up to **30 levels deep**.
- **Why AXTree over DOM**: Modern SPAs (React, Vue, Angular) re-render the DOM constantly. The AXTree is stable — it reflects *semantic roles* (button, textbox, link) and *names* (what screen readers see), not transient CSS classes or JavaScript state.
- **Output format**: A YAML-like tree where each node is assigned a stable `[eN]` reference and enriched with bounding box coordinates `[box=x,y,w,h]`.
- **Key rule**: Never reduce the traversal depth below 30. Instagram and LinkedIn bury actionable elements 20+ levels deep inside their virtual DOM trees.

### 1.2 Spatial Awareness
- Every node in the snapshot includes `[box=x,y,w,h]` bounding box data.
- The box stores the **left-edge x**, **top-edge y**, **width**, and **height** in screen pixels.
- The CDP click system derives click coordinates from the box center: `cx = x + w/2`, `cy = y + h/2`.
- This is essential for the `raw_click` command when you need to click a coordinate directly, bypassing node resolution.

### 1.3 Visual Witnessing (Screenshot)
- **Command**: `./simo shot <tab_id>`
- **What it does**: Captures a full-page screenshot via `Page.captureScreenshot` CDP, saves as `screenshot.png` in the working directory.
- **When to use**: Always after a critical action (sending a message, clicking a submit button, navigating). This is Simo's equivalent of "opening your eyes" to verify the outcome.
- **Protocol**: **Snap → Act → Shot.** Never assume an action succeeded without visual confirmation.

---

## 2. 🖐️ Motor Skills (Interaction)

These are Simo's hands. They determine *how* the agent can manipulate the browser.

### 2.1 Hardware-Pulse Typing
- **Command**: `./simo type <tab_id> <ref> "<text>"`
- **What it does**: Dispatches character-level `keyDown → char → keyUp` CDP events for each character, with a randomized delay of **40ms–120ms** per keystroke.
- **Why not `insertText`**: Platforms like Instagram and LinkedIn listen for native keyboard events. Synthetic `insertText` is trivially detected. Hardware-Pulse emulates the timing signature of real human typing, bypassing event-level bot detection.
- **Optional**: Use `--wait` to poll for the element to appear before typing.

### 2.2 Synthetic Hover
- **Command**: `./simo hover <tab_id> <ref>`
- **What it does**: Dispatches a `mouseMoved` CDP event to the semantic center of a target element.
- **When to use**: On React-heavy sites, many buttons (e.g., "Unsend", "Delete", "Edit") only *appear* in the AXTree after a hover event triggers a state change. If `snap` doesn't show a button you expect, `hover` a nearby element first, then `snap` again.
- **Critical pattern**: `hover` → `snap` → `click`. This is the unlock sequence for hidden UI.

### 2.3 Intent Strike (Click System)
- **Command**: `./simo click <tab_id> <ref> [--wait]`
- **What it does**: A three-tier execution model designed to handle the full spectrum of browser behavior:

| Tier | Method | When Used |
|------|--------|-----------|
| **1. Coordinate Strike** | CDP `dispatchMouseEvent` (move → press → release) | Default path — clean and stealthy |
| **2. DOM Fallback** | `Runtime.callFunctionOn` with `this.click()` | When CDP coordinates are rejected |
| **3. Stability Check** | `DOM.getBoxModel` polling (10 retries, 100ms interval) | Before every click to ensure element isn't loading/moving |

### 2.4 Navigation
- **Command**: `./simo nav <tab_id> <url>` — Navigate an existing tab.
- **Command**: `./simo open <url>` — Open a brand new tab and navigate to URL.
- **Note**: After `nav`, always wait for the page to stabilize before running `snap`. Large SPAs can take 1–3 seconds to hydrate.

### 2.5 JavaScript Execution
- **Command**: `./simo exec <tab_id> "<js_code>"`
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
| `serve` | `./simo serve` | Start the WebSocket relay server |
| `status` | `./simo status` | List all open browser tabs with IDs |
| `open` | `./simo open <url>` | Open a new tab |
| `nav` | `./simo nav <tab_id> <url>` | Navigate existing tab to URL |
| `snap` | `./simo snap <tab_id>` | Get semantic AXTree snapshot |
| `shot` | `./simo shot <tab_id>` | Take a screenshot → `screenshot.png` |
| `click` | `./simo click <tab_id> <ref> [--wait]` | Click an element by ref |
| `hover` | `./simo hover <tab_id> <ref> [--wait]` | Hover over an element |
| `type` | `./simo type <tab_id> <ref> "<text>" [--wait]` | Type text into an element |
| `drag` | `./simo drag <tab_id> <from_ref> <to_ref>` | Drag element to another element |
| `exec` | `./simo exec <tab_id> "<js_code>"` | Execute JavaScript in tab context |

---

## 6. 🔁 Standard Operating Procedures

### High-Stakes Interaction Flow (Instagram/LinkedIn)
```bash
1. ./simo status                          # Get current tab IDs
2. ./simo snap <tab_id>                   # See the semantic landscape
3. ./simo hover <tab_id> <nearby_ref>     # Unlock hidden elements if needed
4. ./simo snap <tab_id>                   # Re-scan after hover
5. ./simo click <tab_id> <target_ref>     # Execute the Intent Strike
6. ./simo shot <tab_id>                   # Witness the outcome visually
```

### Recovering from a Stale Ref
```bash
1. ./simo snap <tab_id>                   # Re-scan the tree
2.  Check new snapshot for same role/name # Find the re-rendered element
3. ./simo click <tab_id> <new_ref>        # Strike with updated ref
```

