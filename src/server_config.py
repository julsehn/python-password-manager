"""Server configuration for secure HTTPS API with mTLS, JWT, and HMAC."""

import os
import secrets
import subprocess
from pathlib import Path

# Server settings
HOST = "127.0.0.1"  # Only localhost for security
PORT = 8443  # Use 8443 for legacy HTTPS API to avoid collision with extension server on 8080

# Security settings
JWT_SECRET = Path.home() / ".password_manager" / "jwt_secret.bin"
JWT_EXPIRY_SECONDS = 300  # 5 minutes - short-lived tokens
HMAC_SECRET = Path.home() / ".password_manager" / "hmac_secret.bin"

# Certificate paths for mTLS
CERT_DIR = Path.home() / ".password_manager" / "certs"

CLIENT_CERT_PATH = CERT_DIR / "client.crt"
CLIENT_KEY_PATH = CERT_DIR / "client.key"
SERVER_CERT_PATH = CERT_DIR / "server.crt"
SERVER_KEY_PATH = CERT_DIR / "server.key"

# Vault file path
VAULT_PATH = Path.home() / ".password_manager" / "vault.json"

# API endpoints
API_BASE = "/api/v1"
VAULT_ENDPOINT = f"{API_BASE}/vault"
AUTH_ENDPOINT = f"{API_BASE}/auth"

# Rate limiting (optional security measure)
MAX_REQUESTS_PER_MINUTE = 100


def ensure_secrets_exist() -> None:
    """Generate secrets if they don't exist."""
    JWT_SECRET.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    HMAC_SECRET.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not JWT_SECRET.exists():
        _write_private_secret(JWT_SECRET, os.urandom(32))

    if not HMAC_SECRET.exists():
        _write_private_secret(HMAC_SECRET, secrets.token_bytes(32))


def _write_private_secret(path: Path, value: bytes) -> None:
    """Create a secret file atomically with owner-only permissions."""
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return

    with os.fdopen(descriptor, "wb") as secret_file:
        secret_file.write(value)
        secret_file.flush()
        os.fsync(secret_file.fileno())


def ensure_certificates_exist() -> None:
    """Generate self-signed certificates for mTLS if they don't exist."""
    CERT_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "posix":
        os.chmod(CERT_DIR, 0o700)
    if not SERVER_CERT_PATH.exists() or not SERVER_KEY_PATH.exists():
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:4096",
                "-keyout",
                str(SERVER_KEY_PATH),
                "-out",
                str(SERVER_CERT_PATH),
                "-days",
                "365",
                "-nodes",
                "-subj",
                "/CN=localhost/O=Caixa Forta/C=US",
            ],
            check=True,
        )

    if not CLIENT_CERT_PATH.exists() or not CLIENT_KEY_PATH.exists():
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:4096",
                "-keyout",
                str(CLIENT_KEY_PATH),
                "-out",
                str(CLIENT_CERT_PATH),
                "-days",
                "365",
                "-nodes",
                "-subj",
                "/CN=extension/CN=Browser Extension/O=Caixa Forta",
            ],
            check=True,
        )


if __name__ == "__main__":
    ensure_secrets_exist()
    ensure_certificates_exist()
