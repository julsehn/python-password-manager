# Extension Communication Diagnostic Guide

## Current Status

✅ Desktop app: Running on port 8080
✅ Native host: Working correctly (tested directly)
✅ Firefox registration: Configured correctly
✅ Chrome registration: Configured correctly
✅ Build folder: Contains all necessary files

## The Issue

The extension shows "Disconnected" even though everything appears to be configured correctly. This suggests the issue is with how Firefox is loading or communicating with the extension.

## Immediate Diagnostic Steps

### Step 1: Check Firefox Native Messaging Status

Open Firefox and type in the address bar:
```
about:native-messaging
```

Look for `caixa_forta` in the list. It should show as:
- **Active** - Good
- **Ready** - Good  
- **Inactive** or not listed - Problem

### Step 2: Test Extension in Console

1. Open Firefox DevTools (press F12)
2. Go to the **Console** tab
3. Type this command and press Enter:

```javascript
chrome.runtime.getManifest()
```

**Expected result:** Should show your extension's manifest information
**If error:** The extension is not loaded properly

4. Then type this:

```javascript
chrome.runtime.sendMessage({action: 'getVaultInfo'}, (response) => {
    console.log('Response:', response);
});
```

**Expected result:** Should print a response in the console
**If error or no response:** Native messaging is not working

### Step 3: Check Extension Loading

1. Go to `about:debugging`
2. Click **"This Firefox"**
3. Look for "Caixa Forta Manager" in the list

**If you see it:**
- Click the three dots (⋮) next to it
- Click "View Background Page"
- In the new tab, press F12 and check Console for errors

**If you DON'T see it:**
- Click "Load Temporary Add-on"
- Select: `browser-extension/build/firefox/manifest.json`
- Accept native messaging permissions

### Step 4: Check for Console Errors

In Firefox DevTools Console (F12), look for:
- Red error messages
- Warnings about nativeMessaging
- Errors about caixa_forta
- Permission denied errors

## Common Issues and Solutions

### Issue: "nativeMessaging is not defined"
**Solution:** The extension needs to be reloaded. Close Firefox completely and reload.

### Issue: "Cannot connect to native host"
**Solution:** 
1. Check `about:native-messaging` to see if caixa_forta is listed
2. Verify the registration files exist in:
   - `~/Library/Application Support/Mozilla/NativeMessagingHosts/caixa_forta.json`
3. Restart Firefox

### Issue: Extension shows "Disconnected" but no errors
**Solution:** This could be a timing issue. Try:
1. Open the desktop app and unlock the vault
2. Wait 5 seconds
3. Click the extension icon again
4. If still disconnected, try reloading the extension

### Issue: Permission denied
**Solution:**
1. Close Firefox
2. Go to System Preferences → Security & Privacy
3. If there's a warning about the native host, click "Open Anyway"
4. Restart Firefox

## Quick Test

To quickly test if native messaging works:

1. Open Firefox
2. Press F12
3. In Console, type:
   ```javascript
   chrome.runtime.sendMessage({action: 'getVaultInfo'}, console.log)
   ```
4. You should see:
   ```
   {success: true, connected: true, unlocked: true, entryCount: 0, source: "tauri"}
   ```

If you see this, native messaging is working! The issue might be in how the popup displays the status.

## Next Steps

Please try the diagnostic steps above and tell me:

1. What you see at `about:native-messaging`
2. What happens when you run `chrome.runtime.getManifest()` in the console
3. What happens when you run the sendMessage test
4. Any error messages you see in the console

This information will help me identify the exact issue.
