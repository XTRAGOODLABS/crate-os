# Troubleshooting

## GOOD MIXX does not open

Use **Reconnect** once. If startup still fails, reinstall the app. Crate OS writes details to `~/Library/Logs/labs.xtragood.crate-os/dj-mixes-error.log`.

## djay tracks do not appear

Crate OS reads djay's local history database without changing it. Confirm djay has played at least one track and that its library remains in the default `~/Music/djay` location.

## Keys shown on the decks are missing

In System Settings, open **Privacy & Security > Accessibility** and enable Crate OS, and under **Automation** allow Crate OS to control **System Events**. Each new build counts as a changed app: remove Crate OS from Accessibility with **–** and add it again with **+**. Quit and reopen Crate OS after changing the permission.

## iPad or Meta Portal cannot connect

Choose **Enable iPad / Portal**, keep both devices on the same trusted Wi-Fi, and open the complete URL shown in Crate OS. The URL contains a temporary access token and changes when LAN mode restarts. Do not share it beyond the trusted network.

## Previous mixes are missing

Choose **Import previous data** in GOOD MIXX. The import reads `~/Portal-Stems-FX/data` when it exists and skips any destination file that Crate OS already owns.

## macOS blocks the app

This beta is not notarized. Control-click **Crate OS.app**, choose **Open**, and confirm. A public release should be signed and notarized before broad distribution.

## "An older GOOD MIXX helper is still running"

A helper from an older build is holding the port. Open Activity Monitor, search **dj-mixes-server**, quit it, then press **Reconnect**. Helpers from this version stop by themselves if Crate OS quits unexpectedly.

## Traktor songs don't appear

Quit Traktor, choose **Add Traktor link** in the GOOD MIXX toolbar, then in Traktor add **Preferences > Controller Manager > Add… > Traktor > Kontrol D2** (no D2 hardware needed). One link feeds both Crate OS and the standalone GOOD MIXX app.
