# Agent Skills: Simo CLI v1.9.9

This document outlines the core sensory and motor skills of the **Simo** agentic framework, derived from high-stakes interaction experience on dynamic platforms like Instagram and LinkedIn.

## 1. Sensory Skills (Perception)
*   **Deep-Sight Semantic Traversal**: Ability to walk the Accessibility Tree (AXTree) up to 30 levels deep. This bypasses the complexity of the traditional DOM and sees the page as an assistive technology would (Roles, Names, States).
*   **Spatial Awareness**: Every node in the semantic tree is enriched with bounding box data (`[box=x,y,w,h]`). Simo knows exactly where an element is on the physical screen.
*   **Visual Witnessing**: Integrated CDP screenshot capabilities. Simo doesn't just guess from text; it captures real pixels to verify the state of the interface.
*   **Deduplication**: Intelligent filtering of redundant nodes in deeply nested React structures to provide a clean, actionable view of the tab.

## 2. Motor Skills (Interaction)
*   **Hardware-Pulse Emulation**: Character-level typing with randomized delays (50ms - 150ms). This mimics human muscle memory and bypasses simple bot detection that looks for `insertText` events.
*   **Synthetic Hover**: Ability to dispatch precise `mouseMoved` events to trigger React-gated menus and tooltips. This is the gateway to "hidden" functionality.
*   **Intent Strike (Clicking)**: A three-path execution model:
    1.  **Coordinate Strike**: Direct CDP click on the semantic center.
    2.  **DOM Fallback**: Standard JS `element.click()` if protocol events are intercepted.
    3.  **Stability Check**: Monitoring the box model before clicking to ensure the element isn't moving or loading.
*   **Atomic Interaction**: Combining multiple steps (e.g., focus + type + click) into a single execution cycle to minimize latency and state-drift.

## 3. Cognitive Skills (Reasoning)
*   **Self-Healing Paths**: If a target reference (`ref`) becomes stale due to a re-render, Simo automatically re-scans the tree to find the best semantic match based on role and name.
*   **Ambiguity Resolution**: When multiple "Send" buttons exist, Simo uses spatial context (proximity to input) or tree depth to select the most likely candidate.
*   **Graceful Degradation**: Falling back from high-level semantic commands to raw coordinate-based interaction if the DOM becomes too volatile.

## 4. Architectural Skills (Stealth)
*   **CDP-First Protocol**: Operating at the DevTools Protocol level makes the agent's actions indistinguishable from manual debugger interactions, avoiding most JavaScript-based detection scripts.
*   **Passive Relay Model**: Using a lightweight WebSocket relay (`server.py`) ensures that the CLI and the Browser can exist in separate network spaces, minimizing the footprint on the target machine.
