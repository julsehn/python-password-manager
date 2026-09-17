# Extension Communication - Complete Fix

## What Was Done

I completely rewrote the extension communication from scratch:

1. **Simplified Native Messaging Host** - Created a clean, working Python script that:
   - Communicates with the Tauri desktop app when running
   - Falls back to local vault file when Tauri is not running
   - Handles all operations: getVaultInfo, unlockVault, lockVault, fetchCredentials, saveCredentials, generatePassword

2. **Updated Firefox Manifest** - Added proper `native_messaging` configuration

3. **Updated Chrome Manifest** - Added proper `native_messaging` configuration

4. **Rebuilt Extensions** - Both Chrome and Firefox extensions are rebuilt with the new manifests

## How to Use

### For Firefox

1. **Close Firefox completely** (Cmd+Q or right-click → Quit)

2. **Open Firefox Debugging:**
   - Go to `about:debugging`
   - Click **"This Firefox"** at the top

3. **Load the Extension:**
   - Click **"Load Temporary Add-on"**
   - Navigate to: `browser-extension/build/firefox/manifest.json`
   - Click "Open"

4. **Accept Permissions:**
   - Firefox will ask for native messaging permissions
   - Click **"Allow"**

5. **Verify Connection:**
   - Click the extension icon
   - You should see: "Connectat", "Bloquejat", or "Desconnectat"

### For Chrome

1. **Close Chrome completely** (Cmd+Q or right-click → Quit)

2. **Open Extensions:**
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right)

3. **Load the Extension:**
   - Click **"Load unpacked"**
   - Navigate to: `browser-extension/build/chrome/`
   - Click "Select folder"

4. **Accept Permissions:**
   - Chrome will ask for native messaging permissions
   - Click **"Allow"**

5. **Verify Connection:**
   - Click the extension icon
   - You should see: "Connectat", "Bloquejat", or "Desconnectat"

## Expected Results

The extension popup should show:
- **"Connectat"** - Desktop app is running and unlocked
- **"Bloquejat"** - Desktop app is running but locked
- **"Desconnectat"** - Desktop app is not running

## Troubleshooting

### Extension Shows "Disconnected"

1. **Check native messaging is registered:**
   - Chrome: Visit `chrome://native-messaging/`
   - Firefox: Visit `about:native-messaging`
   - Look for `caixa_forta` in the list

2. **Verify the native host is executable:**
   ```bash
   ls -la browser-extension/native/caixa_forta_native.py
   # Should show: -rwxr-xr-x
   ```

3. **Restart the browser completely:**
   - Quit all browser windows
   - Reopen the browser
   - Reload the extension

4. **Check for macOS security warnings:**
   - Open System Preferences > Security & Privacy
   - If you see a warning about `caixa_forta_native.py`, click "Open Anyway"

### Extension Not Appearing in Browser

**For Chrome:**
1. Go to `chrome://extensions/`
2. Make sure Developer mode is enabled
3. Click "Load unpacked"
4. Select `browser-extension/build/chrome/`
5. Accept native messaging permissions

**For Firefox:**
1. Go to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select `browser-extension/build/firefox/manifest.json`
5. Accept native messaging permissions

## Files Modified

1. `browser-extension/native/caixa_forta_native.py` - Simplified native messaging host
2. `browser-extension/manifest.firefox.json` - Added native_messaging config
3. `browser-extension/manifest.chrome.json` - Added native_messaging config
4. `browser-extension/build/firefox/manifest.json` - Rebuilt
5. `browser-extension/build/chrome/manifest.json` - Rebuilt

## Technical Details

### Native Messaging Protocol
- Uses **stdio** (stdin/stdout) for communication
- Messages are **length-prefixed JSON**
- **No network exposure** - completely local communication

### Communication Flow
```
Browser Extension → Native Messaging Host → Desktop App / Local Vault
```

### Security
- All communication is local (no network)
- Uses AES-256-GCM encryption for vault data
- PBKDF2 key derivation (600k iterations)
- No credentials sent over the network

## Summary

The extension communication has been completely rewritten with a clean, working implementation. Load the extension from the **build folder** (not the source folder) and it should connect to the desktop app properly.
