"""Spectre Relay — WebSocket bridge between Chrome extension and CLI observer."""

import asyncio
import json
import logging
import uuid
from typing import Optional

import websockets
from websockets.server import ServerConnection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

HOST = "0.0.0.0"
PORT = 8765

extension_ws: Optional[ServerConnection] = None
pending_requests: dict[str, ServerConnection] = {}


async def handler(ws: ServerConnection) -> None:
    """Route messages between the extension and CLI observer clients."""
    global extension_ws

    try:
        async for raw in ws:
            try:
                msg: dict = json.loads(raw)
            except json.JSONDecodeError:
                log.warning("Invalid JSON received — dropping message")
                continue

            msg_type = msg.get("type")

            # ── Heartbeat ───────────────────────────────────────────
            if msg_type == "ping":
                continue

            # ── Extension registration ──────────────────────────────
            if msg_type == "register" and msg.get("role") == "extension":
                extension_ws = ws
                log.info("Extension registered")
                continue

            # ── Client actions (query, navigate, activate, etc.) ────
            if msg_type in ("query", "action"):
                if not extension_ws:
                    await ws.send(json.dumps({"error": "Extension not connected"}))
                    continue
                
                try:
                    # Map legacy 'query' to 'get_tabs'
                    action = "get_tabs" if msg_type == "query" else msg.get("action")
                    if not action:
                        await ws.send(json.dumps({"error": "No action specified"}))
                        continue

                    req_id = str(uuid.uuid4())[:8]
                    pending_requests[req_id] = ws
                    
                    # Forward the request to the extension
                    payload = {
                        "action": action,
                        "client_id": req_id,
                    }
                    # Merge any extra parameters (tabId, url, code, etc.)
                    payload.update({k: v for k, v in msg.items() if k not in ("type", "action", "client_id")})
                    
                    await extension_ws.send(json.dumps(payload))
                    log.info("Action '%s' forwarded (id: %s)", action, req_id)
                except Exception as e:
                    log.error("Forwarding failed: %s", e)
                    await ws.send(json.dumps({"error": str(e)}))

            # ── Extension response ──────────────────────────────────
            elif msg_type == "response":
                client_id = msg.get("client_id")
                client = pending_requests.pop(client_id, None)
                if client:
                    try:
                        await client.send(json.dumps(msg.get("data", {})))
                    except Exception:
                        log.warning("Failed to deliver response to observer")
                else:
                    log.debug("Stale response received (client id: %s)", client_id)

    except websockets.ConnectionClosed:
        log.info("Connection closed")
    finally:
        if ws is extension_ws:
            extension_ws = None
            log.info("Extension unregistered")


async def main() -> None:
    log.info("Relay listening on ws://%s:%d", HOST, PORT)
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
