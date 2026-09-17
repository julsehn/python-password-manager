# Caixa Forta - Password Manager Project Documentation

## Project Overview

**Caixa Forta** is a cross-platform password manager application written in Python with PyQt6 GUI, supporting cloud sync via Railway API. The project is in Catalan language.

**Key Features:**
- 🔐 End-to-end encryption (AES-256-GCM)
- ☁️ Cloud sync with Railway API
- 🔒 Brute-force protection (10 attempts → 5 min lockout)
- 🎨 Modern GUI with PyQt6
- 📱 Autofill for websites
- 🔋 Auto-lock on inactivity
- 🖼️ Image-based biometric authentication (optional)

## Architecture

### Core Components

```
python-password-manager/
├── main.py                 # Application entry point
├── src/
│   ├── config.py           # Configuration management
│   ├── models.py           # PasswordEntry dataclass
│   ├── storage.py          # Vault persistence, encryption, brute-force protection
│   ├── encryption.py       # Key derivation (PBKDF2), AES-256-GCM
│   ├── password_manager.py # In-memory password manager
│   ├── remote_vault.py     # Cloud sync orchestration
│   ├── railway_client.py   # Railway API client
│   ├── server.py           # Secure HTTPS API server (mTLS, JWT, HMAC)
│   ├── auth.py             # JWT token management, HMAC signing
│   ├── server_integration.py # Server lifecycle management
│   ├── generate_certs.py   # Certificate generation
│   └── ui/
│       ├── main_window.py  # Main GUI window
│       ├── dialogs.py      # Login, add/edit, password generator dialogs
│       └── tutorial_dialog.py # First-time user guide
├── browser-extension/      # Chrome/Firefox autofill extension
├── railway-vault/          # Cloud sync backend (FastAPI)
├── tests/                  # Test suite
├── requirements.txt        # Python dependencies
└── README.md               # Main documentation
```

## Core Functionality

### 1. Vault Management

**Encryption:**
- AES-256-GCM for data encryption
- PBKDF2-HMAC-SHA256 key derivation (600k iterations per OWASP 2023)
- 16-byte random salt per vault
- 12-byte nonce for each encryption

**Vault File:**
- Location: `~/.password_manager/vault.json`
- Permissions: 0600 (owner-only on POSIX)
- Format: JSON envelope with salt, nonce, ciphertext, version

**Security Features:**
- Brute-force protection: 10 failed attempts → 5 minute lockout
- Memory clearing: Passwords zeroed on deletion
- Secure file I/O: Atomic writes with temporary files

### 2. User Authentication

**Master Password:**
- Minimum 16 characters required
- Derives encryption key via PBKDF2
- Never stored (only used for key derivation)

**Image-Based Biometric Auth (Optional):**
- User draws pattern on canvas
- Hotspots stored as percentage coordinates
- Key derived from pattern + salt
- Tolerance-based matching (±15%)

**Cloud Authentication:**
- Separate from vault encryption
- Username/password for Railway API
- JWT tokens for API access

### 3. Password Management

**Password Entry:**
- Site URL (with XSS sanitization)
- Username
- Password (min 8 chars for stored, min 16 for master)
- Notes (optional, max 1000 chars)
- Created/updated timestamps

**Operations:**
- Add new entry
- Edit existing entry
- Delete entry (soft delete with trash)
- Clone entry
- Search entries

**Password Generator:**
- Cryptographically secure (secrets module)
- Configurable length (default 16)
- Options: uppercase, numbers, symbols
- Guarantees at least one char from each required set
- History tracking

### 4. Cloud Sync (Railway)

**Railway Backend:**
- FastAPI server
- Endpoints:
  - `POST /v1/vaults` - Create vault
  - `GET /v1/vaults/{id}` - Download vault
  - `PUT /v1/vaults/{id}` - Upload vault (optimistic locking)
  - `DELETE /v1/vaults/{id}` - Delete vault
  - `POST /v1/auth` - User authentication
  - `GET /health` - Health check

**Sync Features:**
- Optimistic locking (version tracking)
- Conflict resolution (version > 10000 → delete/recreate)
- Encrypted vault sync (client-side encryption)
- User authentication layer

**Official Cloud:**
- URL: `password-manager-cloud-production.up.railway.app`
- Automatic vault creation
- Token generation

**Custom Cloud:**
- User provides Railway URL, vault_id, token
- Same API endpoints

### 5. Browser Extension

**Features:**
- Chrome & Firefox compatible
- Local autofill for websites
- Cross-browser credential storage
- **Secure API integration** (mTLS, JWT, HMAC)

**Secure API Implementation:**
- Transport: TLS 1.3 with mTLS
- Authentication: JWT tokens (5 min expiry)
- Request signing: HMAC-SHA256
- Timestamp validation: 30s window
- Server: https://127.0.0.1:8080

**End-to-End Flow:**
1. Desktop app starts secure server
2. Extension loads client certificate
3. User authenticates with username/password
4. Extension receives JWT token
5. Extension makes API calls with HMAC signatures
6. Server validates all security layers

### 6. User Interface

**Main Window:**
- Sidebar: Folder categories (Favorites, Social, etc.)
- Search bar: Filter entries by site/username
- Card list: Password entries with icons
- Bottom navigation: Vault, Settings

**Features:**
- Copy to clipboard (auto-clear 30s)
- Open site in browser
- Auto-fill functionality
- Entry details view/edit
- Password generator dialog
- Cloud sync status

**Settings:**
- Clipboard clear timeout (1-3600s)
- Auto-lock timeout (1-3600s)
- Cloud provider selection (Official/Custom)
- Railway configuration (URL, vault_id, token)
- Delete all data (with double confirmation)

**Security Features:**
- Auto-lock on inactivity
- Login dialog on startup
- Cloud authentication dialog
- First-time user guide

### 7. Security Features

**Encryption:**
- AES-256-GCM for vault data
- PBKDF2-HMAC-SHA256 key derivation (600k iterations)
- Random salt per vault
- Nonce for each encryption

**Brute-Force Protection:**
- Track failed attempts per vault
- 10 attempts → 5 minute lockout
- Lockout state persisted to file
- Clear lockout on successful login

**Memory Safety:**
- Passwords cleared from memory on deletion
- No plaintext passwords in logs
- Secure file I/O (atomic writes)

**File Security:**
- Vault file: 0600 permissions (owner-only)
- Config files: 0600 permissions
- Config directory: 0700 permissions
- Secure parent directory creation

**Network Security:**
- Server binds to localhost only
- TLS 1.3 for API communication
- mTLS for browser extension
- JWT with short expiry
- HMAC request signing

**Input Sanitization:**
- XSS prevention (block javascript:, vbscript:)
- URL validation (default to https)
- Text length limits
- Empty value validation

## Installation & Setup

### Requirements
- Python 3.10+
- PyQt6
- cryptography
- pytest (for testing)

### Quick Start

```bash
# Clone repository
git clone https://github.com/julsehn/Password-Manager-Cloud.git
cd password-manager-cloud/python-password-manager

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# or
.venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Run application
python main.py
```

### Cloud Setup

**Option A: Official Cloud (Recommended)**
1. App automatically uses `password-manager-cloud-production.up.railway.app`
2. Create vault on first run
3. Use cloud sync via "Remot" menu

**Option B: Custom Cloud**
1. Deploy FastAPI backend to Railway
2. Configure in Settings:
   - Railway URL
   - Vault ID
   - Access Token
3. Create vault manually

### Browser Extension Setup

```bash
# Generate client certificate
python -c "
import sys
sys.path.insert(0, '.')
from pathlib import Path
from src.server_config import CERT_DIR, CLIENT_CERT_PATH, CLIENT_KEY_PATH
import subprocess

CERT_DIR.mkdir(parents=True, exist_ok=True)
subprocess.run([
    'openssl', 'req', '-x509', '-newkey', 'rsa:4096',
    '-keyout', str(CLIENT_KEY_PATH),
    '-out', str(CLIENT_CERT_PATH),
    '-days', '365',
    '-nodes',
    '-subj', '/CN=extension/CN=Browser Extension/O=Caixa Forta'
], check=True)
"

# Load in Chrome
# 1. chrome://extensions
# 2. Enable Developer mode
# 3. Load unpacked: browser-extension
```

## API Reference

### Storage API

```python
from src.storage import (
    save_vault, load_vault,
    serialize_vault, deserialize_vault,
    export_vault, save_config, load_config
)

# Save encrypted vault
save_vault(entries, master_password)

# Load encrypted vault
entries = load_vault(master_password)

# Serialize vault to JSON string
blob = serialize_vault(entries, master_password)

# Deserialize vault from JSON string
entries = deserialize_vault(blob, master_password)
```

### Encryption API

```python
from src.encryption import derive_key, encrypt, decrypt

# Derive key from password
key, salt = derive_key(password)

# Encrypt plaintext
nonce, ciphertext = encrypt(plaintext, key)

# Decrypt ciphertext
plaintext = decrypt(nonce, ciphertext, key)
```

### Password Manager API

```python
from src.password_manager import PasswordManager

manager = PasswordManager()

# Add entry
entry = manager.add_entry("example.com", "user", "pass123", "notes")

# Get entries
entries = manager.get_entries()

# Find entry
entry = manager.find_entry(entry_id)

# Delete entry
manager.delete_entry(entry_id)

# Generate password
password = manager.generate_password(length=16)
```

### Railway Client API

```python
from src.railway_client import RailwayVaultClient

client = RailwayVaultClient(url, vault_id, token)

# Create vault
vault_id, token = client.create_vault(username, password)

# Download vault
response = client.download()
blob = response.blob

# Upload vault
response = client.upload(blob, expected_version)

# Delete vault
client.delete()

# User authentication
user_info = client.login_user(username, password)
```

## Configuration

### Config File Format

```json
{
  "clipboard_clear_seconds": 30,
  "auto_lock_seconds": 300,
  "show_tutorial": true,
  "cloud_provider": "official",
  "railway_url": "https://...",
  "railway_vault_id": "...",
  "railway_token": "...",
  "railway_version": 1
}
```

### Vault File Format

```json
{
  "salt": "base64-encoded-salt",
  "nonce": "base64-encoded-nonce",
  "ciphertext": "base64-encoded-ciphertext",
  "version": "1"
}
```

## Testing

```bash
# Run all tests
pytest tests/

# Run specific test
pytest tests/test_storage.py

# Run with coverage
pytest --cov=src tests/
```

## Security Checklist

- [x] AES-256-GCM encryption
- [x] PBKDF2 key derivation (600k iterations)
- [x] Brute-force protection (10 attempts)
- [x] Secure file permissions (0600)
- [x] Memory clearing on deletion
- [x] XSS sanitization
- [x] Input validation
- [x] TLS 1.3 for API
- [x] mTLS for extension
- [x] JWT authentication
- [x] HMAC request signing
- [x] Auto-lock on inactivity
- [x] Clipboard auto-clear
- [x] Secure random generation (secrets module)

## Troubleshooting

### "Vault is locked"
- Wait 5 minutes or restart app
- Clear lockout state: `rm ~/.password_manager/lockout_state.json`

### "No s'ha pogut carregar la caixa forta"
- Verify master password
- Check vault file exists: `ls ~/.password_manager/vault.json`
- Try re-creating vault

### Cloud sync fails
- Verify Railway URL is accessible
- Check vault_id and token are correct
- Try deleting and recreating vault

### Extension can't connect
- Verify app is running
- Check browser extension is loaded
- Verify certificate exists: `ls ~/.password_manager/certs/client.crt`

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Run tests
5. Submit pull request

## License

MIT License - Free to use, study, modify, and redistribute.

## Links

- GitHub: https://github.com/julsehn/Password-Manager-Cloud
- Documentation: https://docs.password-manager.cloud
- Railway Backend: https://password-manager-cloud-production.up.railway.app
