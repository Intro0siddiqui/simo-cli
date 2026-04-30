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

async function generateCdpSnapshot(tabId) {
  await ensureDebuggerAttached(tabId);
  const debuggee = { tabId };
  await cdpSendCommand(debuggee, "Accessibility.enable");
  await cdpSendCommand(debuggee, "DOM.enable");
  const { nodes } = await cdpSendCommand(debuggee, "Accessibility.getFullAXTree");
  
  const context = { nodeMap: {}, refCounter: { val: 1 }, cdpSendCommand };
  const yaml = await walkAXTree(debuggee, nodes, 0, context);
  const enrichedYaml = await addBoxDataToYaml(yaml, context.nodeMap, cdpSendCommand);
  
  tabState[tabId] = { nodeMap: context.nodeMap };
  await saveNodeMap(tabId, context.nodeMap);
  return enrichedYaml;
}

async function ensureActionable(debuggee, backendNodeId) {
  for (let i = 0; i < 10; i++) {
    try {
      const { model } = await cdpSendCommand(debuggee, "DOM.getBoxModel", { backendNodeId });
      if (model && model.content) {
        return { x: (model.content[0]+model.content[4])/2, y: (model.content[1]+model.content[5])/2 };
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
          data = { status: "success", snapshot: await generateCdpSnapshot(msg.tabId) };
          break;
        case "click":
          const c = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
          await ensureDebuggerAttached(msg.tabId);
          try {
            const { x, y } = await ensureActionable(c.debuggee, c.backendNodeId);
            await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
            await new Promise(r => setTimeout(r, 100));
            await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
            await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
          } catch (e) {
            const { object } = await cdpSendCommand(c.debuggee, "DOM.resolveNode", { backendNodeId: c.backendNodeId });
            await cdpSendCommand(c.debuggee, "Runtime.callFunctionOn", {
              functionDeclaration: "function() { this.click(); }",
              objectId: object.objectId
            });
          }
          data = { status: "success" };
          break;
        case "hover":
          const h = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
          await ensureDebuggerAttached(msg.tabId);
          const { x: hx, y: hy } = await ensureActionable(h.debuggee, h.backendNodeId);
          await cdpSendCommand(h.debuggee, "Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
          data = { status: "success" };
          break;
        case "raw_click":
          await ensureDebuggerAttached(msg.tabId);
          await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x: msg.x, y: msg.y });
          await new Promise(r => setTimeout(r, 100));
          await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x: msg.x, y: msg.y, button: "left", clickCount: 1 });
          await new Promise(r => setTimeout(r, 150));
          await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x: msg.x, y: msg.y, button: "left", clickCount: 1 });
          data = { status: "success" };
          break;
        case "type":
          const t = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
          await ensureDebuggerAttached(msg.tabId);
          const { x: tx, y: ty } = await ensureActionable(t.debuggee, t.backendNodeId);
          await cdpSendCommand(t.debuggee, "Input.dispatchMouseEvent", { type: "mousePressed", x: tx, y: ty, button: "left", clickCount: 1 });
          await cdpSendCommand(t.debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x: tx, y: ty, button: "left", clickCount: 1 });
          await humanType(t.debuggee, msg.text);
          data = { status: "success" };
          break;
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
        case "screenshot":
          await ensureDebuggerAttached(msg.tabId);
          const shot = await cdpSendCommand({ tabId: msg.tabId }, "Page.captureScreenshot", { format: "png", fromSurface: true });
          data = { status: "success", data: shot.data };
          break;
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
