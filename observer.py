"""Spectre Observer — Unified CLI for monitoring and controlling browser tabs."""

import argparse
import asyncio
import json
import sys
from typing import Any

import base64
import re
import websockets

DEFAULT_PORT = 8765
TIMEOUT = 60 # Increased for large snapshots on sites like IG

class _Term:
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"
    BLUE = "\033[34m"
    YELLOW = "\033[33m"
    GREEN = "\033[32m"
    RED = "\033[31m"
    MARKER = f"{YELLOW}●{RESET}"
    DIM_MARKER = f"{DIM}○{RESET}"

    @staticmethod
    def header(text: str) -> str:
        return f"\n{_Term.BOLD}{text}{_Term.RESET}"

    @staticmethod
    def dim(text: str) -> str:
        return f"{_Term.DIM}{text}{_Term.RESET}"

async def send_command(port: int, msg: dict) -> dict[str, Any]:
    uri = f"ws://127.0.0.1:{port}"
    try:
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps(msg))
            raw = await asyncio.wait_for(ws.recv(), timeout=TIMEOUT)
            data = json.loads(raw)
            if "error" in data:
                print(f"{_Term.RED}Error:{_Term.RESET} {data['error']}")
                sys.exit(1)
            return data
    except ConnectionRefusedError:
        print(f"{_Term.RED}Error:{_Term.RESET} Relay server not running. (Run ./simo serve)")
        sys.exit(1)
    except asyncio.TimeoutError:
        print(f"{_Term.RED}Error:{_Term.RESET} Operation timed out (Tab or Extension not responding).")
        sys.exit(1)
    except Exception as e:
        print(f"{_Term.RED}Error:{_Term.RESET} {e}")
        sys.exit(1)

def render_tabs(data: dict[str, Any]) -> None:
    tabs = data.get("tabs", [])
    print(f"{_Term.header('Active Tabs')} {_Term.dim(f'({len(tabs)})')}\n")
    for i, tab in enumerate(tabs, 1):
        marker = _Term.MARKER if tab.get("active") else _Term.DIM_MARKER
        print(f"  {marker}  {_Term.BOLD}{tab['id']}{_Term.RESET} - {tab['title']}")
        print(f"      {_Term.dim(tab['url'])}")
    print()

def render_snapshot(snapshot: str) -> None:
    print(f"{_Term.header('Accessibility Tree Snapshot')}")
    colored = re.sub(r'\[ref=(e\d+)\]', f'[{_Term.YELLOW}\\1{_Term.RESET}]', snapshot)
    colored = re.sub(r'\[box=([\d,]+)\]', f'[{_Term.BLUE}box=\\1{_Term.RESET}]', colored)
    print(colored)


def main():
    parser = argparse.ArgumentParser(description="Spectre Observer — Unified CLI")
    subparsers = parser.add_subparsers(dest="command")

    parser_status = subparsers.add_parser("status", help="Show open tabs")
    parser_status.add_argument("--json", action="store_true")

    parser_nav = subparsers.add_parser("nav", help="Navigate tab to URL")
    parser_nav.add_argument("tab_id", type=int)
    parser_nav.add_argument("url")

    parser_snap = subparsers.add_parser("snap", help="Get accessibility snapshot")
    parser_snap.add_argument("tab_id", type=int)

    parser_wait = subparsers.add_parser("wait", help="Wait for element to appear/become actionable")
    parser_wait.add_argument("tab_id", type=int)
    parser_wait.add_argument("ref")
    parser_wait.add_argument("--timeout", type=int, default=10000)

    parser_click = subparsers.add_parser("click", help="Click element by ref")
    parser_click.add_argument("tab_id", type=int)
    parser_click.add_argument("ref")
    parser_click.add_argument("--wait", action="store_true", help="Wait for element before clicking")

    parser_hover = subparsers.add_parser("hover", help="Hover over an element by ref")
    parser_hover.add_argument("tab_id", type=int)
    parser_hover.add_argument("ref")
    parser_hover.add_argument("--wait", action="store_true", help="Wait for element before hovering")

    parser_type = subparsers.add_parser("type", help="Type text into an element by ref")
    parser_type.add_argument("tab_id", type=int)
    parser_type.add_argument("ref")
    parser_type.add_argument("text")
    parser_type.add_argument("--wait", action="store_true", help="Wait for element before typing")

    parser_shot = subparsers.add_parser("shot", help="Take a screenshot of a tab")
    parser_shot.add_argument("tab_id", type=int)
    parser_shot.add_argument("-o", "--output", default="screenshot.png", help="Output file path")

    parser_drag = subparsers.add_parser("drag", help="Drag an element to another element")
    parser_drag.add_argument("tab_id", type=int)
    parser_drag.add_argument("from_ref")
    parser_drag.add_argument("to_ref")

    parser_exec = subparsers.add_parser("exec", help="Run JS code")
    parser_exec.add_argument("tab_id", type=int)
    parser_exec.add_argument("code")

    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    
    if len(sys.argv) == 1:
        args = parser.parse_args(["status"])
    else:
        args = parser.parse_args()

    if args.command == "status":
        data = asyncio.run(send_command(args.port, {"type": "query"}))
        if args.json: print(json.dumps(data, indent=2))
        else: render_tabs(data)

    elif args.command == "nav":
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "navigate", "tabId": args.tab_id, "url": args.url}))
        if res.get("status") == "success":
            print(f"{_Term.GREEN}Navigating...{_Term.RESET}")
        else:
            print(f"{_Term.RED}Error:{_Term.RESET} {res.get('message', 'Failed to navigate')}")

    elif args.command == "snap":
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "snapshot", "tabId": args.tab_id}))
        if res.get("status") == "success":
            render_snapshot(res.get("snapshot"))
            print(f"{_Term.DIM}(Note: Captured via CDP){_Term.RESET}\n")
        else:
            print(f"{_Term.RED}Error:{_Term.RESET} {res.get('message', 'Failed to take snapshot')}")

    elif args.command == "wait":
        print(f"{_Term.BLUE}Waiting for {args.ref}...{_Term.RESET}")
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "wait", "tabId": args.tab_id, "ref": args.ref, "timeout": args.timeout}))
        if res.get("status") == "success":
            print(f"{_Term.GREEN}Element {args.ref} is now actionable.{_Term.RESET}")
        else:
            print(f"{_Term.RED}Error:{_Term.RESET} {res.get('message', 'Timed out waiting for element')}")

    elif args.command == "click":
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "click", "tabId": args.tab_id, "ref": args.ref, "wait": args.wait}))
        if res.get("status") == "success":
            print(f"{_Term.GREEN}Click dispatched to {args.ref}{_Term.RESET}")
        else:
            print(f"{_Term.RED}Error:{_Term.RESET} {res.get('message', 'Failed to click element')}")

    elif args.command == "drag":
        asyncio.run(send_command(args.port, {"type": "action", "action": "drag", "tabId": args.tab_id, "from": args.from_ref, "to": args.to_ref}))
        print(f"{_Term.GREEN}Drag dispatched from {args.from_ref} to {args.to_ref}{_Term.RESET}")

    elif args.command == "hover":
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "hover", "tabId": args.tab_id, "ref": args.ref, "wait": args.wait}))
        if res.get("status") == "success":
            print(f"{_Term.GREEN}Hover dispatched to {args.ref}{_Term.RESET}")
        else:
            print(f"{_Term.RED}Error:{_Term.RESET} {res.get('message', 'Failed to hover')}")

    elif args.command == "type":
        asyncio.run(send_command(args.port, {"type": "action", "action": "type", "tabId": args.tab_id, "ref": args.ref, "text": args.text, "wait": args.wait}))
        print(f"{_Term.GREEN}Typed into {args.ref}: \"{args.text}\"{_Term.RESET}")

    elif args.command == "exec":
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "execute", "tabId": args.tab_id, "code": args.code}))
        print(json.dumps(res, indent=2))

    elif args.command == "shot":
        res = asyncio.run(send_command(args.port, {"type": "action", "action": "screenshot", "tabId": args.tab_id}))
        if res.get("status") == "success":
            with open(args.output, "wb") as f:
                f.write(base64.b64decode(res.get("data")))
            print(f"{_Term.GREEN}Screenshot saved to {args.output}{_Term.RESET}")
        else:
            print(f"{_Term.RED}Error:{_Term.RESET} {res.get('message', 'Failed to take screenshot')}")

if __name__ == "__main__":
    main()
