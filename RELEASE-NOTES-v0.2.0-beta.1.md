# Crate OS DJ Edition v0.2.0-beta.1

This beta combines Crate OS library and crate management with the user-updated GOOD MIXX experience in one macOS application.

## Highlights

- Scan and manage a local music library.
- Search, order, and save named playlists in Crate Builder as M3U8 or CSV.
- Follow live djay or Traktor history in GOOD MIXX LIVE.
- Save transitions with GOOD MIX and reuse them through WHAT'S NEXT.
- Review previous djay sets and browse MY MIXES.
- Use BPM, Camelot key, and energy recommendations already present in DJ Mixes.
- Optionally open a protected LAN link on an iPad or Meta Portal.

## Install

1. Download the build matching the Mac: Apple Silicon or Intel.
2. Unzip it and drag **Crate OS.app** to Applications.
3. This beta is not notarized. If macOS blocks the first launch, Control-click the app, choose **Open**, then confirm.
4. Open GOOD MIXX. Crate OS starts its bundled runtime automatically.

Existing `~/Portal-Stems-FX/data` files can be imported from the GOOD MIXX toolbar. Crate OS never overwrites data already present in its own application-support folder.

## Beta limitations

- Code signing and Apple notarization are not complete.
- Live djay behavior and Accessibility-based screen-key reading require a manual session with djay on the same Mac.
- Intel builds are prepared through GitHub Actions and still require execution on an Intel Mac for final runtime verification.
- Radio station (Live365) publishing tools are not part of Crate OS DJ Edition.
