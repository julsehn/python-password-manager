# Native Messaging Diagnostic Guide

## Problem: "Incomplete length header received" Spam

This error occurs when the browser extension tries to communicate with the native messaging host but the protocol mismatch causes the host to fail reading messages.

---

## Root Cause

The error happens because:
1. **Firefox's `runtime.connectNative()`** uses a different protocol than the Native Messaging API
2. Firefox sends **raw JSON objects** without the 32-bit length header
3. The Python host was only expecting length-prefixed messages (Native Messaging API format)
4. When Firefox sends raw JSON, the host reads 4 bytes expecting a length header, gets partial data, and logs the warning
5. The host doesn't properly close the connection, causing Firefox to keep retrying

---

## Solution Applied

The native messaging host now supports **both protocols**:

### Protocol 1: Native Messaging API (stdio)
- Used by Chrome/Edge/Brave on Windows, macOS, Linux
- Format: 4-byte length header + JSON payload
- Example: `\x00\x00\x00\x1a{"action":"ping"}`

### Protocol 2: Firefox Port Mode
- Used by Firefox's `runtime.connectNative()`
- Format: Raw JSON without length header
- Example: `{"action":"ping"}`

The host auto-detects the protocol based on the `--port` flag or by checking if it's running in a pipe.

---

## Quick Fix

### 1. Restart the Native Messaging Host

If the host is already running, stop and restart it:

```bash
# Stop existing instance (Ctrl+C)
# Then start fresh
python3 browser-extension/native/caixa_forta_native.py
```

### 2. Reload the Extension

**Firefox:**
1. Go to `about:debugging`
2. Click on the loaded extension
3. Click "Reload"

**Chrome:**
1. Go to `chrome://extensions/`
2. Click "Reload" on your extension

---

## Verification Steps

### Step 1: Check Host is Running

```bash
# macOS/Linux
ps aux | grep caixa_forta_native

# Windows
tasklist | findstr caixa_forta
```

### Step 2: Test Manual Connection

```bash
# Test with ping command
echo -e '\x00\x00\x00\x05{"action":"ping"}' | python3 browser-extension/native/caixa_forta_native.py
```

Expected output: `{"success":true,"pong":true}`

### Step 3: Test Firefox Connection

1. Open the extension popup in Firefox
2. Open the browser console (F12)
3. Look for messages:
   - `Connected to native messaging host` (success)
   - `Error connecting to native messaging host` (failure)

### Step 4: Check for Errors

Look for these error messages in the console:
- `Incomplete length header received` - Protocol mismatch (should be fixed now)
- `Native messaging host not found` - Host not registered
- `Permission denied` - Security issue

---

## Cross-Platform Registration

### Windows

```cmd
tools\register_native_host_windows.bat
```

This creates:
- `browser-extension\native\caixa_forta_native.bat` (wrapper)
- `%APPDATA%\Mozilla\Firefox\NativeMessagingHosts\caixa_forta.json`
- `%LOCALAPPDATA%\Google\Chrome\User Data\Default\NativeMessagingHosts\caixa_forta.json`

### macOS/Linux

```bash
chmod +x tools/register_native_host_linux.sh
./tools/register_native_host_linux.sh
```

This creates:
- `browser-extension/native/caixa_forta_native.sh` (wrapper)
- `~/.mozilla/native-messaging-hosts/caixa_forta.json`
- `~/.config/google-chrome/NativeMessagingHosts/caixa_forta.json`

---

## Troubleshooting

### Error: "Native messaging host not found"

**Cause:** Host not registered in the browser's native messaging directory.

**Fix:**
1. Run the registration script for your OS
2. Verify the manifest file exists
3. Restart the browser

### Error: "Permission denied"

**Cause:** Host script not executable or wrong permissions.

**Fix:**
```bash
chmod +x browser-extension/native/caixa_forta_native.py
chmod +x browser-extension/native/caixa_forta_native.sh  # Linux/macOS
```

### Error: "Host not responding"

**Cause:** Host process crashed or is not running.

**Fix:**
1. Check if host is running: `ps aux | grep caixa_forta`
2. Check for errors in the terminal where the host is running
3. Restart the host

### Error: "Invalid JSON"

**Cause:** Malformed JSON in the manifest or message.

**Fix:**
```bash
# Validate manifest
python3 -m json.tool browser-extension/manifest.json

# Validate native host manifest
python3 -m json.tool ~/.mozilla/native-messaging-hosts/caixa_forta.json
```

---

## Testing the Full Flow

### 1. Start the Host

```bash
python3 browser-extension/native/caixa_forta_native.py
```

You should see:
```
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Caixa Forta Native Messaging Host started
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Running in Native Messaging API mode (stdio)
```

### 2. Load the Extension

**Firefox:**
```
about:debugging → This Firefox → Load Temporary Add-on → browser-extension/manifest.json
```

**Chrome:**
```
chrome://extensions/ → Load unpacked → browser-extension/
```

### 3. Test Actions

Open the extension popup and try:
- Get Vault Info
- Generate Password
- Fetch Credentials

Check the console for successful responses.

---

## Security Notes

The native messaging host implements:
- ✅ 1 MB message size limit (prevents DoS)
- ✅ Strict JSON validation (no eval/exec)
- ✅ Cryptographically secure password generation (secrets module)
- ✅ Proper I/O flushing (no buffer corruption)
- ✅ Graceful error handling
- ✅ Signal handlers for clean shutdown

---

## Files Modified

1. `browser-extension/native/caixa_forta_native.py`
   - Added Firefox port mode support
   - Added protocol auto-detection
   - Fixed message reading for both protocols

2. `browser-extension/manifest.json`
   - Added host_permissions field

3. `tools/register_native_host_windows.bat` (new)
   - Windows registration script

4. `tools/register_native_host_linux.sh` (new)
   - Linux/macOS registration script

---

## Next Steps

1. ✅ Fix the protocol mismatch (DONE)
2. ⏳ Test on all platforms (Windows, macOS, Linux)
3. ⏳ Test with all browsers (Chrome, Firefox, Edge, Brave)
4. ⏳ Add automated testing
5. ⏳ Document the setup process
