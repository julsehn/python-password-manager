# SherLock browser extension

Fills login forms and saves new credentials without giving the browser access to the vault file. The extension talks to the desktop app through a native messaging host; it never opens `vault.json` itself.

Chrome uses Manifest V3, Firefox Manifest V2. Both builds come from the same source.

## Before you start

You need the desktop app running, the native host registered for your browser, and a one-time pairing between the extension and the app. Without the pairing the extension can open, but every vault action fails.

```bash
# from the repository root
./browser-extension/build.sh
./tools/install_native_host.sh
```

`install_native_host.sh` copies `browser-extension/native/sherlock_native.sh` into `~/Library/Application Support/SherLock/NativeMessaging` on macOS and drops the host manifest into the Chrome and Firefox registry directories. Chromium forks (Edge, Brave) have their own directories and are not registered by default.

## Load the extension

### Chrome

1. Open `chrome://extensions/` and turn on **Developer mode**.
2. Click **Load unpacked** and pick `browser-extension/build/chrome`.
3. When Chrome asks for native messaging access, allow it.

### Firefox

1. Open `about:debugging`, then **This Firefox**.
2. Click **Load Temporary Add-on** and pick `browser-extension/build/firefox/manifest.json`.

Temporary add-ons disappear when Firefox restarts, and `build.sh` deletes the folder on every build. Reload the add-on in `about:debugging` after rebuilding.

## Pair the browser

1. In the app, open **Configuració → Browsers vinculats** and press **Generar codi per vincular un navegador**.
2. Open the extension popup and type the six-digit code.

The code expires after two minutes and works once. Pairing stores an ECDSA P-256 key pair in the browser's extension storage; the public half goes to the app, the private half never leaves the browser. Every later request signs a fresh challenge, so no long-lived password or token lives in the extension.

## What the extension can do

| Action | What it does |
| --- | --- |
| `getVaultInfo` | Reports whether the app is reachable, locked or unlocked, and how many entries exist. |
| `pairBrowser` | Exchanges the six-digit code for a client id and registers the public key. |
| `getBrowserChallenge` / `authenticatePairedBrowser` | Signs a nonce to prove the browser is the paired one. |
| `fetchCredentials` | Returns the credentials that match a site, after checking the page origin. |
| `listCredentials` | Lists entries for the popup, without passwords. |
| `saveCredentials` | Offers to save a login after a form submit. |
| `generatePassword` | Asks the app for a generated password. |
| `lockVault` | Locks the vault from the popup. |
| `getActiveTab` | Returns the hostname of the current tab. |

## How a request travels

```
page form → content script → background service worker
          → native host (stdio, length-prefixed JSON)
          → http://127.0.0.1:<port>/api/v1 (Bearer token)
          → Tauri app
```

The app writes its current port to `~/.password_manager/extension_port`; both the host and the Firefox manifest default to 8080 if that file is missing.

Content scripts only receive a password after the user picks one of the matches, or when a single match makes the choice unambiguous. They also only get it for the frame whose URL the browser reports as the sender; the background worker drops any request whose `domain` does not match the sender's hostname.

## Troubleshooting

**"Disconnected" in the popup.** The app is probably not running, or the host is not registered. Run `./tools/install_native_host.sh` again, then restart the browser.

**"Aquest navegador no està vinculat".** Pair it from the settings screen. If it was paired before and the app was reset, pair it again.

**Host not found.** Check that `sherlock_native.sh` is executable and that the manifest in the browser's native messaging directory points at the installed copy, not at the build folder.

**"Permission denied" on macOS.** Open System Settings → Privacy & Security and allow the script to run.

**Firefox keeps loading old code.** Reload the temporary add-on in `about:debugging` after each build.

## Files

- `manifest.chrome.json`, `manifest.firefox.json`: source manifests.
- `background.js`: service worker, pairing and message routing.
- `content.js`, `content.css`: autofill and save prompts.
- `popup.html`, `popup.js`: extension popup.
- `native/sherlock_native.py`: native messaging host.
- `native/sherlock_native.sh`: wrapper registered with the browser.
- `build.sh`: produces `build/chrome` and `build/firefox`.
- `SECURITY.md`, `NATIVE_MESSAGING.md`: deeper notes on the trust boundary and host setup.

## License

MIT. See the main repository.
