/**
 * Simo Background Controller v1.9.9
 * Refactored to use modular axtree.js for semantic intelligence.
 * Added: raw_click override and hover action for direct CDP interaction.
 */

import { walkAXTree, addBoxDataToYaml } from './axtree.js';

const RELAY_URL = "ws://localhost:8765";
const RECONNECT_DELAY = 3000;

let ws = null;
const tabState = {};
const debuggerRegistry = {}; // tabId -> true if attached

// ── Storage Persistence ────────────────────────────────────────────────────

async function saveNodeMap(tabId, nodeMap) {
  const serializable = {};
  for (const [ref, node] of Object.entries(nodeMap)) {
    serializable[ref] = { backendNodeId: node.backendNodeId, role: node.role, name: node.name, box: node.box };
  }
  await chrome.storage.session.set({ [`nodeMap_${tabId}`]: serializable });
}

async function loadNodeMap(tabId) {
  const result = await chrome.storage.session.get(`nodeMap_${tabId}`);
  const raw = result[`nodeMap_${tabId}`] || {};
  const restored = {};
  for (const [ref, node] of Object.entries(raw)) {
    restored[ref] = { ...node, debuggee: { tabId } };
  }
  return restored;
}

async function getTabState(tabId) {
  if (!tabState[tabId]) {
    const nodeMap = await loadNodeMap(tabId);
    tabState[tabId] = { nodeMap };
  }
  return tabState[tabId];
}

// ── CDP Helpers ────────────────────────────────────────────────────────────

async function cdpSendCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

async function ensureDebuggerAttached(tabId) {
  if (debuggerRegistry[tabId]) return;
  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message;
        if (msg.includes("already")) { debuggerRegistry[tabId] = true; resolve(); }
        else reject(new Error(msg));
      } else { debuggerRegistry[tabId] = true; resolve(); }
    });
  });
}

chrome.debugger.onDetach.addListener((source) => { if (source.tabId) delete debuggerRegistry[source.tabId]; });

// ── Interaction Logic ──────────────────────────────────────────────────────

async function generateCdpSnapshot(tabId, ref = null, interactiveOnly = false) {
  let targetBackendNodeId = null;
  if (ref) {
    const target = await resolveTarget(tabId, ref);
    targetBackendNodeId = target.backendNodeId;
  }
  await ensureDebuggerAttached(tabId);
  const debuggee = { tabId };
  
  // DOM Hydration: Expose floating/unlabeled custom buttons to the AXTree
  try {
    await cdpSendCommand(debuggee, "Runtime.evaluate", {
      expression: `
        (function() {
          try {
            const els = document.querySelectorAll('div, span, svg, i, [class*="btn"], [class*="button"]');
            for (const el of els) {
              if (el.hasAttribute('role') || el.hasAttribute('aria-label') || el.innerText?.trim()) continue;
              const style = window.getComputedStyle(el);
              if (style.cursor === 'pointer' || el.hasAttribute('onclick')) {
                el.setAttribute('role', 'button');
                el.setAttribute('aria-label', el.className || el.id || 'floating action button');
              }
            }
          } catch(e) {}
        })();
      `
    });
  } catch (e) {}

  await cdpSendCommand(debuggee, "Accessibility.enable");
  await cdpSendCommand(debuggee, "DOM.enable");
  const { nodes } = await cdpSendCommand(debuggee, "Accessibility.getFullAXTree");
  
  const context = { nodeMap: {}, refCounter: { val: 1 }, cdpSendCommand, interactiveOnly };
  const yaml = await walkAXTree(debuggee, nodes, 0, context, "", targetBackendNodeId);
  const enrichedYaml = await addBoxDataToYaml(yaml, context.nodeMap, cdpSendCommand);
  
  if (!ref) {
    tabState[tabId] = { nodeMap: context.nodeMap };
    await saveNodeMap(tabId, context.nodeMap);
  } else {
    const existingMap = await loadNodeMap(tabId);
    const mergedMap = { ...existingMap, ...context.nodeMap };
    tabState[tabId] = { nodeMap: mergedMap };
    await saveNodeMap(tabId, mergedMap);
  }
  return enrichedYaml;
}

async function ensureActionable(debuggee, backendNodeId) {
  for (let i = 0; i < 10; i++) {
    try {
      const { model } = await cdpSendCommand(debuggee, "DOM.getBoxModel", { backendNodeId });
      if (model && model.content) {
        return { 
          x: (model.content[0]+model.content[4])/2, 
          y: (model.content[1]+model.content[5])/2 
        };
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Actionability timeout");
}

async function humanType(debuggee, text) {
  for (const char of text) {
    await cdpSendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyDown" });
    await cdpSendCommand(debuggee, "Input.dispatchKeyEvent", { type: "char", text: char });
    await cdpSendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyUp" });
    await new Promise(r => setTimeout(r, 40 + Math.random() * 80));
  }
}

async function resolveTarget(tabId, ref) {
  const state = await getTabState(tabId);
  let node = state.nodeMap[ref];
  if (!node) node = Object.values(state.nodeMap).find(n => n.name === ref || n.role === ref);
  if (!node) throw new Error("Ref not found");
  try {
    await ensureDebuggerAttached(tabId);
    await cdpSendCommand(node.debuggee, "DOM.getBoxModel", { backendNodeId: node.backendNodeId });
    return node;
  } catch (e) {
    await ensureDebuggerAttached(tabId);
    await cdpSendCommand({ tabId }, "Accessibility.enable");
    const { nodes } = await cdpSendCommand({ tabId }, "Accessibility.getFullAXTree");
    const match = nodes.find(n => n.role?.value === node.role && n.name?.value === node.name);
    if (!match) throw new Error("Vanished");
    node.backendNodeId = match.backendDOMNodeId;
    node.debuggee = { tabId };
    return node;
  }
}

async function waitForTarget(tabId, ref) {
  for (let i = 0; i < 20; i++) {
    try {
      const target = await resolveTarget(tabId, ref);
      await ensureActionable(target.debuggee, target.backendNodeId);
      return target;
    } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error("Wait timeout");
}

async function verifyState(tabId, ref, attribute = "checked", expectedValue = true) {
  const maxAttempts = 15; // Poll up to 1.5 seconds
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 100)); // 100ms interval
    try {
      const node = await resolveTarget(tabId, ref);
      const debuggee = { tabId };
      await ensureDebuggerAttached(tabId);
      const { nodes } = await cdpSendCommand(debuggee, "Accessibility.getFullAXTree");
      const match = nodes.find(n => n.backendDOMNodeId === node.backendNodeId);
      if (!match) continue; // Might have temporarily vanished, keep trying
      
      // Check various ways a state might be represented in AXTree
      const checkedProp = match.properties?.find(p => p.name === "checked" || p.name === "selected" || p.name === "expanded");
      if (checkedProp && (checkedProp.value.value === expectedValue || String(checkedProp.value.value) === "true")) {
        return true;
      }
    } catch (e) {
      // Continue polling on error
    }
  }
  return false;
}

async function waitText(tabId, text, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await ensureDebuggerAttached(tabId);
      const { nodes } = await cdpSendCommand({ tabId }, "Accessibility.getFullAXTree");
      const found = nodes.some(n => n.name?.value?.toLowerCase().includes(text.toLowerCase()));
      if (found) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

// ── Relay Connection ───────────────────────────────────────────────────────

let isConnecting = false;

function connect() {
  if (isConnecting) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;

  isConnecting = true;
  ws = new WebSocket(RELAY_URL);

  ws.onopen = () => {
    isConnecting = false;
    ws.send(JSON.stringify({ type: "register", role: "extension" }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    let data = null;
    try {
      switch (msg.action) {
        case "get_tabs":
          const tabs = await chrome.tabs.query({});
          data = { count: tabs.length, tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })) };
          break;
        case "snapshot":
          data = { status: "success", snapshot: await generateCdpSnapshot(msg.tabId, msg.ref, msg.interactiveOnly) };
          break;
        case "wait_text":
          await waitText(msg.tabId, msg.text, msg.timeout);
          data = { status: "success" };
          break;
        case "click": {
          const c = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
          await ensureDebuggerAttached(msg.tabId);
          try {
            const { x, y } = await ensureActionable(c.debuggee, c.backendNodeId);
            await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
            await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
            await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
            await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
            await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
          } catch (e) {
            const { object } = await cdpSendCommand(c.debuggee, "DOM.resolveNode", { backendNodeId: c.backendNodeId });
            await cdpSendCommand(c.debuggee, "Runtime.callFunctionOn", {
              functionDeclaration: `function() { 
                this.click(); 
                if (this.tagName === 'INPUT' || this.getAttribute('role') === 'radio' || this.getAttribute('role') === 'checkbox') {
                  const parent = this.closest('label') || this.parentElement;
                  if (parent) {
                    parent.click();
                    parent.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    parent.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  }
                }
              }`,
              objectId: object.objectId
            });
          }
          if (msg.verify) {
            const ok = await verifyState(msg.tabId, msg.ref);
            data = { status: ok ? "success" : "warning", verified: ok };
          } else {
            data = { status: "success" };
          }
          break;
        }
        case "grid_strike": {
          const grid = await resolveTarget(msg.tabId, msg.gridRef);
          await ensureDebuggerAttached(msg.tabId);
          
          const { nodes: allNodes } = await cdpSendCommand({ tabId: msg.tabId }, "Accessibility.getFullAXTree");
          const gridNode = allNodes.find(n => n.backendDOMNodeId === grid.backendNodeId);
          if (!gridNode) throw new Error("Grid container vanished");

          const rows = gridNode.childIds || [];
          let clickedCount = 0;

          for (const rowId of rows) {
            const rowNode = allNodes.find(n => n.nodeId === rowId);
            if (!rowNode) continue;

            const findTarget = (nodeId) => {
               const node = allNodes.find(n => n.nodeId === nodeId);
               if (!node) return null;
               if (node.name?.value?.toLowerCase().includes(msg.columnQuery.toLowerCase())) return node;
               for (const childId of (node.childIds || [])) {
                 const found = findTarget(childId);
                 if (found) return found;
               }
               return null;
            };

            const target = findTarget(rowId);
            if (target) {
              const { x, y } = await ensureActionable({ tabId: msg.tabId }, target.backendDOMNodeId);
              await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
              await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
              await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
              await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
              
              clickedCount++;
              await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
            }
          }
          data = { status: "success", clicked: clickedCount };
          break;
        }
        case "hover": {
          const h = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
          await ensureDebuggerAttached(msg.tabId);
          const { x: hx, y: hy } = await ensureActionable(h.debuggee, h.backendNodeId);
          await cdpSendCommand(h.debuggee, "Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
          data = { status: "success" };
          break;
        }
        case "raw_click":
          await ensureDebuggerAttached(msg.tabId);
          await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x: msg.x, y: msg.y });
          await new Promise(r => setTimeout(r, 100));
          await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x: msg.x, y: msg.y, button: "left", clickCount: 1 });
          await new Promise(r => setTimeout(r, 150));
          await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x: msg.x, y: msg.y, button: "left", clickCount: 1 });
          data = { status: "success" };
          break;
        case "type": {
          const t = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
          await ensureDebuggerAttached(msg.tabId);
          const { x: tx, y: ty } = await ensureActionable(t.debuggee, t.backendNodeId);
          await cdpSendCommand(t.debuggee, "Input.dispatchMouseEvent", { type: "mousePressed", x: tx, y: ty, button: "left", clickCount: 1 });
          await cdpSendCommand(t.debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x: tx, y: ty, button: "left", clickCount: 1 });
          await humanType(t.debuggee, msg.text);
          data = { status: "success" };
          break;
        }
        case "navigate":
          await chrome.tabs.update(msg.tabId, { url: msg.url });
          data = { status: "success" };
          break;
        case "new_tab":
          const newTab = await chrome.tabs.create({ url: msg.url || "about:blank" });
          data = { status: "success", tabId: newTab.id };
          break;
        case "execute":
          await ensureDebuggerAttached(msg.tabId);
          const res = await cdpSendCommand({ tabId: msg.tabId }, "Runtime.evaluate", { expression: msg.code, returnByValue: true, awaitPromise: true });
          data = { success: true, result: res.result?.value };
          break;
        case "scroll": {
          await ensureDebuggerAttached(msg.tabId);
          const scrollExpr = msg.ref 
            ? `(async () => { const el = document.querySelector('[data-ref="${msg.ref}"]'); if (el) el.scrollBy(0, ${msg.delta}); else window.scrollBy(0, ${msg.delta}); })()`
            : `window.scrollBy(0, ${msg.delta})`;
          // Simo-specific: resolve ref to DOM node if provided
          if (msg.ref) {
            const s = await resolveTarget(msg.tabId, msg.ref);
            const { object } = await cdpSendCommand(s.debuggee, "DOM.resolveNode", { backendNodeId: s.backendNodeId });
            await cdpSendCommand(s.debuggee, "Runtime.callFunctionOn", {
              functionDeclaration: `function(delta) { this.scrollBy(0, delta); }`,
              arguments: [{ value: msg.delta }],
              objectId: object.objectId
            });
          } else {
            await cdpSendCommand({ tabId: msg.tabId }, "Runtime.evaluate", { expression: `window.scrollBy(0, ${msg.delta})` });
          }
          data = { status: "success" };
          break;
        }
        case "screenshot": {
          await ensureDebuggerAttached(msg.tabId);
          const shot = await cdpSendCommand({ tabId: msg.tabId }, "Page.captureScreenshot", { format: "png", fromSurface: true });
          data = { status: "success", data: shot.data };
          break;
        }
        default:
          data = { status: "error", message: `Unknown action: ${msg.action}` };
      }
    } catch (e) { data = { status: "error", message: e.toString() }; }
    if (data && msg.client_id) ws.send(JSON.stringify({ type: "response", client_id: msg.client_id, data }));
  };

  ws.onclose = () => {
    ws = null;
    isConnecting = false;
    setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => {
    // Silence error log by not explicitly logging, let onclose handle retry
    ws = null;
    isConnecting = false;
  };
}

connect();
chrome.alarms.create("keepAlive", { periodInMinutes: 0.1 });
chrome.alarms.onAlarm.addListener(() => connect());
