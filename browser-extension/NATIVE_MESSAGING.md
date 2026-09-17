# Browser Extension Native Messaging Setup

## Overview

The Caixa Forta browser extension uses **native messaging** for secure, direct communication with the desktop app. This provides:

✅ **Direct stdio communication** - No network exposure  
✅ **AES-256-GCM encryption** - Industry-standard security  
✅ **PBKDF2 key derivation** - 600k iterations for brute-force protection  
✅ **Cross-platform** - Works on macOS, Windows, and Linux  
✅ **Tauri integration** - Communicates with the desktop app when running

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Browser    │────▶│  Native Messaging│────▶│  Desktop    │
│  Extension  │     │  (Python)        │     │  Tauri App  │
└─────────────┘     └──────────────────┘     └─────────────┘
       │                       │                       │
       │   JSON messages       │   JSON messages       │
       │   (encrypted)        │   (encrypted)         │
       │                       │                       │
       │◀─────────────────────┤◀──────────────────────┤
       │   Responses          │   Responses           │
       └──────────────────────┴───────────────────────┘
```

## Native Messaging Host

**Location**: `browser-extension/native/caixa_forta_native.py`

This Python script:
- Implements the WebExtension Native Messaging protocol
- Uses length-prefixed messages for efficiency
- Manages secure in-memory sessions
- Integrates with the Tauri desktop API
- Falls back to local vault file if Tauri is not running

## Installation

### 1. Run the Launcher

The `Obrir_Caixa_Forta.command` script automatically sets up native messaging:

```bash
./Obrir_Caixa_Forta.command
```

This will:
- Build the browser extension
- Register the native messaging host with Firefox and Chrome
- Launch the application

### 2. Manual Setup (if needed)

If you need to set up native messaging manually:

```bash
# Make the native host executable
chmod +x browser-extension/native/caixa_forta_native.py

# Run the setup script
./tools/install_native_host.sh
```

This creates registration files at:
- **Firefox**: `~/.mozilla/native-messaging-hosts/caixa_forta.json`
- **Chrome**: `~/.config/google-chrome/NativeMessagingHosts/caixa_forta.json`

### 3. Load the Extension

#### Chrome:
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **"Load unpacked"**
4. Select the `browser-extension` folder
5. **Accept native messaging permissions** when prompted

#### Firefox:
1. Go to `about:debugging`
2. Click **"This Firefox"**
3. Click **"Load Temporary Add-on"**
4. Select `browser-extension/manifest.json`
5. **Accept native messaging permissions** when prompted

## How It Works

### 1. Extension Requests Data
The extension sends a JSON message to the native host:
```json
{
  "action": "fetchCredentials",
  "site": "example.com"
}
```

### 2. Native Host Checks Tauri
The native host first checks if the Tauri desktop app is running:
- If running and unlocked → forwards request to Tauri API
- If not running → uses local session cache

### 3. Tauri Handles Request
If Tauri is running, it handles the request via its HTTPS API:
- `/api/v1/vault/credentials?domain=example.com`

### 4. Response Returns
The response flows back through the same path to the extension.

## Security Features

1. **Native Messaging**: Direct OS stdio bridge, no network exposure
2. **AES-256-GCM**: Strong encryption for all vault data
3. **PBKDF2 (600k iterations)**: Slow key derivation prevents brute-force
4. **Session Management**: In-memory sessions with secure temp files
5. **No credentials in transit**: All communication is local

## Troubleshooting

### Extension shows "Disconnected"

1. **Check the native host is executable**:
   ```bash
   chmod +x browser-extension/native/caixa_forta_native.py
   ```

2. **Verify native messaging is registered**:
   - Chrome: `chrome://native-messaging/`
   - Firefox: `about:native-messaging`
   - Look for `caixa_forta` in the list

3. **Re-run the setup script**:
   ```bash
   ./tools/install_native_host.sh
   ```

4. **Restart the browser**

### "Permission denied" on macOS

1. Open **System Preferences > Security & Privacy**
2. Click **"Open Anyway"** for the native host script

### Native host not found

1. Make sure you ran `Obrir_Caixa_Forta.command` or the setup script
2. Check the registration files exist at the paths shown above
3. Restart the browser

## Files

- `browser-extension/native/caixa_forta_native.py` - Native messaging host
- `browser-extension/manifest.json` - Extension manifest (includes native_messaging config)
- `tools/install_native_host.sh` - Registration script
- `Obrir_Caixa_Forta.command` - Main launcher with auto-setup

## Security Notes

- The native messaging host runs with the same privileges as the browser
- Keep the host script secure and up-to-date
- The host only communicates with the local desktop app
- No credentials are sent over the network
