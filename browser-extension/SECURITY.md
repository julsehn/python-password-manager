# Browser extension security

## Where the trust sits

- The extension only talks to `browser-extension/native/sherlock_native.py` through browser native messaging. The browser enforces which extension may start that host via the manifest (`allowed_origins` for Chrome, `allowed_extensions` for Firefox). The host's own check on the launcher argument is a second line, not the main one.
- The host calls the desktop app's loopback service at `http://127.0.0.1:<port>/api/v1`, where the port is published in `~/.password_manager/extension_port`.
- Pairing is separate from installation. A browser that has not been paired gets nothing: the app issues a six-digit code that expires in two minutes, the extension registers an ECDSA P-256 public key, and each request is authorised by signing a fresh nonce.
- The desktop UI uses Tauri IPC. The extension never does.

## What is stored where

- The vault stays encrypted on disk and is only decrypted inside the desktop app.
- The extension keeps its own private key and client id in `browser.storage.local`. It does not keep credentials, and it does not cache the vault.
- The cloud service receives encrypted blobs and account metadata. It never receives the master password or the derived key.
- Content scripts build save prompts from text nodes. Passwords are not written into popup DOM attributes.

## Worth knowing

- The loopback service only accepts connections from loopback addresses and validates the paired-client signature or the session token on protected routes.
- If port 8080 is taken, the app binds another loopback port and publishes it for the host. Browser extension manifests that hardcode 8080 are only used as a fallback.
- Installing the host is not the same as authorising a browser. If a machine is shared, revoke the pairing in **Configuració → Browsers vinculats**.
- This document is a summary, not a substitute for reading the host and the Rust server code.
