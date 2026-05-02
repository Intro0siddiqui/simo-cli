/**
 * Spectre AXTree Engine v1.9.1
 * Patched: Fixed subtree pruning bug.
 */

const MAX_DEPTH = 30;
const IGNORED_ROLES = new Set(["InlineTextBox", "none"]);
const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio",
  "menuitem", "combobox", "searchbox", "option",
  "switch", "tab", "treeitem", "gridcell", "heading",
  "img", "row", "cell", "listitem", "slider", "spinbutton",
  "paragraph", "group", "region"
]);

/**
 * Walks the accessibility tree with smart filtering.
 */
export async function walkAXTree(debuggee, nodes, depth, context, parentName = "", targetBackendNodeId = null) {
  const maxDepth = targetBackendNodeId ? 100 : MAX_DEPTH;
  if (depth > maxDepth) return "";
  
  const { nodeMap, refCounter, cdpSendCommand } = context;
  const nodeById = {};
  nodes.forEach(n => nodeById[n.nodeId] = n);

  let yaml = "";
  
  let rootNode = null;
  if (targetBackendNodeId) {
    rootNode = nodes.find(n => n.backendDOMNodeId === targetBackendNodeId);
  }
  if (!rootNode) {
    rootNode = nodes.find(n => n.role?.value === "RootWebArea") || nodes[0];
  }
  
  if (!rootNode) return "";

  const stack = [{ id: rootNode.nodeId, depth, pName: "" }];
  const visited = new Set();

  while (stack.length > 0) {
    const { id, depth: d, pName } = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeById[id];
    if (!node) continue;

    const role = node.role?.value || "none";
    const name = node.name?.value || "";

    // ── Pre-process Children ───────────────────────────────────────────────
    // Must push children BEFORE filtering parent, otherwise subtrees vanish!
    let nextDepth = d;
    let currentPName = pName;
    const isInteractive = INTERACTIVE_ROLES.has(role) ||
      node.properties?.some(p => p.name === "draggable" && p.value.value === "true");

    let isVisible = !node.ignored && (isInteractive || name);
    if (context.interactiveOnly && !isInteractive) {
      isVisible = false;
    }
    
    if (isVisible) {
      nextDepth = d + 1;
      currentPName = name || pName;
    }

    const children = node.childIds || [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], depth: nextDepth, pName: currentPName });
    }
    
    // ── Filtering Logic ────────────────────────────────────────────────────
    
    // 1. Ignore clutter roles
    if (IGNORED_ROLES.has(role)) continue;
    
    // 2. Deduplicate: Skip if child text matches parent name
    if (role === "StaticText" && name === pName) continue;

    if (isVisible) {
      const ref = `e${refCounter.val++}`;
      nodeMap[ref] = { backendNodeId: node.backendDOMNodeId, role, name, debuggee };
      yaml += `${"  ".repeat(d)}- ${role}${name ? ` "${name}"` : ""} [ref=${ref}]\n`;

      // ── Iframe Handling ──────────────────────────────────────────────────
      if (role === "IframePresentational" || role === "iframe") {
        try {
          const { node: domNode } = await cdpSendCommand(debuggee, "DOM.describeNode", { backendNodeId: node.backendDOMNodeId });
          if (domNode?.frameId) {
            const targets = await new Promise(r => chrome.debugger.getTargets(r));
            const target = targets.find(t => t.type === "iframe" && !t.attached);
            if (target) {
              const iframeDebuggee = { targetId: target.targetId };
              await new Promise((res, rej) => chrome.debugger.attach(iframeDebuggee, "1.3", () => chrome.runtime.lastError ? rej() : res()));
              await cdpSendCommand(iframeDebuggee, "Accessibility.enable");
              const { nodes: iNodes } = await cdpSendCommand(iframeDebuggee, "Accessibility.getFullAXTree");
              yaml += await walkAXTree(iframeDebuggee, iNodes, nextDepth, context, currentPName);
              await new Promise(res => chrome.debugger.detach(iframeDebuggee, res));
            }
          }
        } catch (e) {}
      }
    }
  }
  return yaml;
}

/**
 * Enriches YAML with spatial coordinates.
 */
export async function addBoxDataToYaml(yaml, nodeMap, cdpSendCommand) {
  const lines = yaml.split('\n');
  const enriched = [];
  for (const line of lines) {
    const match = line.match(/\[ref=(e\d+)\]/);
    if (!match) { enriched.push(line); continue; }
    const node = nodeMap[match[1]];
    if (!node) { enriched.push(line); continue; }
    try {
      const { model } = await cdpSendCommand(node.debuggee, "DOM.getBoxModel", { backendNodeId: node.backendNodeId });
      const [x1, y1, , , x3, y3] = model.content;
      const cx = Math.round((x1+x3)/2), cy = Math.round((y1+y3)/2), w = Math.round(x3-x1), h = Math.round(y3-y1);
      node.box = { cx, cy, w, h };
      enriched.push(line + ` [box=${cx},${cy},${w},${h}]`);
    } catch (e) { enriched.push(line); }
  }
  return enriched.join('\n');
}
