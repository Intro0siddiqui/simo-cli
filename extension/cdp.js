export const tabState = {};
export const debuggerRegistry = {}; // tabId -> true if attached

// ── Storage Persistence ────────────────────────────────────────────────────

export async function saveNodeMap(tabId, nodeMap) {
  const serializable = {};
  for (const [ref, node] of Object.entries(nodeMap)) {
    serializable[ref] = { backendNodeId: node.backendNodeId, role: node.role, name: node.name, box: node.box };
  }
  await chrome.storage.session.set({ [`nodeMap_${tabId}`]: serializable });
}

export async function loadNodeMap(tabId) {
  const result = await chrome.storage.session.get(`nodeMap_${tabId}`);
  const raw = result[`nodeMap_${tabId}`] || {};
  const restored = {};
  for (const [ref, node] of Object.entries(raw)) {
    restored[ref] = { ...node, debuggee: { tabId } };
  }
  return restored;
}

export async function getTabState(tabId) {
  if (!tabState[tabId]) {
    const nodeMap = await loadNodeMap(tabId);
    tabState[tabId] = { nodeMap };
  }
  return tabState[tabId];
}

// ── CDP Helpers ────────────────────────────────────────────────────────────

export async function cdpSendCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

export async function ensureDebuggerAttached(tabId) {
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

export async function ensureActionable(debuggee, backendNodeId) {
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

export async function resolveTarget(tabId, ref) {
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

export async function waitForTarget(tabId, ref) {
  for (let i = 0; i < 20; i++) {
    try {
      const target = await resolveTarget(tabId, ref);
      await ensureActionable(target.debuggee, target.backendNodeId);
      return target;
    } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error("Wait timeout");
}
