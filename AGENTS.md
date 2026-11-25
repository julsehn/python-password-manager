# AGENTS.md

## Purpose

This repository is the source for SherLock, a local-first password manager with:

- a legacy Python desktop client (GUI removed; `src/` is legacy code kept only for `tests/`)
- secure local vault storage and encryption
- an HTTPS API server with JWT/HMAC and mTLS concepts
- browser autofill support for Chrome/Firefox via a native messaging host
- optional cloud sync through Railway
- a Tauri-based desktop/web shell in `src-tauri/`

Future AI agents should treat this project as a security-sensitive app. Keep changes minimal, explicit, and privacy-aware.

## High-level architecture

### 1. Desktop app entry

The active desktop app is the Tauri shell (`src-tauri/`) with the Vite frontend (`src-web/`).
The Python GUI (`main.py`, `src/ui/`) was removed in commit `f7c6d8b` (2026-11-16).
The remaining `src/*.py` modules are legacy Python code kept only to support `tests/`; they are not part of the running desktop app.

### 2. Security and vault logic

- `src/encryption.py`: cryptographic key derivation and encryption/decryption logic
- `src/storage.py`: vault persistence and backup handling
- `src/auth.py`: JWT and request-signing/authentication helpers
- `src/models.py`: password entry and model definitions
- `src/password_manager.py`: in-memory vault manager logic

### 3. Local secure API and integration

- `src/server.py`: secure HTTPS server with mTLS/JWT/HMAC checks
- `src/server_config.py`: host, port, certificate paths, endpoints
- `src/server_integration.py`: integration layer used by the app to start/stop the server

### 4. Cloud sync and remote vault support

- `src/railway_client.py`: Railway API client
- `src/remote_vault.py`: remote vault sync logic
- `src/config.py`: app config and Railway provider settings

### 5. Browser extension and native messaging

- `browser-extension/`: Chrome/Firefox extension source
- `browser-extension/native/`: native messaging host and extension manager logic
- Important files include:
  - `browser-extension/manifest.chrome.json` and `browser-extension/manifest.firefox.json`
  - `browser-extension/background.js`
  - `browser-extension/content.js`
  - `browser-extension/popup.js`
  - `browser-extension/native/sherlock_native.py`

### 6. Tauri app shell

- `src-tauri/`: Rust/Tauri app and interface layer
- `src-tauri/src/`: app logic and backend bindings

### 7. Active desktop UI and Tauri workflows

- The usual macOS launcher `Obrir_SherLock.command` starts the Tauri app, whose frontend is `src-web/main.js` with styles in `src-web/secure.css` and `src-web/styles.css`. There is no active Python/PyQt GUI launch path (`main.py` and `src/ui/` were removed).
- Tauri commands and encrypted-vault workflows live in `src-tauri/src/lib.rs`; in-memory server session state is managed by `src-tauri/src/server.rs`.
- Validate frontend work with `npm run build`; validate Tauri backend work with `cargo test --release --manifest-path src-tauri/Cargo.toml`.
- Never navigate the main webview away from the SPA: a relative link or `target="_blank"` can reload the app and lock the vault. Open bundled documents (for example the privacy policy) in an in-app modal, or use a controlled external opener.

### Railway session storage

- Store Railway access and refresh tokens only in the encrypted vault's `cloud_session`; never persist them in the OS credential store or frontend local storage.
- The app does not use the macOS Keychain. Keychain entries left by older builds are not read, written, or deleted; no Railway token is ever written to the Keychain again.
- A Railway login that cannot save its session must not be reported as a persistent connection. Unlock the vault first, except when logging in specifically to download and unlock a cloud vault.
- Registration must require a strong Railway password (12+ characters with upper/lowercase, digit and symbol) in the client, the Rust command and the cloud API. It must also refuse a Railway account password that equals the local master password. Compare inside Rust (`ServerState::master_password_matches`) and never send or expose the master password to the frontend.

### Local server and browser pairing

- The paired-browser registry lives in `~/.password_manager/paired_clients.json` with `0600` permissions. It is a trust root: whoever can add a public key there can mint a session token once the vault is unlocked.
- Tests may redirect the registry through `SHERLOCK_PAIRED_CLIENTS_PATH`; production always uses the config directory.

### Master password authentication invariants

- The only accepted authentication method is the master password. The image/pattern authentication flow, its commands, files, and the three-way auth-method picker were removed intentionally; do not reintroduce image login as a convenience option.
- A missing vault means a new user: show the welcome/setup screen, ask for the master password twice, and place "Restaurar des del núvol" below the form. Do not show an auth-method menu.
- Enforce the master-password policy in both layers: at least 12 characters plus an uppercase letter, a lowercase letter, a digit, and a special character. The Rust `validate_master_password` is authoritative; the frontend checklist is only the first check.
- Show the strength meter and the live requirements checklist while the user types. Never store the password in app state, localStorage, logs, or an error message.
- Creating a vault must write it before reporting success. Changing the master password re-encrypts the existing vault and preserves entries, folders, trash, history, and `cloud_session`; never initialize an empty vault over an existing one.
- The legacy Python image/grid helpers were removed as well. Any `grid_auth.json`, `image_auth_secret.json`, or legacy `image_auth.json` left by old development builds is not read and is deleted by a local reset.

### Generator invariants

- Generated passphrases sample words without replacement. Keep the requested word-count limit aligned with the number of unique words available after language and formatting filters.
- The generated credential may be copied or dragged into a compatible text field, and the complete value should use `text/plain` for drag-and-drop.

## Setup and run

Typical setup:

For the web/Tauri app:

```bash
cd /Users/juls/Documents/GitHub/The-vault-project/python-password-manager
npm install
npm run tauri:dev
```

On macOS you can also double-click `Obrir_SherLock.command`.

Normal app runs use the release profile (`npm run tauri:dev`). `[profile.dev]` disables debug info and incremental compilation to keep `src-tauri/target` small; use `cargo test --release` so validation does not recreate the much larger `target/debug` cache.

## Project conventions

- Do not commit secrets, master passwords, vault contents, or API tokens.
- Prefer reading existing implementation patterns before adding new logic.
- Keep security-sensitive operations centralized in `src/encryption.py`, `src/storage.py`, and `src/server.py`.
- Treat browser-extension/native-host integration as a trust boundary.
- `~/.password_manager/config.json` belongs only to the legacy Python modules (`src/config.py`, `src/storage.py`); the Rust app does not use it.
- Favor explicit, readable code over cleverness.

## Important design notes

- The app is designed around a locally locked vault, with encryption derived from the master password.
- The secure server runs locally and exposes endpoints for authenticated access.
- Cloud sync is optional and configured through Railway-backed infrastructure.
- Browser extension interaction relies on native messaging, not direct vault access.
- The repository has many documentation files; use this file as the canonical onboarding summary for future AI work.

## Legacy root-doc consolidation

The older root markdown files are historical notes, fixes, and setup guides. Their valid information has been folded into this file and `MEMORY.md`.

### Native messaging and browser integration

- Firefox and Chrome native messaging setup was a critical integration layer.
- Common issues included protocol mismatch, path mismatch, disconnected extension state, permission issues, and stale host instances.
- Validation should focus on the native host script, manifest registration, and browser console behavior.
- Historical references: `NATIVE_MESSAGING_SETUP.md`, `NATIVE_MESSAGING_DIAGNOSTIC.md`, `NATIVE_MESSAGING_FIX_SUMMARY.md`.

### Secure API and architecture notes

- The secure API design centers on local HTTPS access with JWT and request signing.
- `SECURE_API.md` and `SECURE_ARCHITECTURE.md` document the intended trust boundaries and flow.
- Changes in auth or request validation should be checked against `src/server.py` and `src/auth.py`.

### Windows, launcher, and build notes

- `BUILD_WINDOWS.md` describes Windows build and packaging decisions.
- `LAUNCHERS.md` covers cross-platform launcher scripts and browser integration start-up behavior.
- Keep launcher and packaging changes aligned with the app’s native messaging and Tauri setup.

### Cloud backup and sync

- `BACKUP_FEATURES.md` describes encrypted vault backup and repository sync concepts.
- Cloud sync is optional and should not be treated as the primary trust boundary for local data access.

### Migration and fix history

- `EXTENSION_REWRITE.md`, `EXTENSION_FIX.md`, `EXTENSION_FIX_COMPLETE.md`, and `FIXES_APPLIED.md` capture past bug fixes and migration work.
- These files are useful as context, but this file is the primary source of truth for new work.

## Suggested workflow for new agents

1. Read this file first.
2. Inspect the layer you are changing (`src-tauri/`, `src-web/`, `browser-extension/`, or `src/` for legacy Python tests).
3. Follow the existing module boundaries instead of introducing a new cross-cutting architecture.
4. Validate with the smallest relevant runtime or test command.
5. Keep any new documentation in the same spirit: concise, security-aware, and actionable.

## Key files to know

- `README.md`: user-facing overview
- `src/config.py`: app configuration and cloud provider logic
- `src/server.py`: secure API internals
- `src/storage.py`: vault serialization and persistence
- `src/encryption.py`: encryption primitives
- `browser-extension/README.md`: extension setup and behavior
- `NATIVE_MESSAGING_SETUP.md`: native host setup guide
- `SECURE_API.md`: secure request/auth design
- `SECURE_ARCHITECTURE.md`: architecture overview

## Security expectations

- Passwords must not be logged in plain text.
- Avoid broad file rewrites without understanding the current security model.
- When changing auth flows, verify related certificate, JWT, and HMAC logic.
- This project has not been published: do not maintain or add compatibility with earlier file formats, schemas, or protocols. Once there is a first public release, each format will have an explicit version and migrations.

This file is the main context anchor for AI-assisted work in this repository.
