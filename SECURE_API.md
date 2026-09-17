# Secure API Architecture Documentation

## Overview

The Caixa Forta password manager now includes a **secure HTTPS API server** with multiple layers of security for browser extension integration.

## Security Architecture (Defense in Depth)

### Layer 1: Transport Security (mTLS)
- **TLS 1.3** with strong cipher suites
- **Mutual TLS (mTLS)**: Both client and server authenticate with certificates
- Server certificate: Self-signed for localhost
- Client certificate: Generated per extension installation
- Certificates stored in `~/.password_manager/certs/`

### Layer 2: Authentication (JWT)
- **JWT tokens** with 5-minute expiry (short-lived)
- Tokens issued only after successful vault unlock
- Tokens automatically revoked when vault locks
- JWT secrets stored securely (PBKDF2-derived)

### Layer 3: Request Integrity (HMAC)
- **HMAC-SHA256** signature on every request
- Nonce included in JWT to prevent replay
- Timestamp validation (reject requests > 30s old)
- Prevents man-in-the-middle attacks

### Layer 4: Data Security (Already Existing)
- Vault file encrypted with **AES-256-GCM**
- Key derived from master password (**PBKDF2-HMAC-SHA256**, 600k iterations)
- File permissions: **0600** (owner-only on POSIX)
- Memory clearing on password deletion

### Layer 5: Network Isolation
- Server binds only to **127.0.0.1:8080** (localhost only)
- No external network access possible
- Firewall rules can block external IPs
- Port only open when app is running

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  1. Client Certificate (mTLS)                        │  │
│  │  2. JWT Token (5 min expiry)                         │  │
│  │  3. HMAC-SHA256 Signature                            │  │
│  │  4. Timestamp + Nonce                                │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                     │
│                        ▼ (HTTPS + mTLS)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Desktop App - Secure HTTPS Server                    │  │
│  │  - TLS 1.3 with client cert verification              │  │
│  │  - JWT token validation                               │  │
│  │  - HMAC signature verification                        │  │
│  │  - Timestamp freshness check                          │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│              ~/.password_manager/vault.json                  │
│              (AES-256-GCM encrypted, 0600 permissions)       │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Server (`src/server.py`)
- **`SecureAPIHandler`**: HTTP request handler with authentication
- **`SecureVaultServer`**: Server lifecycle management
- Endpoints:
  - `GET /api/v1/vault` - Download vault
  - `POST /api/v1/vault` - Upload vault
  - `DELETE /api/v1/vault` - Delete vault
  - `POST /api/v1/auth` - Authenticate user
  - `GET /health` - Health check

### Auth Module (`src/auth.py`)
- **`generate_jwt_token()`**: Create JWT with user info and nonce
- **`verify_jwt_token()`**: Verify and decode JWT
- **`sign_request()`**: Create HMAC signature
- **`verify_request_signature()`**: Verify HMAC signature

### Server Integration (`src/server_integration.py`)
- **`SecureServerManager`**: Singleton for server lifecycle
- **`start_server()`**: Start secure server
- **`stop_server()`**: Stop secure server
- **`is_server_running()`**: Check server status

### Browser Extension (`browser-extension/`)
- **`manifest.json`**: M3 manifest with host permissions
- **`background.js`**: Service worker with secure API client
- **`certs/`**: Client certificates for mTLS

### Configuration (`src/server_config.py`)
- Server settings (HOST, PORT)
- Certificate paths
- JWT/HMAC secret paths
- Auto-generates secrets on first run

## Usage

### Starting the App
```bash
python main.py
```

The app will:
1. Generate JWT/HMAC secrets if they don't exist
2. Generate SSL certificates if they don't exist
3. Start secure server on https://127.0.0.1:8080
4. Wait for server to be ready
5. Launch GUI

### Browser Extension Installation

1. **Generate client certificates:**
```bash
python -m src.generate_certs
```

2. **Load extension in Chrome:**
- Open `chrome://extensions`
- Enable Developer mode
- Click "Load unpacked"
- Select `browser-extension`

3. **Use the extension:**
- Enter username/password
- Extension authenticates via mTLS
- Receives JWT token
- Can now make API calls

### API Usage (from extension)

```javascript
import { authenticate, getVault, saveVault } from './background.js';

// 1. Authenticate
const user = await authenticate('username', 'password');

// 2. Get vault
const vault = await getVault();

// 3. Save vault
await saveVault(entries);
```

## Security Best Practices

1. **Never share certificates**: Client certs are tied to extension installation
2. **Short token expiry**: 5 minutes limits window for token theft
3. **Request signing**: Every request must be signed
4. **Timestamp validation**: Prevents replay attacks
5. **Localhost only**: Server never binds to external interfaces
6. **Vault encryption**: Data encrypted even in memory (AES-256-GCM)
7. **Secure file permissions**: 0600 on POSIX systems
8. **Memory clearing**: Passwords cleared from memory on deletion

## Testing

### Test the server:
```bash
# Start app
python main.py

# In another terminal, test endpoint
curl -v https://127.0.0.1:8080/health
```

### Test mTLS:
```bash
# Get client cert path
CLIENT_CERT="chrome-extension://caixa-forta-extension/certs/client.crt"

# Test with client cert
curl -v \
  --cert "$CLIENT_CERT" \
  --key "$HOME/.password_manager/certs/client.key" \
  https://127.0.0.1:8080/health
```

## Troubleshooting

### Server won't start:
- Check if port 8080 is available: `lsof -i :8080`
- Check logs: Look for "Failed to start server" messages
- Verify OpenSSL is installed: `which openssl`

### Extension can't connect:
- Verify extension is loaded in browser
- Check host permissions in manifest.json
- Ensure app is running when using extension

### Authentication fails:
- Check JWT token expiration
- Verify client certificate is valid
- Check HMAC signature is correct

## Future Enhancements

1. **Certificate pinning**: Pin extension cert to server
2. **Rate limiting**: Prevent brute-force attacks
3. **Audit logging**: Log all API requests
4. **Session management**: Better token revocation
5. **Mobile support**: Same architecture for mobile apps
6. **Key rotation**: Periodically rotate JWT/HMAC secrets
