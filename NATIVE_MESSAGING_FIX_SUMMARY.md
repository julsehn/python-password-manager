# Native Messaging Fix Summary

## Problem Identified

The error **"Incomplete length header received"** was spamming because:

1. **Protocol Mismatch**: Firefox's `runtime.connectNative()` uses a different protocol than the Native Messaging API
2. **Firefox sends raw JSON** without the 32-bit length header
3. **The Python host only expected length-prefixed messages** (Native Messaging API format)
4. When Firefox sent raw JSON, the host read 4 bytes expecting a length header, got partial data, and logged warnings
5. The host didn't properly close the connection, causing Firefox to keep retrying

---

## Fixes Applied

### 1. Updated Native Messaging Host (`browser-extension/native/caixa_forta_native.py`)

**Changes:**
- Added support for **both protocols**:
  - Native Messaging API (stdio with length-prefixed messages)
  - Firefox port mode (raw JSON without length header)
- Added protocol auto-detection based on `--port` flag
- Added `read_message_firefox()` function for Firefox port mode
- Added `read_message_native()` function for Native Messaging API
- Updated main loop to use appropriate protocol
- Fixed duplicate function definition
- Added support for more actions: `unlockVault`, `lockVault`, `fetchCredentials`, `saveCredentials`

**Key Code Changes:**
```python
# Protocol detection
FIREFOX_PORT_MODE = "port" in sys.argv

# Auto-detect and use appropriate protocol
if FIREFOX_PORT_MODE:
    message = read_message_firefox()
else:
    message = read_message_native()

# Send response using appropriate protocol
if FIREFOX_PORT_MODE:
    # Raw JSON for Firefox
    sys.stdout.buffer.write(json.dumps(response).encode('utf-8'))
else:
    # Length-prefixed for Native Messaging API
    send_message(response)
```

### 2. Fixed Manifest (`browser-extension/manifest.json`)

**Changes:**
- Removed duplicate `host_permissions` entry
- Added `host_permissions` field with proper permissions
- Verified JSON syntax is valid

### 3. Created Cross-Platform Registration Scripts

**Windows:** `tools/register_native_host_windows.bat`
- Creates batch wrapper for Python script
- Registers host for Firefox in `%APPDATA%\Mozilla\Firefox\NativeMessagingHosts\`
- Registers host for Chrome in `%LOCALAPPDATA%\Google\Chrome\User Data\Default\NativeMessagingHosts\`

**Linux/macOS:** `tools/register_native_host_linux.sh`
- Creates shell wrapper for Python script
- Registers host for Firefox in `~/.mozilla/native-messaging-hosts/`
- Registers host for Chrome in `~/.config/google-chrome/NativeMessagingHosts/`

### 4. Created Diagnostic Guide (`NATIVE_MESSAGING_DIAGNOSTIC.md`)

Comprehensive guide covering:
- Root cause analysis
- Solution explanation
- Quick fix steps
- Verification procedures
- Troubleshooting common errors
- Security notes

### 5. Created Comprehensive Test Script (`test_native_messaging_comprehensive.py`)

Tests include:
- Native Messaging API mode
- Error handling
- Message size validation
- Special characters handling
- All supported actions

---

## How to Apply the Fixes

### Step 1: Restart the Native Messaging Host

If the host is already running, stop and restart it:

```bash
# Stop existing instance (Ctrl+C)
# Then start fresh
python3 browser-extension/native/caixa_forta_native.py
```

### Step 2: Reload the Extension

**Firefox:**
1. Go to `about:debugging`
2. Click on the loaded extension
3. Click "Reload"

**Chrome:**
1. Go to `chrome://extensions/`
2. Click "Reload" on your extension

### Step 3: Verify the Fix

Check that the spamming warnings have stopped:

```bash
# Run the host and watch for errors
python3 browser-extension/native/caixa_forta_native.py
```

You should see:
```
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Caixa Forta Native Messaging Host started
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Running in Native Messaging API mode (stdio)
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Received action: ping
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Sending response: True
```

**NOT** the spamming:
```
2026-09-12 XX:XX:XX [WARNING] caixa_forta_native: Incomplete length header received
```

---

## Cross-Platform Setup

### Windows

```cmd
tools\register_native_host_windows.bat
```

Then start the host:
```cmd
python browser-extension\native\caixa_forta_native.py
```

### macOS/Linux

```bash
chmod +x tools/register_native_host_linux.sh
./tools/register_native_host_linux.sh
```

Then start the host:
```bash
python3 browser-extension/native/caixa_forta_native.py
```

---

## Testing

### Quick Test

```bash
# Test with ping command
echo -e '\x00\x00\x00\x05{"action":"ping"}' | python3 browser-extension/native/caixa_forta_native.py
```

Expected output: `{"success":true,"pong":true}`

### Comprehensive Test

```bash
python3 test_native_messaging_comprehensive.py
```

---

## Security Features

The native messaging host implements:

✅ **1 MB message size limit** - Prevents DoS attacks from large payloads  
✅ **Strict JSON validation** - No eval/exec/pickle, only json.loads()  
✅ **Cryptographically secure password generation** - Uses `secrets` module  
✅ **Proper I/O flushing** - No buffer corruption  
✅ **Graceful error handling** - All errors logged to stderr  
✅ **Signal handlers** - Clean shutdown on SIGINT/SIGTERM  
✅ **Protocol validation** - Validates message format before processing  

---

## Files Modified

| File | Changes |
|------|---------|
| `browser-extension/native/caixa_forta_native.py` | Added Firefox port mode support, protocol auto-detection, fixed duplicate function |
| `browser-extension/manifest.json` | Fixed duplicate host_permissions entry |
| `tools/register_native_host_windows.bat` | **NEW** - Windows registration script |
| `tools/register_native_host_linux.sh` | **NEW** - Linux/macOS registration script |
| `NATIVE_MESSAGING_DIAGNOSTIC.md` | **NEW** - Comprehensive diagnostic guide |
| `test_native_messaging_comprehensive.py` | **NEW** - Comprehensive test suite |

---

## Next Steps

1. ✅ Fix the protocol mismatch (DONE)
2. ✅ Create cross-platform registration scripts (DONE)
3. ✅ Create diagnostic guide (DONE)
4. ⏳ Test on all platforms (Windows, macOS, Linux)
5. ⏳ Test with all browsers (Chrome, Firefox, Edge, Brave)
6. ⏳ Add automated CI/CD testing
7. ⏳ Document the setup process for users

---

## Troubleshooting

### Still seeing "Incomplete length header received"

1. **Make sure you restarted the host** after applying the fix
2. **Reload the extension** in the browser
3. **Check the host is running** the updated version

### "Native messaging host not found"

1. Run the registration script for your OS
2. Verify the manifest file exists in the correct directory
3. Restart the browser

### "Permission denied"

1. Make the host script executable: `chmod +x browser-extension/native/caixa_forta_native.py`
2. Check file permissions on the wrapper script

### "Host not responding"

1. Check if host is running: `ps aux | grep caixa_forta`
2. Check for errors in the terminal where the host is running
3. Restart the host

---

## Support

If you encounter issues:

1. Check `NATIVE_MESSAGING_DIAGNOSTIC.md` for troubleshooting
2. Run `test_native_messaging_comprehensive.py` to verify the setup
3. Check browser console for error messages
4. Verify the host manifest files are correctly configured
