# Browser Extension Communication Fix - COMPLETE

## Problem Identified
The Firefox extension manifest was **missing the `native_messaging` configuration**. Without this, Firefox doesn't know how to communicate with the native messaging host.

## What Was Fixed

### 1. Added native_messaging to Firefox Manifest
Updated `manifest.firefox.json` to include:
```json
"native_messaging": {
  "hosts": [
    {
      "name": "caixa_forta",
      "path": "./native/caixa_forta_native.py",
      "type": "stdio"
    }
  ]
}
```

### 2. Rebuilt the Extension
The extension has been rebuilt in `browser-extension/build/firefox/` with the updated manifest.

### 3. Fixed Path Mismatch
Updated all browser registration files to use the Python native host instead of the shell script.

## How to Load the Fixed Extension

### For Firefox (Recommended - Temporary Load)

1. **Close Firefox completely**

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

1. **Close Chrome completely**

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

## Important Notes

### Why Use the Build Folder?
The `build/firefox/` and `build/chrome/` folders contain the **rebuilt extension** with the correct `native_messaging` configuration. The source folder (`browser-extension/`) still has the old manifest without this configuration.

### Native Messaging Registration
The native messaging host is already registered in your system:
- Firefox: `~/Library/Application Support/Mozilla/NativeMessagingHosts/caixa_forta.json`
- Chrome: `~/.config/google-chrome/NativeMessagingHosts/caixa_forta.json`

Both point to the correct Python native host.

## Troubleshooting

### Still Not Working?

1. **Check the manifest has native_messaging:**
   ```bash
   cat browser-extension/build/firefox/manifest.json | grep -A 5 native_messaging
   ```
   You should see the native_messaging configuration.

2. **Check native messaging host is registered:**
   - Firefox: `about:native-messaging`
   - Chrome: `chrome://native-messaging/`
   - Look for `caixa_forta` in the list

3. **Verify the Python host is executable:**
   ```bash
   ls -la browser-extension/native/caixa_forta_native.py
   # Should show: -rwxr-xr-x
   ```

4. **Restart the browser completely**
   - Quit all browser windows
   - Reopen the browser
   - Reload the extension

5. **Check for errors in browser console:**
   - Open DevTools (F12)
   - Look for errors related to native messaging

## Files Modified

1. `browser-extension/manifest.firefox.json` - Added native_messaging configuration
2. `browser-extension/build/firefox/manifest.json` - Rebuilt with native_messaging
3. `browser-extension/build/chrome/manifest.json` - Rebuilt
4. System registration files - Updated to use Python host

## Summary

The extension now has the correct `native_messaging` configuration in the Firefox manifest. Load the extension from the **build folder** (not the source folder) and it should connect to the desktop app.
