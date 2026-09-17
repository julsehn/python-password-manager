#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_PATH="$SCRIPT_DIR/browser-extension/native/caixa_forta_native.sh"
HOST_INSTALL_DIR="$HOME/Library/Application Support/Caixa Forta/NativeMessaging"
INSTALLED_HOST_PATH="$HOST_INSTALL_DIR/caixa_forta_native.sh"
# Keep this in sync with browser-extension/manifest.chrome.json. The stable
# manifest key makes the unpacked extension use the same ID on every machine.
DEFAULT_CHROME_EXTENSION_ID="lcbgmkafanopplcefoapdfmhhjfoaamd"
CHROME_EXTENSION_ID="${1:-${CHROME_EXTENSION_ID:-$DEFAULT_CHROME_EXTENSION_ID}}"

chmod +x "$HOST_PATH"
mkdir -p "$HOST_INSTALL_DIR"
cp "$HOST_PATH" "$INSTALLED_HOST_PATH"
cp "$SCRIPT_DIR/browser-extension/native/caixa_forta_native.py" "$HOST_INSTALL_DIR/caixa_forta_native.py"
chmod +x "$INSTALLED_HOST_PATH" "$HOST_INSTALL_DIR/caixa_forta_native.py"

# 1. Register for Firefox
FF_DIRS=(
  "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
  "$HOME/Library/Application Support/Firefox/NativeMessagingHosts"
)

for FF_DIR in "${FF_DIRS[@]}"; do
  mkdir -p "$FF_DIR"

  cat << EOF > "$FF_DIR/caixa_forta.json"
{
  "name": "caixa_forta",
  "description": "Caixa Forta Native Messaging Host",
  "path": "$INSTALLED_HOST_PATH",
  "type": "stdio",
  "allowed_extensions": [
    "caixa-forta@juls.com"
  ]
}
EOF
done

# 2. Register for Google Chrome.
if [[ -n "$CHROME_EXTENSION_ID" ]]; then
    CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    mkdir -p "$CHROME_DIR"

    cat << EOF > "$CHROME_DIR/caixa_forta.json"
{
  "name": "caixa_forta",
  "description": "Caixa Forta Native Messaging Host",
  "path": "$INSTALLED_HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$CHROME_EXTENSION_ID/"
  ]
}
EOF
fi

echo "Native Messaging Host registered successfully for Firefox and Chrome!"
echo "Firefox manifests:"
for FF_DIR in "${FF_DIRS[@]}"; do
  echo "  $FF_DIR/caixa_forta.json"
done
if [[ -n "$CHROME_EXTENSION_ID" ]]; then
  echo "Chrome manifest: $CHROME_DIR/caixa_forta.json"
fi

