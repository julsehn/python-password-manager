# Browser Extension Communication Fix

## Problem
The browser extension was unable to communicate with the desktop app because of a **path mismatch** in the native messaging host configuration.

## Root Cause
The manifest.json points to the Python native host (`caixa_forta_native.py`), but the registration files were pointing to the shell script (`caixa_forta_native.sh`). This mismatch prevented the browser from finding the correct host.

## Solution Applied

### 1. Fixed Path Mismatch
Updated all native messaging host registration files to use the correct Python native host:
```
/Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py
```

### 2. Native Messaging Host Registration
Created native messaging host configuration files for both browsers:

**Firefox** (4 locations):
- `~/.mozilla/native-messaging-hosts/caixa_forta.json`
- `~/.mozilla-firefox/native-messaging-hosts/caixa_forta.json`
- `~/Library/Application Support/Mozilla/NativeMessagingHosts/caixa_forta.json`
- `~/Library/Application Support/Firefox/NativeMessagingHosts/caixa_forta.json`

**Chrome**:
- `~/.config/google-chrome/NativeMessagingHosts/caixa_forta.json`

### 3. Made Native Host Executable
Made the Python native host executable (mode 755).

## How Native Messaging Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Browser    │────▶│  Native Messaging│────▶│  Desktop    │
│  Extension  │     │  (Python)        │     │  Tauri App  │
└─────────────┘     └──────────────────┘     └─────────────┘
       │                       │                       │
       │   JSON messages       │   JSON messages       │
       │   (encrypted)        │   (encrypted)         │
       │                       │   (encrypted)         │
       │◀─────────────────────┤◀──────────────────────┤
       │   Responses          │   Responses           │
       └──────────────────────┴───────────────────────┘
```

## Next Steps for User

### 1. Restart Your Browser
Close and reopen your browser (Chrome or Firefox) to load the new native messaging host configuration.

### 2. Reload the Extension

**For Chrome:**
1. Go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Find "Caixa Forta Manager" extension
4. Click the **Reload** button (circular arrow icon)

**For Firefox:**
1. Go to `about:debugging`
2. Click **"This Firefox"** at the top
3. Find "Caixa Forta Manager" in the list
4. Click **"Reload"** button

### 3. Verify Connection
After reloading, the extension popup should show:
- Status: "Connectat" (Connected) if the desktop app is running and unlocked
- Status: "Bloquejat" (Locked) if the desktop app is running but locked
- Status: "Desconnectat" (Disconnected) if the desktop app is not running

## Testing the Fix

### Test 1: Check Native Messaging Status
**Chrome:** Visit `chrome://native-messaging/`
**Firefox:** Visit `about:native-messaging`

You should see `caixa_forta` listed as an active native messaging host.

### Test 2: Extension Communication
1. Open the extension popup
2. You should see the status indicator
3. If the desktop app is running, it should show "Connectat" or "Bloquejat"
4. If not running, it should show "Desconnectat" with a "Reintentar connexió" button

### Test 3: Vault Operations
1. Open the desktop app and unlock the vault
2. Open the extension popup
3. Click "Refresh" - it should show your credentials
4. Try copying a password - it should work

## Troubleshooting

### Extension Still Shows "Disconnected"

1. **Check native messaging is active:**
   - Chrome: `chrome://native-messaging/`
   - Firefox: `about:native-messaging`
   - Look for `caixa_forta` in the list

2. **Verify the host is executable:**
   ```bash
   ls -la browser-extension/native/caixa_forta_native.py
   # Should show: -rwxr-xr-x
   ```

3. **Re-register the native host:**
   ```bash
   # Update registration files to use the Python host
   python3 -c "
import os, json

HOST = '/Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py'

FF_DIRS = [
    os.path.expanduser('~/.mozilla/native-messaging-hosts'),
    os.path.expanduser('~/.mozilla-firefox/native-messaging-hosts'),
    os.path.expanduser('~/Library/Application Support/Mozilla/NativeMessagingHosts'),
    os.path.expanduser('~/Library/Application Support/Firefox/NativeMessagingHosts'),
]

for ff_dir in FF_DIRS:
    os.makedirs(ff_dir, exist_ok=True)
    config = {
        'name': 'caixa_forta',
        'description': 'Caixa Forta Native Messaging Host',
        'path': HOST,
        'type': 'stdio',
        'allowed_extensions': ['lcbgmkafanopplcefoapdfmhhjfoaamd', 'caixa-forta@juls.com']
    }
    with open(os.path.join(ff_dir, 'caixa_forta.json'), 'w') as f:
        json.dump(config, f, indent=2)

CHROME_DIR = os.path.expanduser('~/.config/google-chrome/NativeMessagingHosts')
os.makedirs(CHROME_DIR, exist_ok=True)
config = {
    'name': 'caixa_forta',
    'description': 'Caixa Forta Native Messaging Host',
    'path': HOST,
    'type': 'stdio',
    'allowed_origins': ['chrome-extension://lcbgmkafanopplcefoapdfmhhjfoaamd/']
}
with open(os.path.join(CHROME_DIR, 'caixa_forta.json'), 'w') as f:
    json.dump(config, f, indent=2)

print('Native messaging host registered successfully!')
"
   ```

4. **Restart the browser completely**

5. **Check browser permissions:**
   - macOS: Open System Preferences > Security & Privacy > Allow "caixa_forta_native.py"

### "Permission Denied" Error

On macOS, you may need to allow the native host:
1. Open System Preferences
2. Go to Security & Privacy
3. If you see a warning about "caixa_forta_native.py", click "Open Anyway"

### Extension Not Appearing in Browser

1. **Chrome:**
   - Go to `chrome://extensions/`
   - Make sure Developer mode is enabled
   - Click "Load unpacked"
   - Select the `browser-extension` folder
   - Accept native messaging permissions when prompted

2. **Firefox:**
   - Go to `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `browser-extension/manifest.json`
   - Accept native messaging permissions when prompted

## Files Modified

1. **Created/Updated:**
   - `~/.mozilla/native-messaging-hosts/caixa_forta.json`
   - `~/.mozilla-firefox/native-messaging-hosts/caixa_forta.json`
   - `~/Library/Application Support/Mozilla/NativeMessagingHosts/caixa_forta.json`
   - `~/Library/Application Support/Firefox/NativeMessagingHosts/caixa_forta.json`
   - `~/.config/google-chrome/NativeMessagingHosts/caixa_forta.json`

2. **Modified permissions:**
   - `browser-extension/native/caixa_forta_native.py` (chmod 755)

## Technical Details

### Native Messaging Protocol
The WebExtension Native Messaging protocol uses:
- **stdio (stdin/stdout)** for communication
- **Length-prefixed JSON messages** for efficiency
- **No network exposure** - completely local communication

### Message Format
```json
{
  "action": "fetchCredentials",
  "site": "example.com"
}
```

### Security
- All communication is local (no network)
- Uses AES-256-GCM encryption for vault data
- PBKDF2 key derivation (600k iterations)
- No credentials sent over the network

## Summary

The fix involved correcting the native messaging host path in the browser registration files. The manifest.json correctly points to the Python native host (`caixa_forta_native.py`), but the registration files were pointing to the shell script. After updating all registration files to use the correct Python path and restarting the browser, the extension should be able to communicate with the desktop app.
