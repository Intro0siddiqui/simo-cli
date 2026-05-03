# Working as a Simo Agent

This guide is for AI agents (like me) and developers who are tasked with maintaining or extending the **Simo CLI** codebase.

## 1. The Nervous System (`extension/background.js`)
*   **The Relay**: All commands from the CLI enter through the `onMessage` handler. 
*   **CDP Dominance**: Prefer `chrome.debugger.sendCommand` over `chrome.scripting.executeScript` whenever possible. It is more robust against Content Security Policies (CSP).
*   **Target Resolution**: Before acting, always call `resolveTarget(tabId, ref)`. This handles the self-healing logic and ensures you are clicking where you think you are.

## 2. The Visual Cortex (`extension/axtree.js`)
*   **Depth Matters**: The default depth is 30. Do not reduce this, as modern SPAs (Instagram/LinkedIn) often bury actionable elements 20+ levels deep.
*   **Box Data**: Any changes to the tree walker must preserve the `box` model calculation, as the `click` and `hover` commands rely on these coordinates.

## 3. Interaction Protocol
*   **Adaptive Lens (Zoom)**: Use `simo snap <id> --ref <ref>` to dive into complex subtrees. This bypasses the global `MAX_DEPTH` and performs a high-resolution walk (Depth 100) on the target.
*   **Grid-Strike**: Use `simo grid <id> <grid_ref> "Column Name"` for massive datasets. This iterates row-by-row with human-like pacing and semantic matching.
*   **Verified Clicks**: Always prefer `simo click <id> <ref> --verify` for mission-critical interactions. This re-scans the AXTree to confirm the state actually changed.
*   **Scrolling**: If an element is off-screen, use `simo scroll <id> <delta>` to bring it into the viewport before clicking.

## 4. Debugging the Relay
*   If commands are timing out, check the `server.py` logs. 
*   Ensure the extension is loaded in "Developer Mode" and the background service worker is active.
*   **Switch Scoping**: When adding new actions to `background.js`, always wrap `case` logic in `{}` blocks to avoid variable redeclaration errors.

## 5. Coding Standards
*   **ES Modules**: The extension uses standard ES Modules (`import/export`). 
*   **Go Synchronization**: If you modify `observer.py` arguments, you MUST also update `main.go` and run `go build -o simo main.go` to keep the binary in sync.

## 6. Roadmap (Deferred Skills)

| Priority | Skill | Description |
|----------|-------|-------------|
| 🔴 High | **Go Relay Port** | Rewrite `server.py` in Go — eliminates Python dependency entirely. |
| 🟡 Medium | **Hardware-Pulse** | Implement `mousePressed` + hold + `mouseReleased` with randomized jitter for anti-bot. |
| 🟢 Low | **Multi-Tab Concurrency** | Verified functional during stress tests. |
| 🟢 Low | **User Guide Expansion** | (Done) Created `troubleshooting.md`. |
