# Caixa Forta - Native Messaging Setup Guide

## ✅ Fixes Applied

All manifests have been updated with:
- **Absolute paths** for the native messaging host script
- **Firefox `allowed_extensions`** configuration
- **Chrome `browser_specific_settings`** with native messaging hosts
- **Security improvements** in the Python host script

---

## 🔧 Firefox Setup (Current Priority)

### Step 1: Install the Extension

1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on..."
4. Select the file: `browser-extension/manifest.json`
   - **IMPORTANT**: Use the root manifest.json, NOT the build folder
   - The extension ID will be: `caixa-forta@juls.com`

### Step 2: Verify Native Messaging Host Registration

Firefox automatically registers the host when the extension is loaded. To verify:

```bash
# Check if Firefox can find the host
ls -la /Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py

# Verify the script is executable
chmod +x /Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py
```

### Step 3: Start the Native Messaging Host

The host script must be running in the background:

```bash
cd /Users/juls/Documents/GitHub/The-vault-project/python-password-manager
python3 browser-extension/native/caixa_forta_native.py
```

**Keep this terminal window open** - the host must be running for the extension to communicate.

### Step 4: Test the Connection

Open the extension popup in Firefox and check the console for messages. You should see:
- `INFO: Caixa Forta Native Messaging Host started`
- `INFO: Received action: <action_name>`

---

## 🌐 Chrome Setup (Future)

### Step 1: Get Extension ID

1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Reload" on your extension
4. The extension ID is the long string next to the extension name

### Step 2: Update Chrome Manifest

The manifest already has Chrome-specific native messaging configured:

```json
"browser_specific_settings": {
  "chrome": {
    "native_messaging": {
      "hosts": ["caixa_forta"]
    }
  }
}
```

### Step 3: Register the Host

For Chrome, you need to register the host in the registry:

**Option A: Using the Chrome Native Messaging Host Registration Tool**
1. Download from: https://chromium.googlesource.com/chromium/src/+/main/components/native_messaging/native_messaging_host_host_registrar.cc
2. Run the registrar tool with your host JSON

**Option B: Manual Registry Edit (Windows)**
```cmd
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\caixa_forta" /v "path" /t REG_SZ /d "C:\full\path\to\caixa_forta.bat" /f
```

**Option C: Create .bat Wrapper (Windows)**
Create `caixa_forta.bat`:
```batch
@echo off
python "%~dp0caixa_forta_native.py" %*
```

---

## 🔒 Security Features Implemented

### 1. Message Size Validation
- Maximum message size: **1 MB**
- Prevents DoS attacks from large payloads

### 2. Safe JSON Deserialization
- Uses `json.loads()` with strict validation
- Never uses `eval()`, `exec()`, or `pickle`
- Validates incoming data is a JSON object

### 3. Proper I/O Handling
- 32-bit big-endian length headers
- Explicit `sys.stdout.buffer.flush()` after every write
- No use of `print()` statements

### 4. Error Logging
- All errors logged to stderr (visible in browser console)
- Graceful error handling with fallback responses

### 5. Cryptographically Secure Password Generation
- Uses `secrets` module (not `random`)
- Configurable character sets
- Length validation (8-128 characters)

---

## 🐛 Troubleshooting

### Extension Can't Connect to Host

**Firefox:**
1. Check extension ID matches `allowed_extensions` in manifest
2. Verify host script is running
3. Reload extension in `about:debugging`
4. Check browser console for errors

**Chrome:**
1. Verify host is registered in registry
2. Check `chrome://native-messaging/` for host status
3. Reload extension

### Script Not Found Error

**Fix:** Use absolute path in manifest:
```json
"path": "/Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py"
```

### Permission Denied Error

**Fix:** Make script executable:
```bash
chmod +x browser-extension/native/caixa_forta_native.py
```

### Invalid JSON Error

**Fix:** Check manifest syntax:
```bash
python3 -m json.tool browser-extension/manifest.json
```

---

## 📝 Testing Commands

### Test Host Script Manually

```bash
# Start host in background
python3 browser-extension/native/caixa_forta_native.py &

# Send test message
echo -e "\x00\x00\x00\x05{\"action\":\"ping\"}" | python3 browser-extension/native/caixa_forta_native.py

# Expected output: {"success":true,"pong":true}
```

### Test from Extension

1. Open extension popup
2. Check console for connection messages
3. Try "Get Vault Info" action

---

## 🔄 Rebuilding Extensions

After manifest changes, you need to:

**Firefox:**
1. Go to `about:debugging`
2. Click on loaded extension
3. Click "Reload"

**Chrome:**
1. Go to `chrome://extensions/`
2. Click "Reload" button on your extension

---

## 📊 Current Status

- [x] Manifests updated with absolute paths
- [x] Firefox `allowed_extensions` added
- [x] Chrome `browser_specific_settings` added
- [x] Python host script secured with size limits
- [x] Security improvements implemented
- [ ] Firefox extension loaded and tested
- [ ] Chrome extension tested
- [ ] Windows compatibility verified

---

## 🚀 Next Steps

1. **Load Firefox extension** from `browser-extension/manifest.json`
2. **Start native messaging host** in a separate terminal
3. **Test connection** via extension popup
4. **Verify actions work** (getVaultInfo, generatePassword, etc.)
5. **Test Chrome** after getting extension ID
6. **Test Windows** if applicable
