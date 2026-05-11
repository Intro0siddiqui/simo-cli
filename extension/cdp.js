export const tabState = {};
export const debuggerRegistry = {}; // tabId -> true if attached

// ── Storage Persistence ────────────────────────────────────────────────────

export async function saveNodeMap(tabId, nodeMap) {
  const serializable = {};
  for (const [ref, node] of Object.entries(nodeMap)) {
    serializable[ref] = { backendNodeId: node.backendNodeId, role: node.role, name: node.name, box: node.box, sessionId: node.sessionId };
  }
  await chrome.storage.session.set({ [`nodeMap_${tabId}`]: serializable });
}

export async function loadNodeMap(tabId) {
  const result = await chrome.storage.session.get(`nodeMap_${tabId}`);
  const raw = result[`nodeMap_${tabId}`] || {};
  const restored = {};
  for (const [ref, node] of Object.entries(raw)) {
    restored[ref] = { ...node, debuggee: { tabId, sessionId: node.sessionId } };
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

// ── CDP Router & Session Management ────────────────────────────────────────

export const activeSessions = {}; // tabId -> [targetIds] (actually targetIds now)

export async function cdpSendCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

export async function ensureDebuggerAttached(tabId) {
  console.log('Simo Multi-Attaching to tab', tabId);
  
  // 1. Attach to main tab if not already
  if (!debuggerRegistry[tabId]) {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          console.warn("[Simo] Main attach warning:", chrome.runtime.lastError.message);
        }
        debuggerRegistry[tabId] = true;
        resolve();
      });
    });
  }

  // 2. Discover all targets for this tab
  return new Promise((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      const frameUrls = (frames || []).map(f => f.url);
      console.log("[Simo] WebNav found", frameUrls.length, "frames in tab", tabId);

      chrome.debugger.getTargets(async (targets) => {
        const related = targets.filter(t => {
          if (t.tabId === tabId) return true;
          // Most OOPIFs in modern Chrome won't have the tabId set in getTargets.
          // We attach to all iframes found and filter them during the snapshot walk.
          return t.type === 'iframe';
        });
        
        console.log("[Simo] Found", related.length, "matching targets in browser");
        
        if (!activeSessions[tabId]) activeSessions[tabId] = [];
        
        for (const t of related) {
          if (t.id === tabId.toString()) continue;

          if (!activeSessions[tabId].includes(t.id)) {
            console.log("[Simo] Attaching to sub-target:", t.id, t.url);
            await new Promise(r => {
              chrome.debugger.attach({ targetId: t.id }, "1.3", () => {
                if (!chrome.runtime.lastError) {
                  activeSessions[tabId].push(t.id);
                  console.info("[Simo] Attached to iframe target:", t.id);
                } else {
                  console.warn("[Simo] Sub-target attach failed:", chrome.runtime.lastError.message);
                }
                r();
              });
            });
          }
        }
        resolve();
      });
    });
  });
}

chrome.debugger.onDetach.addListener((source) => { 
  if (source.tabId) {
    delete debuggerRegistry[source.tabId];
    delete activeSessions[source.tabId];
  }
  // If a targetId detached, find it in activeSessions and remove it
  if (source.targetId) {
    for (const tabId in activeSessions) {
      activeSessions[tabId] = activeSessions[tabId].filter(id => id !== source.targetId);
    }
  }
});

// ── Interaction Primitives ───────────────────────────────────────────────

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
  
  const debuggee = node.debuggee || { tabId };
  
  try {
    await ensureDebuggerAttached(tabId);
    await cdpSendCommand(debuggee, "DOM.getBoxModel", { backendNodeId: node.backendNodeId });
    return { ...node, debuggee };
  } catch (e) {
    // If it fails, it might be because the backendNodeId is stale.
    // In a multi-target world, we should ideally re-scan the specific debuggee.
    throw new Error(`Target ${ref} vanished or inaccessible: ${e.message}`);
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
