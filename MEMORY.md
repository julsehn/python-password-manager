# MEMORY.md

## Project story
This repository is a local-first password manager called Caixa Forta. It combines a desktop client, browser autofill support, and optional cloud synchronization. The project has been built around the idea of a secure vault controlled by a master password and backed by Python-based local services.

## Current architecture summary
- Desktop app: PyQt6 application launched from `main.py`
- Local secure API: Python HTTPS server using concepts like mTLS, JWT, and HMAC verification
- Encryption: AES-style key derivation and field-level security around vault entries
- Browser integration: Chrome/Firefox extension plus native host bridge
- Cloud sync: Railway API integration for remote vault persistence
- Desktop shell alternative: Rust/Tauri app under `src-tauri/`

## Design intent
The app is intended to keep sensitive data local and encrypted, while allowing:
- secure vault unlock and management
- optional remote backup/sync
- browser autofill for login forms
- cross-platform desktop usage (Mac, Windows, Linux)

## Core workflow
1. User opens the app and authenticates with the master password.
2. The app loads or creates the encrypted vault.
3. The secure local server becomes available for authenticated requests.
4. Browser extension or UI actions request data through the secure boundary.
5. Cloud sync may be used to upload or fetch remote vault data via Railway.

## Files that matter most
- `main.py`: bootstraps the GUI and secure server lifecycle
- `src/ui/main_window.py`: main app experience
- `src/server.py`: secure server request handling
- `src/config.py`: runtime config, Railway URL, user settings
- `src/storage.py`: vault persistence and serialization
- `src/encryption.py`: encryption/decryption routine
- `src/railway_client.py`: remote API client for cloud sync
- `src/remote_vault.py`: remote vault management logic
- `browser-extension/native/caixa_forta_native.py`: native messaging bridge to the browser
- `src-tauri/src/`: Rust implementation for app shell and backend logic

## Security assumptions
- The master password is the root of vault access.
- Vault data should never be stored in plaintext in normal operations.
- Local secrets, certificates, tokens, and vault content should not be committed to source control.
- Browser/native messaging and cloud sync are trust boundaries that require careful validation.

## Operational context
This project mixes multiple runtime environments:
- Python desktop app
- browser extension code
- native host scripts
- Tauri/Rust shell
- Railway cloud integration

When making changes, prefer small, scoped edits aligned with the existing layer boundaries instead of creating a new abstraction layer in the middle of the stack.

## Documentation map
- `README.md`: product overview and setup
- `PROJECT_DOCUMENTATION.md`: deeper project documentation
- `NATIVE_MESSAGING_SETUP.md`: native host setup flow
- `SECURE_API.md`: secure API design and authentication notes
- `SECURE_ARCHITECTURE.md`: architecture details
- `EXTENSION_REWRITE.md` and related files: browser-extension migration/fixes

## Legacy archive notes
The root-level markdown files are not the canonical source of truth anymore. Most of them are historical notes, build/run instructions, troubleshooting steps, or fix logs from development. Their practical value is preserved in this file and in `AGENTS.md`.

### Most relevant historical docs
- `NATIVE_MESSAGING_SETUP.md` / `NATIVE_MESSAGING_DIAGNOSTIC.md` / `NATIVE_MESSAGING_FIX_SUMMARY.md`: native host registration, protocol debugging, and browser disconnection diagnosis
- `SECURE_API.md` / `SECURE_ARCHITECTURE.md`: secure API and trust model overview
- `BUILD_WINDOWS.md`: Windows packaging/build flow
- `LAUNCHERS.md`: macOS and Windows launcher behavior
- `BACKUP_FEATURES.md`: backup and sync design
- `EXTENSION_REWRITE.md` / `EXTENSION_FIX*.md`: browser extension repair and migration context
- `FIXES_APPLIED.md`: last-known fix history and debugging notes

## Working guidance for future AI agents
- Start from the top-level entry point and the module you are editing.
- Respect the security model before introducing convenience features.
- Avoid broad refactors without checking whether they impact the browser/native path or cloud sync path.
- Keep documentation concise and factual.
- Treat the root markdown files as historical archives; use `AGENTS.md` and `MEMORY.md` as the active project brief.

This memory file exists to preserve the project context for future sessions and AI agents.
