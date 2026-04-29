# Working as a Simo Agent

This guide is for AI agents (like me) and developers who are tasked with maintaining or extending the **Simo CLI** codebase.

## 1. The Nervous System (`background.js`)
*   **The Relay**: All commands from the CLI enter through the `onMessage` handler. 
*   **CDP Dominance**: Prefer `chrome.debugger.sendCommand` over `chrome.scripting.executeScript` whenever possible. It is more robust against Content Security Policies (CSP).
*   **Target Resolution**: Before acting, always call `resolveTarget(tabId, ref)`. This handles the self-healing logic and ensures you are clicking where you think you are.

## 2. The Visual Cortex (`axtree.js`)
*   **Depth Matters**: The default depth is 30. Do not reduce this, as modern SPAs (Instagram/LinkedIn) often bury actionable elements 20+ levels deep.
*   **Box Data**: Any changes to the tree walker must preserve the `box` model calculation, as the `click` and `hover` commands rely on these coordinates.

## 3. Interaction Protocol
*   **Hover First**: On React-heavy sites, many buttons only manifest in the Accessibility Tree after a hover event. If a button is missing, try `./obs hover <id> <nearby_element>` first.
*   **Verify with `shot`**: After a critical action (sending a message, unsending), always take a screenshot via `./obs shot` to verify the state visually.
*   **Wait for Stability**: Use the `--wait` flag in CLI commands to ensure the extension polls for the element if it's currently being hydrated.

## 4. Debugging the Relay
*   If commands are timing out, check the `server.py` logs. 
*   Ensure the extension is loaded in "Developer Mode" and the background service worker is active.
*   **Tab IDs**: Tab IDs are ephemeral. Always run `./obs` to get the current valid ID before starting an interaction loop.

## 5. Coding Standards
*   **ES Modules**: The extension uses standard ES Modules (`import/export`). 
*   **Async/Await**: The entire relay and CLI are asynchronous. Avoid blocking calls.
*   **Stealth**: Never use `document.querySelector` directly for interactions unless the CDP path fails. CDP is our stealth shield.
