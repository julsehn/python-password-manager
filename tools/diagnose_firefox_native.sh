#!/bin/bash
# diagnose_firefox_native.sh – Check Firefox native messaging setup for Caixa Forta.
#
# Reads the expected ID from browser-extension/manifest.firefox.json and validates:
#   1. Host manifest exists in the correct macOS directory.
#   2. Host manifest is valid JSON.
#   3. The manifest "path" points to an executable file.
#   4. allowed_extensions contains the gecko ID from the Firefox extension manifest.
#   5. The shell wrapper finds python3.
#   6. The installed directory contains caixa_forta_native.py.
#
# Usage: ./tools/diagnose_firefox_native.sh
# Exit code: 0 = all checks pass, 1 = at least one check failed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FF_MANIFEST="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/caixa_forta.json"
EXT_MANIFEST="$SCRIPT_DIR/browser-extension/manifest.firefox.json"

PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
info() { echo "  ℹ️  $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Caixa Forta – Firefox Native Messaging Diagnostics"
echo "═══════════════════════════════════════════════════════════"

# ── 1. Host manifest exists ───────────
echo ""
echo "1. Host manifest"
if [ -f "$FF_MANIFEST" ]; then
  ok "Found: $FF_MANIFEST"
else
  fail "Not found: $FF_MANIFEST"
  echo "     Run: ./tools/install_native_host.sh"
fi

# ── 2. Host manifest is valid JSON ───
echo ""
echo "2. Manifest JSON validity"
if [ -f "$FF_MANIFEST" ]; then
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$FF_MANIFEST" 2>/dev/null; then
    ok "Valid JSON"
  else
    fail "Invalid JSON in $FF_MANIFEST"
  fi
else
  info "Skipped (manifest not found)"
fi

# ── 3. Host path is executable ────────
echo ""
echo "3. Host path executable"
if [ -f "$FF_MANIFEST" ]; then
  HOST_PATH=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['path'])" "$FF_MANIFEST" 2>/dev/null || echo "")
  if [ -z "$HOST_PATH" ]; then
    fail "Could not read 'path' from manifest"
  elif [ -x "$HOST_PATH" ]; then
    ok "Executable: $HOST_PATH"
  else
    fail "Not executable or not found: $HOST_PATH"
    echo "     Run: chmod +x \"$HOST_PATH\""
  fi
else
  info "Skipped (manifest not found)"
fi

# ── 4. allowed_extensions matches gecko id ─────────
echo ""
echo "4. allowed_extensions vs. gecko ID"
if [ -f "$EXT_MANIFEST" ]; then
  GECKO_ID=$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
print(d.get('browser_specific_settings',{}).get('gecko',{}).get('id',''))
" "$EXT_MANIFEST" 2>/dev/null || echo "")
  info "Firefox extension gecko ID: '$GECKO_ID'"

  if [ -f "$FF_MANIFEST" ]; then
    ALLOWED=$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
print('\n'.join(d.get('allowed_extensions',[])))
" "$FF_MANIFEST" 2>/dev/null || echo "")
    if echo "$ALLOWED" | grep -qF "$GECKO_ID"; then
      ok "'$GECKO_ID' is in allowed_extensions"
    else
      fail "'$GECKO_ID' NOT found in allowed_extensions (found: $ALLOWED)"
    fi
  else
    info "Skipped (manifest not found)"
  fi
else
  fail "Extension manifest not found: $EXT_MANIFEST"
fi

# ── 5. python3 reachable from the shell wrapper ────
echo ""
echo "5. python3 availability"
FOUND_PYTHON=""
for py in /opt/homebrew/bin/python3 /usr/local/bin/python3 \
          /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
          /usr/bin/python3; do
  if [ -x "$py" ]; then
    FOUND_PYTHON="$py"
    break
  fi
done
if [ -n "$FOUND_PYTHON" ]; then
  ok "Found: $FOUND_PYTHON"
else
  fail "No python3 found in the paths checked by caixa_forta_native.sh"
fi

# ── 6. native Python script present in install dir 
echo ""
echo "6. caixa_forta_native.py in install directory"
if [ -n "${HOST_PATH:-}" ]; then
  INSTALL_DIR="$(dirname "$HOST_PATH")"
  PY_SCRIPT="$INSTALL_DIR/caixa_forta_native.py"
  if [ -f "$PY_SCRIPT" ]; then
    ok "Found: $PY_SCRIPT"
  else
    fail "Not found: $PY_SCRIPT"
    echo "     Run: ./tools/install_native_host.sh"
  fi
else
  info "Skipped (host path unknown)"
fi

# ── 7. Quick probe via scripted client 
echo ""
echo "7. Quick probe (ping via scripted client)"
if [ -n "$FOUND_PYTHON" ] && [ -f "$SCRIPT_DIR/tools/native_host_probe.py" ]; then
  PROBE_OUTPUT=$("$FOUND_PYTHON" "$SCRIPT_DIR/tools/native_host_probe.py" 2>&1 | head -40 || true)
  if echo "$PROBE_OUTPUT" | grep -q "✅ ping OK"; then
    ok "Scripted probe ping succeeded"
  else
    fail "Scripted probe ping did not succeed (see below)"
    echo "---"
    echo "$PROBE_OUTPUT" | head -20
    echo "---"
  fi
else
  info "Skipped (python3 or probe script not available)"
fi

# ── Summary 
echo ""
echo "───────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo "───────────────────"
echo ""
echo "Where to see the real Firefox error:"
echo "  about:debugging → This Firefox → Inspect (on the extension) → Console"
echo "  OR: Browser Console (Cmd+Shift+J)"
echo ""
echo "Common messages:"
echo "  'No such native application caixa_forta' → manifest missing from FF_DIR above"
echo "  'Extension lacks permission'             → allowed_extensions mismatch"
echo "  Port disconnects immediately             → Python path wrong, or script crashes"
echo "  'Extension permission denied'            → host rejecting the origin (Phase 1 fixed)"
echo ""

[ "$FAIL" -eq 0 ]

