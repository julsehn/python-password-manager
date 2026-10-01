# AGENTS.md

## Purpose
This repository is the source for Caixa Forta, a local-first password manager with:
- a Python desktop client built with PyQt6
- secure local vault storage and encryption
- an HTTPS API server with JWT/HMAC and mTLS concepts
- browser autofill support for Chrome/Firefox via a native messaging host
- optional cloud sync through Railway
- a Tauri-based desktop/web shell in `src-tauri/`

Future AI agents should treat this project as a security-sensitive app. Keep changes minimal, explicit, and privacy-aware.

## High-level architecture

### 1. Desktop app entry
- `main.py`: application bootstrap and server startup hook
- `src/ui/main_window.py`: main user interface
- `src/ui/qt_compat.py`: PyQt6 compatibility wrapper

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
  - `browser-extension/manifest.json`
  - `browser-extension/background.js`
  - `browser-extension/content.js`
  - `browser-extension/popup.js`
  - `browser-extension/native/caixa_forta_native.py`

### 6. Tauri app shell
- `src-tauri/`: Rust/Tauri app and interface layer
- `src-tauri/src/`: app logic and backend bindings

## Setup and run
Typical setup:

```bash
cd /Users/juls/Documents/GitHub/The-vault-project/python-password-manager
source .venv-1/bin/activate
python main.py
```

For the web/Tauri app:

```bash
npm install
npm run tauri
```

## Project conventions
- Do not commit secrets, master passwords, vault contents, or API tokens.
- Prefer reading existing implementation patterns before adding new logic.
- Keep security-sensitive operations centralized in `src/encryption.py`, `src/storage.py`, and `src/server.py`.
- Treat browser-extension/native-host integration as a trust boundary.
- When changing config behavior, keep compatibility with `~/.password_manager/config.json` in mind.
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
2. Inspect `main.py` and the layer you are changing.
3. Follow the existing module boundaries instead of introducing a new cross-cutting architecture.
4. Validate with the smallest relevant runtime or test command.
5. Keep any new documentation in the same spirit: concise, security-aware, and actionable.

## Key files to know
- `README.md`: user-facing overview
- `main.py`: startup entry
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
- Preserve backward compatibility unless the change explicitly targets a migration.

This file is the main context anchor for AI-assisted work in this repository.
