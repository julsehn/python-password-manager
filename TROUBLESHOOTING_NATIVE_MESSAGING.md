# Troubleshooting Native Messaging Connection Issues

## Problem: "Incomplete length header received" Spam

This error appears when the native messaging host receives incomplete or malformed messages.

---

## Quick Fix

1. **Stop the existing host:**
   ```bash
   # Press Ctrl+C in the terminal where the host is running
   # Or kill it manually:
   pkill -f caixa_forta_native.py
   ```

2. **Start the host fresh:**
   ```bash
   python3 browser-extension/native/caixa_forta_native.py
   ```

3. **Reload the extension in Firefox:**
   - Go to `about:debugging`
   - Click on the loaded extension
   - Click "Reload"

4. **Run the launcher again:**
   ```bash
   ./Obrir_Caixa_Forta.command
   ```

---

## Diagnostic Tools

### 1. Run the Diagnostic Script

```bash
./tools/diagnose_native_messaging.sh
```

This script will:
- Start the host with debug logging
- Test the connection with various messages
- Capture detailed logs to `/tmp/caixa_forta_diagnostic_*.log`

### 2. Start Host with Debug Logging

```bash
python3 browser-extension/native/caixa_forta_native.py --debug
```

This will show detailed logging including:
- Raw bytes received
- Message parsing details
- Protocol detection

### 3. Check Host is Running

```bash
# macOS/Linux
ps aux | grep caixa_forta_native

# Check the log file
cat /tmp/caixa_forta_host.log
```

---

## Common Issues and Solutions

### Issue 1: Host Starts But Firefox Can't Connect

**Symptoms:**
- Host starts successfully
- No "Incomplete length header" errors
- But extension shows "Desconnectat"

**Solution:**
1. Check Firefox extension ID matches the manifest
2. Verify the host manifest is in the correct location:
   ```bash
   ls -la ~/.mozilla/native-messaging-hosts/caixa_forta.json
   ```
3. Restart Firefox completely

### Issue 2: "Incomplete length header received" Spam

**Symptoms:**
- Host logs repeated "Incomplete length header received" warnings
- Connection fails

**Possible Causes:**

#### Cause 2a: Host Not Ready When Firefox Tries to Connect

**Solution:**
The launcher script now starts the host with `nohup` and waits 5 seconds before Firefox tries to connect. This should fix the timing issue.

#### Cause 2b: Protocol Mismatch

**Solution:**
The host now supports both protocols. Make sure you're using the correct version:
```bash
# Check you have the latest version
git pull
```

#### Cause 2c: Firefox Trying to Connect Multiple Times

**Solution:**
Firefox might be trying to reconnect multiple times. Check the host log to see if it's handling reconnections gracefully.

### Issue 3: "Native messaging host not found"

**Symptoms:**
- Extension can't find the native messaging host
- Error in browser console

**Solution:**
1. Run the registration script:
   ```bash
   ./tools/register_native_host_linux.sh
   ```

2. Verify the manifest exists:
   ```bash
   ls -la ~/.mozilla/native-messaging-hosts/caixa_forta.json
   ```

3. Check the manifest content:
   ```bash
   cat ~/.mozilla/native-messaging-hosts/caixa_forta.json
   ```

4. Restart Firefox

### Issue 4: "Permission denied"

**Symptoms:**
- Host can't read/write to the vault
- Permission errors in logs

**Solution:**
1. Check file permissions:
   ```bash
   ls -la ~/.password_manager/
   ```

2. Fix permissions:
   ```bash
   chmod 700 ~/.password_manager
   chmod 600 ~/.password_manager/vault.json
   ```

3. Make the host script executable:
   ```bash
   chmod +x browser-extension/native/caixa_forta_native.py
   ```

---

## Manual Testing

### Test 1: Manual Connection Test

```bash
# Start the host in the background
python3 browser-extension/native/caixa_forta_native.py &
HOST_PID=$!

# Wait for it to start
sleep 2

# Send a test message
echo '{"action":"ping"}' | python3 -c "
import sys
import struct
import json

data = json.loads(sys.stdin.read())
encoded = json.dumps(data).encode('utf-8')
length = struct.pack('@I', len(encoded))
sys.stdout.buffer.write(length + encoded)
sys.stdout.flush()
" | python3

# Check the response
# You should see: {"success":true,"pong":true}

# Stop the host
kill $HOST_PID
```

### Test 2: Check Firefox Connection

1. Open Firefox
2. Go to `about:debugging`
3. Click on the loaded extension
4. Click "View Background Page"
5. Open the browser console (F12)
6. Look for messages:
   - `Connected to native messaging host` (success)
   - `Error connecting to native messaging host` (failure)

### Test 3: Check Host Logs

```bash
# The host logs to stderr by default
# When running with nohup, logs go to /tmp/caixa_forta_host.log

tail -f /tmp/caixa_forta_host.log
```

Look for:
- `INFO: Caixa Forta Native Messaging Host started` (success)
- `WARNING: Incomplete length header received` (error)
- `INFO: Received action: <action_name>` (processing)

---

## Understanding the Error

### What "Incomplete length header received" Means

The native messaging protocol uses a 32-bit (4-byte) length header before each message:

```
[4 bytes: message length][message payload]
```

When the host receives less than 4 bytes, it logs this warning. This can happen when:

1. **The sender (Firefox) hasn't finished writing the message**
2. **The connection is being closed prematurely**
3. **There's a protocol mismatch**
4. **The host is reading too early**

### Why It Happens with Firefox

Firefox's `runtime.connectNative()` uses a different protocol than the Native Messaging API:

- **Native Messaging API**: Length-prefixed messages via stdin/stdout
- **Firefox Port Mode**: Raw JSON messages via a named pipe

The host now supports both protocols automatically.

---

## Step-by-Step Troubleshooting

### Step 1: Clean Up

```bash
# Stop all instances
pkill -f caixa_forta_native.py

# Remove old log files
rm -f /tmp/caixa_forta_host.log /tmp/caixa_forta_diagnostic_*.log
```

### Step 2: Start Host Manually

```bash
# Start the host and watch the logs
python3 browser-extension/native/caixa_forta_native.py --debug
```

You should see:
```
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Caixa Forta Native Messaging Host started
2026-09-12 XX:XX:XX [INFO] caixa_forta_native: Running in Native Messaging API mode (stdio)
```

### Step 3: Test with Manual Messages

While the host is running, send test messages:

```bash
# Test ping
echo '{"action":"ping"}' | python3 "$HOST_SCRIPT"

# Test getVaultInfo
echo '{"action":"getVaultInfo"}' | python3 "$HOST_SCRIPT"

# Test generatePassword
echo '{"action":"generatePassword","options":{"length":16}}' | python3 "$HOST_SCRIPT"
```

### Step 4: Load Extension

1. Open Firefox
2. Go to `about:debugging`
3. Load the extension from `browser-extension/manifest.json`
4. Check the console for connection messages

### Step 5: Check for Errors

Look for these error messages:
- `Incomplete length header received` - Protocol/timing issue
- `Native messaging host not found` - Registration issue
- `Permission denied` - File permission issue

---

## Advanced Debugging

### Enable Verbose Logging

```bash
# Start with debug mode
python3 browser-extension/native/caixa_forta_native.py --debug
```

This will show:
- Raw bytes received
- Message parsing details
- Protocol detection

### Check Firefox Console

1. Open the extension popup
2. Open browser console (F12)
3. Look for messages from `background.js`:
   - `Connected to native messaging host`
   - `Native messaging port disconnected`
   - `Error connecting to native messaging host`

### Check Firefox Native Messaging

1. In Firefox, go to `about:debugging`
2. Click "This Firefox"
3. Click on the extension
4. Click "View Background Page"
5. Check the console for native messaging errors

---

## Files to Check

| File | Purpose |
|------|---------|
| `browser-extension/native/caixa_forta_native.py` | Native messaging host script |
| `browser-extension/manifest.json` | Extension manifest |
| `~/.mozilla/native-messaging-hosts/caixa_forta.json` | Firefox host manifest |
| `/tmp/caixa_forta_host.log` | Host log file |
| `/tmp/caixa_forta_diagnostic_*.log` | Diagnostic log file |

---

## Getting Help

If you're still having issues:

1. **Run the diagnostic script:**
   ```bash
   ./tools/diagnose_native_messaging.sh
   ```

2. **Check the log file:**
   ```bash
   cat /tmp/caixa_forta_diagnostic_*.log
   ```

3. **Share the following information:**
   - Host log file contents
   - Firefox console errors
   - Output of `ps aux | grep caixa_forta`
   - Output of `cat ~/.mozilla/native-messaging-hosts/caixa_forta.json`

---

## Known Issues

### Issue: Host Crashes on First Message

**Status:** Fixed in latest version

The host now properly handles the first message and doesn't crash.

### Issue: Firefox Keeps Reconnecting

**Status:** Expected behavior

Firefox may try to reconnect if the connection is lost. The host now handles this gracefully.

### Issue: "Port already in use"

**Status:** Known issue

If the host is already running, the launcher will detect it and not start a new instance.

---

## Contact

If you need further assistance, please provide:
1. Output of `./tools/diagnose_native_messaging.sh`
2. Firefox console errors
3. Host log file contents
