#!/bin/bash
# install_native_host.sh – Register the SherLock native messaging host.
#
# Usage:
#   ./tools/install_native_host.sh [CHROME_EXTENSION_ID]
#
# The stable Chrome extension ID (derived from the key in manifest.chrome.json)
# is used by default.  Pass a different ID only if you are testing a build with
# a different key.
#
# On macOS this script registers for:
#   • Firefox  → ~/Library/Application Support/Mozilla/NativeMessagingHosts/
#   • Chrome   → ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
#
# Other Chromium forks (Edge, Brave, Chromium) each have their own host
# directories.  They are NOT registered by default.  To add one, copy
# the Chrome manifest to the appropriate directory and adjust allowed_origins.
# See: https://developer.chrome.com/docs/apps/nativeMessaging/#native-messaging-host-location

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_PATH="$SCRIPT_DIR/browser-extension/native/sherlock_native.sh"
HOST_INSTALL_DIR="$HOME/Library/Application Support/SherLock/NativeMessaging"
INSTALLED_HOST_PATH="$HOST_INSTALL_DIR/sherlock_native.sh"

# This ID is derived from the key in browser-extension/manifest.chrome.json.
# Do NOT change this without also updating that key.
DEFAULT_CHROME_EXTENSION_ID="lcbgmkafanopplcefoapdfmhhjfoaamd"
CHROME_EXTENSION_ID="${1:-${CHROME_EXTENSION_ID:-$DEFAULT_CHROME_EXTENSION_ID}}"

chmod +x "$HOST_PATH"
mkdir -p "$HOST_INSTALL_DIR"
cp "$HOST_PATH" "$INSTALLED_HOST_PATH"
cp "$SCRIPT_DIR/browser-extension/native/sherlock_native.py" \
   "$HOST_INSTALL_DIR/sherlock_native.py"
chmod +x "$INSTALLED_HOST_PATH" "$HOST_INSTALL_DIR/sherlock_native.py"

# macOS (stable + Developer Edition): ~/Library/Application Support/Mozilla/NativeMessagingHosts/
# The path "$HOME/Library/Application Support/Firefox/NativeMessagingHosts/" is
# NOT read by any current Firefox release on macOS; only the Mozilla path is.
FF_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
mkdir -p "$FF_DIR"
cat > "$FF_DIR/sherlock.json" << EOF
{
  "name": "sherlock",
  "description": "SherLock Native Messaging Host",
  "path": "$INSTALLED_HOST_PATH",
  "type": "stdio",
  "allowed_extensions": [
    "sherlock@juls.com"
  ]
}
EOF

CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$CHROME_DIR"
cat > "$CHROME_DIR/sherlock.json" << EOF
{
  "name": "sherlock",
  "description": "SherLock Native Messaging Host",
  "path": "$INSTALLED_HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$CHROME_EXTENSION_ID/"
  ]
}
EOF

echo ""
echo "✅ Native Messaging Host installed:"
echo "   Host: $INSTALLED_HOST_PATH"
echo ""
echo "   Firefox manifest:  $FF_DIR/sherlock.json"
echo "   Chrome manifest:   $CHROME_DIR/sherlock.json"
echo ""
echo "   Chrome extension ID: $CHROME_EXTENSION_ID"
echo "   (Load build/chrome as an unpacked extension; the ID is fixed by the manifest key.)"
echo ""
echo "ℹ️  Snap/Flatpak Firefox on Linux uses a different host directory and may not"
echo "   be able to run native hosts at all. See browser-extension/NATIVE_MESSAGING.md."
