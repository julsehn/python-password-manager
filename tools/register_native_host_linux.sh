#!/bin/bash
set -euo pipefail

# ============================================================================
# Caixa Forta - Linux/macOS Native Messaging Host Registration
# Registers the native messaging host for Chrome and Firefox on Linux/macOS
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
HOST_SCRIPT="$PROJECT_DIR/browser-extension/native/caixa_forta_native.py"
HOST_NAME="caixa_forta"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  Caixa Forta - Linux/macOS Registration"
echo "========================================"
echo ""

# Check if host script exists
if [ ! -f "$HOST_SCRIPT" ]; then
    echo -e "${RED}ERROR: Host script not found: $HOST_SCRIPT${NC}"
    exit 1
fi

# Make host script executable
chmod +x "$HOST_SCRIPT"

# Create a shell wrapper for the Python script
WRAPPER_SCRIPT="$PROJECT_DIR/browser-extension/native/caixa_forta_native.sh"

echo "Creating shell wrapper..."
cat > "$WRAPPER_SCRIPT" << 'EOF'
#!/bin/bash
# Caixa Forta Native Messaging Host Wrapper
exec python3 "$0" "$@"
EOF

# Actually, we need to call the Python script directly
cat > "$WRAPPER_SCRIPT" << WRAPPER_EOF
#!/bin/bash
# Caixa Forta Native Messaging Host Wrapper
# This wrapper ensures the Python script is executed with proper arguments
exec python3 "$(dirname "$0")/caixa_forta_native.py" "\$@"
WRAPPER_EOF

chmod +x "$WRAPPER_SCRIPT"

echo "$WRAPPER_SCRIPT"

echo ""
echo "========================================"
echo "  Registering for Firefox"
echo "========================================"
echo ""

# Firefox registration
# Firefox uses: ~/.mozilla/native-messaging-hosts/

FF_DIR="$HOME/.mozilla/native-messaging-hosts"
if [ ! -d "$FF_DIR" ]; then
    mkdir -p "$FF_DIR"
fi

# Create Firefox manifest
cat > "$FF_DIR/${HOST_NAME}.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Caixa Forta Native Messaging Host",
  "path": "$WRAPPER_SCRIPT",
  "type": "stdio",
  "allowed_extensions": [
    "caixa-forta@juls.com"
  ]
}
EOF

echo "Firefox manifest created: $FF_DIR/${HOST_NAME}.json"
echo ""

echo "========================================"
echo "  Registering for Chrome"
echo "========================================"
echo ""

# Chrome registration
# Chrome uses: ~/.config/google-chrome/NativeMessagingHosts/

CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
if [ ! -d "$CHROME_DIR" ]; then
    mkdir -p "$CHROME_DIR"
fi

# Create Chrome manifest
cat > "$CHROME_DIR/${HOST_NAME}.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Caixa Forta Native Messaging Host",
  "path": "$WRAPPER_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://lcbgmkafanopplcefoapdfmhhjfoaamd/"
  ]
}
EOF

echo "Chrome manifest created: $CHROME_DIR/${HOST_NAME}.json"
echo ""

echo "========================================"
echo "  Registration Complete!"
echo "========================================"
echo ""
echo "Firefox manifest: $FF_DIR/${HOST_NAME}.json"
echo "Chrome manifest: $CHROME_DIR/${HOST_NAME}.json"
echo ""
echo "Next steps:"
echo "1. Start the native messaging host:"
echo "   python3 $HOST_SCRIPT"
echo ""
echo "2. Load the extension in Firefox:"
echo "   - Open about:debugging"
echo "   - Click 'This Firefox' -> 'Load Temporary Add-on...'"
echo "   - Select: $PROJECT_DIR/browser-extension/manifest.json"
echo ""
echo "3. Test the connection from the extension popup"
echo ""
