/**
 * Simo Background Controller v2.0.0
 * Refactored into a lightweight WebSocket router.
 */

import { cdpSendCommand, ensureDebuggerAttached, activeSessions, debuggerRegistry } from './cdp.js';
import { 
  generateCdpSnapshot, waitText, performClick, performGridStrike, 
  performHover, performDrag, performType, performScroll 
} from './actions.js';

const RELAY_URL = "ws://localhost:8765";
const RECONNECT_DELAY = 3000;

let ws = null;
let isConnecting = false;
let connectTimeout = null;

async function getRelayUrl() {
  const result = await chrome.storage.local.get("relay_url");
  return result.relay_url || RELAY_URL;
}

async function connect() {
  if (isConnecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  isConnecting = true;
  try {
    const url = await getRelayUrl();
    console.info(`[Simo] Connecting to relay: ${url}`);
    ws = new WebSocket(url);

    if (connectTimeout) clearTimeout(connectTimeout);
    connectTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        console.warn("[Simo] Connection timeout - closing socket");
        ws.close();
        isConnecting = false;
      }
    }, 5000);

    ws.onopen = () => {
      isConnecting = false;
      if (connectTimeout) clearTimeout(connectTimeout);
      ws.send(JSON.stringify({ type: "register", role: "extension" }));
      console.info("[Simo] Connected to relay server");
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
          case "diag":
            console.log("[Simo] Diagnostic request received");
            data = { status: "success", activeSessions, debuggerRegistry };
            break;
          case "snapshot":
            data = { status: "success", snapshot: await generateCdpSnapshot(msg.tabId, msg.ref, msg.interactiveOnly) };
            break;
          case "wait_text":
            await waitText(msg.tabId, msg.text, msg.timeout);
            data = { status: "success" };
            break;
          case "click":
            data = await performClick(msg);
            break;
          case "grid_strike":
            data = await performGridStrike(msg);
            break;
          case "hover":
            data = await performHover(msg);
            break;
          case "drag":
            data = await performDrag(msg);
            break;
          case "raw_click":
            await ensureDebuggerAttached(msg.tabId);
            await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x: msg.x, y: msg.y, buttons: 0 });
            await new Promise(r => setTimeout(r, 100));
            await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x: msg.x, y: msg.y, button: "left", buttons: 1, clickCount: 1 });
            await new Promise(r => setTimeout(r, 150));
            await cdpSendCommand({ tabId: msg.tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x: msg.x, y: msg.y, button: "left", buttons: 0, clickCount: 1 });
            data = { status: "success" };
            break;
          case "type":
            data = await performType(msg);
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
          case "scroll":
            data = await performScroll(msg);
            break;
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
      if (connectTimeout) clearTimeout(connectTimeout);
      console.warn("[Simo] Relay connection closed - retrying in 3s");
      setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = (err) => {
      console.error("[Simo] WebSocket error:", err);
      ws = null;
      isConnecting = false;
      if (connectTimeout) clearTimeout(connectTimeout);
    };
  } catch (err) {
    console.error("[Simo] Failed to initialize connection:", err);
    isConnecting = false;
    ws = null;
  }
}

connect();
chrome.alarms.create("keepAlive", { periodInMinutes: 0.1 });
chrome.alarms.onAlarm.addListener(() => connect());
