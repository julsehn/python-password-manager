# Caixa Forta - Tauri Migration Status

## Overview

The Caixa Forta password manager has been migrated to Tauri (Rust frontend). The Python PyQt6 GUI has been replaced with a native Tauri application while maintaining the Railway backend for syncing encrypted vaults across devices.

## Completed Implementation

### ✅ Tauri Frontend (`src-web/main.js`)
The existing Tauri frontend is fully implemented with:
- **Lock screen** with master password authentication
- **Vault CRUD operations** - Create, read, update, delete password entries
- **Password generator** - Passwords, passphrases, and usernames
- **Folders** - Custom icons and colors for organization
- **Trash bin** - Soft delete with restore functionality
- **Import/Export** - JSON and CSV support
- **Settings** - Theme, auto-lock, font size, accent color
- **Auto-lock** - Inactivity-based vault locking
- **Clipboard security** - Auto-clear after 30 seconds
- **Entry details** - View and edit interface

### ✅ Tauri Rust Backend (`src-tauri/src/lib.rs`)
Implemented IPC commands:
- `unlock_vault` - Decrypt vault with master password (AES-256-GCM)
- `save_vault` - Encrypt and save vault
- `lock_vault` - Clear sensitive data from memory
- `get_vault_info` - Get vault metadata
- `generate_password` - Secure random password generation
- `generate_passphrase` - Diceware-style passphrase generation
- `generate_username` - Unique username generation
- `create_entry`, `update_entry`, `trash_entry`, `restore_entry`, `delete_entry_permanently`
- `create_folder`, `update_folder`, `delete_folder`
- `sync_upload_vault`, `sync_download_vault` - Railway sync (placeholder)
- `change_master_password` - Re-encrypt vault (placeholder)
- `export_vault`, `import_vault`

### ✅ Security Module (`src-tauri/src/security/mod.rs`)
- **AES-256-GCM encryption** for vault data
- **Argon2id key derivation** (primary) and PBKDF2-SHA256 (fallback)
- **Secure random password** generation
- **Diceware passphrase** generation with language support
- **Password strength validation**
- **Salt and nonce** generation

### ✅ Data Model (`src-tauri/src/vault.rs`)
- Entry model with folder support and trash tracking
- Folder model with custom icons and colors
- History tracking for password generator
- Proper soft-delete with permanent deletion

## Railway Backend (Unchanged)

The Railway vault backend remains unchanged and serves as the sync server:

- **`railway-vault/app.py`** - FastAPI server with endpoints:
  - `POST /v1/vaults` - Register new vault
  - `GET /v1/vaults/{vault_id}` - Download vault
  - `PUT /v1/vaults/{vault_id}` - Upload vault (with optimistic locking)
  - `DELETE /v1/vaults/{vault_id}` - Delete vault
  - `GET /healthz` - Health check

- **`src/railway_client.py`** - Client library for Python
- **`src/remote_vault.py`** - Sync logic with configuration management

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Frontend                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              src-web/main.js (JavaScript)             │  │
│  │  - Lock screen with master password UI                │  │
│  │  - Vault CRUD interface                               │  │
│  │  - Password generator                                 │  │
│  │  - Settings and preferences                           │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                     │
│                        │ IPC Commands                        │
│                        ▼                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              src-tauri/src/lib.rs                     │  │
│  │  - vault.rs: Vault data model                         │  │
│  │  - security.rs: Encryption functions                  │  │
│  │  - railway.rs: Sync logic                             │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                     │
│                        │ File I/O                            │
│                        ▼                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │      ~/.password_manager/vault.json (Encrypted)       │  │
│  └───────────────────────────────────────────────────────┘  │
│                        │                                     │
│                        │ Railway Sync                        │
│                        ▼                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Railway Backend (FastAPI)                │  │
│  │              railway-vault/app.py                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Building

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js (if not already installed)
# macOS: brew install node

# Install Tauri CLI
npm install -g @tauri-apps/cli

# Run development server
npm run tauri dev

# Build production release
npm run tauri build

# Create macOS application
# The build will create: dist/Caixa Forta/
```

## Testing

```bash
# Build and run tests
cd src-tauri
cargo test

# Build in release mode
cargo build --release
```

## Next Steps

### 1. Complete Railway Sync Integration
The `sync_upload_vault` and `sync_download_vault` commands currently return placeholder responses. Need to:
- Implement HTTP client using `tauri-plugin-http`
- Connect to Railway FastAPI backend
- Handle authentication and error cases
- Implement optimistic locking (version checking)

### 2. Configure Build
Update `tauri.conf.json`:
- Add application icon
- Configure entitlements for macOS
- Add `Obrir_Caixa_Forta.command` for easy launch

### 3. Security Hardening
- Add master password change functionality
- Implement secure storage for vault configuration
- Add automatic backup of vault file

### 4. Deploy Railway Backend
1. Create Railway project
2. Deploy `railway-vault/app.py`
3. Configure environment variables:
   - `VAULT_DB_PATH=/data/vaults.db`
   - `MAX_BLOB_BYTES=10485760` (10MB)

## Existing Features (Python GUI - Not Migrated)

The following features from the Python GUI are NOT yet implemented:
- Image-based biometric authentication
- Side panel customization (folder names/colors)
- Some specific styling details

These are either low-priority or can be ported later as needed.

## Files Changed

- `src-tauri/src/lib.rs` - Complete rewrite with all IPC commands
- `src-tauri/src/vault.rs` - New vault data model
- `src-tauri/src/railway.rs` - New Railway sync module
- `src-tauri/src/security/mod.rs` - Extended with encryption functions
- `src-tauri/Cargo.toml` - Added dependencies
- `FIXES_APPLIED.md` - Migration documentation

## Verification

To verify the build works:

```bash
# Build Tauri
npm run tauri build

# The application binary will be at:
# dist/Caixa Forta/

# Launch the application
# - On macOS: open the app from dist directory
# - On Linux: ./dist/Caixa%20Forta/Caixa Forta-x86_64-appimage.AppImage

# Test vault creation and unlock
# 1. Create new vault with master password
# 2. Verify vault file exists at ~/.password_manager/vault.json
# 3. Add a test entry
# 4. Save and close
# 5. Re-open and verify entry is available
```
