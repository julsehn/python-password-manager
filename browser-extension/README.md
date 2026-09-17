# Caixa Forta Browser Extension

This browser extension provides local autofill functionality for Caixa Forta credentials with native messaging integration.

## Features

- Autofill login credentials for websites
- Save new credentials to extension storage
- Cross-browser compatibility (Chrome & Firefox)
- **Native messaging integration** - Direct communication with the desktop app
- Browser-local credential storage

## Installation

### Prerequisites

1. **Desktop app must be running** - The extension communicates with the native messaging host, which requires the desktop app to be running.

2. **Install the native messaging host**:
   - Run `./tools/install_native_host.sh` from the project root.
   - The installer registers `browser-extension/native/caixa_forta_native.sh` for both browsers.

### Chrome Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **"Load unpacked"**
4. Select the `browser-extension/build/chrome` folder
5. The extension will be loaded

**Note**: When you first load the extension, Chrome will ask you to allow native messaging access. Click **"Allow"** when prompted.

### Firefox Installation

1. Open Firefox and navigate to `about:debugging`
2. Click **"This Firefox"** in the left sidebar
3. Click **"Load Temporary Add-on"**
4. Select `browser-extension/build/firefox/manifest.json`
5. The extension will be loaded

**Note**: Firefox may ask for native messaging permissions. Accept them when prompted.

## How It Works

The extension uses **native messaging** to communicate directly with the desktop app:

1. **Native Messaging Host** (`native_messaging_host.py`):
   - A Python script that runs as a background process
   - Listens for messages from the browser extension
   - Communicates with the desktop app's vault

2. **Manifest Configuration**:
   - The extension's `manifest.json` declares the native messaging host
   - Browser registers the host after installation

3. **Communication Flow**:
   ```
   Browser Extension → Native Messaging Host → Desktop App
   ```

## Available Actions

The extension supports the following actions:

- `getVaultInfo` - Get vault status (locked/unlocked, entry count)
- `unlockVault` - Unlock vault with master password
- `lockVault` - Lock the vault
- `fetchCredentials` - Get credentials for a specific site
- `saveCredentials` - Save new credentials
- `generatePassword` - Generate a random password
- `getActiveTab` - Get information about the active tab

## Troubleshooting

### Extension shows "Disconnected"

1. **Make sure the desktop app is running** - The native messaging host requires the desktop app to be active.

2. **Check native messaging permissions**:
   - Chrome: `chrome://native-messaging/`
   - Firefox: `about:native-messaging`
   - Ensure `caixa_forta` is listed and enabled

3. **Reinstall the extension**:
   - Remove the extension
   - Reload the unpacked extension
   - Accept native messaging permissions when prompted

### Native messaging host not found

1. **Reinstall the native messaging host**:

   ```bash
   ./tools/install_native_host.sh
   ```

2. **Check the registered host path**:
   - Ensure the browser host manifest points to `browser-extension/native/caixa_forta_native.sh`

3. **Restart the browser** after making changes

### Extension can't connect to the app

The extension has a fallback to HTTP API if native messaging fails:

1. **Check the server is running**:
   - The desktop app should start an HTTPS server on `https://127.0.0.1:8080`

2. **Verify the server endpoints**:
   - `/health` - Health check
   - `/api/v1/vault/handshake` - Get shared secret
   - `/api/v1/vault/unlock` - Unlock vault
   - `/api/v1/vault/credentials` - Get credentials
   - `/api/v1/vault/lock` - Lock vault
   - `/api/v1/vault/generate-password` - Generate password

## Security

- Credentials are stored in the browser's extension storage
- Native messaging provides a secure, port-less communication channel
- The desktop app handles all encryption and decryption
- No credentials are sent over the network

## Files

- `manifest.json` - Extension manifest (Manifest V3)
- `background.js` - Background service worker
- `popup.html` - Popup UI
- `popup.js` - Popup controller
- `content.js` - Content script for autofill
- `content.css` - Content script styles
- `native_messaging_host.py` - Native messaging host (Python)
- `native_messaging_host_wrapper.sh` - Shell wrapper for the host
- `icons/` - Extension icons

## License

MIT License - See the main repository for details.
