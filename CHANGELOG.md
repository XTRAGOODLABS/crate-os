# Changelog

Crate OS began inside the Murphys Community Radio project in June 2026 and was split out for the DJ Edition. The Git history keeps the Crate OS steps from that project, leaving out the radio station's own publishing tools; personal folder paths in older steps were replaced with `<you>` / `<drive>`.

## 0.2.0-beta.1

- Opens on the local music library and preserves CSV, DJ-prep CSV, M3U8, and JSON exports.
- Restores a dedicated Crate Builder with ordered M3U8 and CSV playlist export.
- Integrates the user-updated GOOD MIXX interface, branding, assets, and Traktor support without replacing its LIVE, GOOD MIX, WHAT'S NEXT, REVIEW A SET, or MY MIXES workflows.
- Bundles DJ Mixes as a supervised sidecar, so installed builds do not require Python or `~/Portal-Stems-FX`.
- Stores DJ Mixes data under the macOS application-support directory and imports legacy mixes, library metadata, and remembered djay keys without overwriting existing app data.
- Defaults DJ Mixes to localhost. Optional iPad/Meta Portal access uses an explicit LAN mode with a generated access token.
- Stops the managed DJ Mixes process when Crate OS exits and reports startup failures from an application log.
- Radio station (Live365) publishing tools are not part of Crate OS DJ Edition. The Live365-ready CSV export and readiness labels stay.
- Adds a Buy Me a Coffee link.
- Adds Apple Silicon and Intel GitHub Actions build jobs.
- One Traktor link now feeds both the standalone GOOD MIXX app and Crate OS; the helper patches Traktor's own D2 file instead of shipping Native Instruments' copy.
- The GOOD MIXX helper refuses requests from other websites (DNS-rebinding and cross-site POST protection) and shuts itself down if Crate OS crashes.
- Switching between Mac-only and iPad/Portal modes stops the old helper cleanly and confirms the new one answers.
- Legacy import also brings over Traktor play history. QUIT and the start screen are hidden inside Crate OS.
- Crate Builder move up/down stays correct when a track went missing after a rescan.

## 0.1.0 — June 20, 2026

- First Crate OS desktop app: library scanning with audio runtime, metadata editing, DJ exports (CSV, DJ-prep CSV, M3U8, JSON), audio tag sync and restore, Crate OS branding.
