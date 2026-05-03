# Troubleshooting Simo CLI

## Common Connection Issues

### "Error: Extension not connected"
This occurs when the CLI cannot find a registered Chrome extension.
1.  **Check the Relay**: Ensure `./simo serve` is running in a background terminal.
2.  **Check Chrome**: Open `chrome://extensions` and verify that the Simo extension is loaded and enabled in "Developer mode".
3.  **Reload**: Click the "Refresh" icon on the extension card in `chrome://extensions`.
4.  **WebSocket Port**: Ensure no other process is using port `8765`.

### "Error: Operation timed out"
Large pages (like Instagram or LinkedIn) can take a long time to generate an AXTree.
1.  **Try Snap Again**: Sometimes a second attempt works once the page is hydrated.
2.  **Check CPU**: High CPU usage can cause the extension's background script to lag.

### "Error: Tab not found"
Tab IDs are ephemeral and change whenever you restart Chrome or the extension.
1.  Run `./simo status` to get the latest list of Tab IDs.

## Interaction Failures

### Click has no effect
1.  **Use --verify**: Run `simo click <id> <ref> --verify` to see if the state actually changed.
2.  **Try Hover first**: Some elements only become clickable after a `hover` event.
3.  **Wait for hydration**: The page may look loaded but JS listeners haven't attached yet. Use `simo wait <id> <ref>` before clicking.

### "Reference Stale"
If the page re-renders, the `ref` (e.g., `e42`) may become stale.
1.  Simo v1.9.9+ attempts to self-heal. If it fails, run `simo snap <id>` again to get fresh references.
