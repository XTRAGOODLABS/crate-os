# GOOD MIXX runtime

Crate OS embeds the user-provided GOOD MIXX `mixes.html`, branded assets, djay/Traktor readers, and recommendation engine. The page is not a React recreation.

The installed app launches a PyInstaller sidecar beside the Tauri executable, points it at bundled read-only interface assets, and stores mutable data in macOS Application Support. Crate OS validates `/health`, prevents duplicate managed processes, captures errors, and stops the child process on application exit.

## Preserved behavior

- LIVE Deck A and Deck B tracking from djay history
- GOOD MIX, PICK BY HAND, and NEXT IS PLAYING
- WHAT'S NEXT with proven transitions plus BPM, key, and energy filters
- REVIEW A SET, djay sessions on this Mac, and playlist CSV import
- MY MIXES and saved transition counts
- djay library keys and remembered screen keys

## Access modes

- **Mac only**: `127.0.0.1:18770`, no LAN listener. The dedicated port avoids collisions with a standalone GOOD MIXX installation on 8770.
- **iPad / Portal**: explicit `0.0.0.0:18770` listener protected by a newly generated token. The token is removed from the browser address after being exchanged for a cookie.

The LAN mode is intended only for a trusted local network. It is never enabled automatically.
