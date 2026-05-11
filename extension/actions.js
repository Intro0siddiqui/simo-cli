import { walkAXTree, addBoxDataToYaml } from './axtree.js';
import { 
  cdpSendCommand, ensureDebuggerAttached, ensureActionable, 
  resolveTarget, waitForTarget, tabState, saveNodeMap, loadNodeMap,
  activeSessions
} from './cdp.js';

async function findIframeTargets(tabId) {
  try {
    const { targetInfos } = await cdpSendCommand({ tabId }, "Target.getTargets");
    // Target.getTargets on the tab only returns targets in the same browser context.
    // However, it might not return everything. We can also ask the global browser.
    return targetInfos.filter(t => t.type === "iframe");
  } catch (e) {
    return [];
  }
}

export async function generateCdpSnapshot(tabId, ref = null, interactiveOnly = false) {
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
  let yaml = await walkAXTree(debuggee, nodes, 0, context, "", targetBackendNodeId);
  
  // ── Iframe target discovery via active sessions ────────────────────
  // 2. Fetch AXTree for all discovered sub-targets (iframes)
  const subTargets = activeSessions[tabId] || [];
  console.log("[Simo] Processing", subTargets.length, "sub-targets for AXTree");
  
  for (const targetId of subTargets) {
    try {
      const subDebuggee = { targetId };
      await cdpSendCommand(subDebuggee, "Accessibility.enable");
      const { nodes: subNodes } = await cdpSendCommand(subDebuggee, "Accessibility.getFullAXTree");
      
      const subContext = { ...context, targetId };
      yaml += "\n" + await walkAXTree(subDebuggee, subNodes, 1, subContext, "");
      console.log("[Simo] Appended AXTree from sub-target:", targetId);
    } catch (e) {
      console.warn("[Simo] Failed to get AXTree for sub-target:", targetId, e.message);
    }
  }

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

export async function humanType(debuggee, text) {
  for (const char of text) {
    await cdpSendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyDown" });
    await cdpSendCommand(debuggee, "Input.dispatchKeyEvent", { type: "char", text: char });
    await cdpSendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyUp" });
    await new Promise(r => setTimeout(r, 40 + Math.random() * 80));
  }
}

export async function verifyState(tabId, ref, attribute = "checked", expectedValue = true) {
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

export async function waitText(tabId, text, timeout = 10000) {
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

export async function performClick(msg) {
  const c = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
  await ensureDebuggerAttached(msg.tabId);
  try {
    await cdpSendCommand(c.debuggee, "DOM.scrollIntoViewIfNeeded", { backendNodeId: c.backendNodeId });
    await new Promise(r => setTimeout(r, 200));

    const { x, y } = await ensureActionable(c.debuggee, c.backendNodeId);
    await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
    await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
    await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
    await cdpSendCommand(c.debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
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
    return { status: ok ? "success" : "warning", verified: ok };
  }
  return { status: "success" };
}

export async function performGridStrike(msg) {
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
      await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
      await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
      await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      
      clickedCount++;
      await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
    }
  }
  return { status: "success", clicked: clickedCount };
}

export async function performHover(msg) {
  const h = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
  await ensureDebuggerAttached(msg.tabId);
  const { x: hx, y: hy } = await ensureActionable(h.debuggee, h.backendNodeId);
  await cdpSendCommand(h.debuggee, "Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
  return { status: "success" };
}

export async function performDrag(msg) {
  const from = await resolveTarget(msg.tabId, msg.from);
  const to = await resolveTarget(msg.tabId, msg.to);
  await ensureDebuggerAttached(msg.tabId);
  const fromBox = await ensureActionable(from.debuggee, from.backendNodeId);
  const toBox = await ensureActionable(to.debuggee, to.backendNodeId);

  await cdpSendCommand(from.debuggee, "Input.dispatchMouseEvent", { 
    type: "mouseMoved", x: fromBox.x, y: fromBox.y, buttons: 1 
  });
  await new Promise(r => setTimeout(r, 100));
  await cdpSendCommand(from.debuggee, "Input.dispatchMouseEvent", { 
    type: "mousePressed", x: fromBox.x, y: fromBox.y, button: "left", buttons: 1, clickCount: 1 
  });
  await new Promise(r => setTimeout(r, 200));

  await cdpSendCommand(from.debuggee, "Input.dispatchMouseEvent", { 
    type: "mouseMoved", x: toBox.x, y: toBox.y, button: "left", buttons: 1 
  });
  await new Promise(r => setTimeout(r, 200));

  await cdpSendCommand(from.debuggee, "Input.dispatchMouseEvent", { 
    type: "mouseReleased", x: toBox.x, y: toBox.y, button: "left", buttons: 0, clickCount: 1 
  });
  return { status: "success" };
}

export async function performType(msg) {
  const t = msg.wait ? await waitForTarget(msg.tabId, msg.ref) : await resolveTarget(msg.tabId, msg.ref);
  await ensureDebuggerAttached(msg.tabId);
  const { x: tx, y: ty } = await ensureActionable(t.debuggee, t.backendNodeId);
  await cdpSendCommand(t.debuggee, "Input.dispatchMouseEvent", { type: "mousePressed", x: tx, y: ty, button: "left", buttons: 1, clickCount: 1 });
  await cdpSendCommand(t.debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x: tx, y: ty, button: "left", buttons: 0, clickCount: 1 });
  await humanType(t.debuggee, msg.text);
  return { status: "success" };
}

export async function performScroll(msg) {
  await ensureDebuggerAttached(msg.tabId);
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
  return { status: "success" };
}
