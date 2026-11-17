# Troubleshooting

## GOOD MIXX does not open

Use **Reconnect** once. If startup still fails, reinstall the app. Crate OS writes details to `~/Library/Logs/labs.xtragood.crate-os/dj-mixes-error.log`.

## djay tracks do not appear

Crate OS reads djay's local history database without changing it. Confirm djay has played at least one track and that its library remains in the default `~/Music/djay` location.

## Keys shown on the decks are missing

In System Settings, open **Privacy & Security > Accessibility** and enable Crate OS. Quit and reopen Crate OS after changing the permission.

## iPad or Meta Portal cannot connect

Choose **Enable iPad / Portal**, keep both devices on the same trusted Wi-Fi, and open the complete URL shown in Crate OS. The URL contains a temporary access token and changes when LAN mode restarts. Do not share it beyond the trusted network.

## Previous mixes are missing

Choose **Import previous data** in GOOD MIXX. The import reads `~/Portal-Stems-FX/data` when it exists and skips any destination file that Crate OS already owns.

## macOS blocks the app

This beta is not notarized. Control-click **Crate OS.app**, choose **Open**, and confirm. A public release should be signed and notarized before broad distribution.
