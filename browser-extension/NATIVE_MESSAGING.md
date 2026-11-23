# Native messaging setup

The extension does not read the vault. It sends requests to `browser-extension/native/sherlock_native.py`, a small Python process that the browser starts over stdio, and that process calls the app's loopback API. Nothing leaves the machine.

## Install

`Obrir_SherLock.command` runs the installer on every launch, so a normal macOS start is enough. To do it by hand:

```bash
chmod +x browser-extension/native/sherlock_native.py
./tools/install_native_host.sh
```

The script copies the host and its wrapper to `~/Library/Application Support/SherLock/NativeMessaging/` and writes the two registration files:

| Browser | Manifest |
| --- | --- |
| Firefox | `~/Library/Application Support/Mozilla/NativeMessagingHosts/sherlock.json` |
| Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/sherlock.json` |

Firefox reads the `Mozilla` directory on macOS, not the one inside `Firefox/`. If you place the manifest in the wrong folder the browser silently ignores it.

On Linux the equivalent script is `tools/register_native_host_linux.sh`, which writes to `~/.mozilla/native-messaging-hosts/sherlock.json` and `~/.config/google-chrome/NativeMessagingHosts/sherlock.json`. Snap and Flatpak builds of Firefox use their own sandboxed directories and often cannot start a host from the home directory at all; if the popup stays disconnected there, install the browser from a normal package instead of fighting the sandbox.

Chromium forks (Edge, Brave, Chromium) keep their own native messaging directories. Copy the Chrome manifest there and change `allowed_origins` if you need them.

## Build and load the extension

Run `./browser-extension/build.sh` first: it copies the host into `build/chrome` and `build/firefox` together with the rest of the extension.

Chrome: `chrome://extensions/` → Developer mode → Load unpacked → `browser-extension/build/chrome`.

Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `browser-extension/build/firefox/manifest.json`. Temporary add-ons vanish when Firefox restarts, so reload after each build.

## Pair once

Pairing is what actually authorises a browser; installing the host only lets the browser start it.

1. In the app: **Configuració → Browsers vinculats → Generar codi per vincular un navegador**.
2. In the extension popup, enter the six-digit code.

The code lasts two minutes and is single-use. The extension generates an ECDSA P-256 key pair, keeps the private key in `browser.storage.local`, and sends only the public key. On each vault request it signs a nonce from the app, so the browser proves it is the same client without storing a reusable secret.

## Protocol

Native messaging uses stdin/stdout with a 4-byte little-endian length prefix followed by UTF-8 JSON. Messages are capped at 1 MB. The host checks the launcher argument that Chrome passes (`chrome-extension://…`), but the real trust boundary is the browser's own manifest check (`allowed_origins` or `allowed_extensions`); the host treats any id sent inside the message body as untrusted.

A request looks like this:

```json
{ "action": "fetchCredentials", "domain": "example.com" }
```

The host forwards it to `http://127.0.0.1:<port>/api/v1/…` using the port published in `~/.password_manager/extension_port` and the Bearer token obtained during pairing. If the app is not running there is no fallback to the vault file; the request fails.

## Troubleshooting

**Disconnected popup.** Start the app, then reopen the popup. If it stays disconnected, re-run the installer and restart the browser.

**Host not found.** Check that `sherlock.json` exists in the right directory and that its `path` points to the installed copy under `Application Support/SherLock`, not to the build folder.

**"Permission denied".** Make both `sherlock_native.sh` and `sherlock_native.py` executable, and allow the script in macOS System Settings → Privacy & Security.

**Pairing code rejected.** Codes expire quickly and only work once. Generate a new one instead of reusing an old screenshot.

**Chrome extension ID changed.** `install_native_host.sh` uses the id derived from the `key` in `manifest.chrome.json`. If you rebuild with a different key, pass the new id as the first argument or the manifest will not match.

## Files

- `native/sherlock_native.py`: the host itself.
- `native/sherlock_native.sh`: wrapper registered with the browser.
- `tools/install_native_host.sh`: copies the host and writes both manifests.
- `Obrir_SherLock.command`: launcher that runs the installer.
