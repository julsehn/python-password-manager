"""JWT token management and HMAC request signing for secure API communication."""

import time
import hmac
import base64
import hashlib
import json
from typing import Optional, Tuple
from pathlib import Path
from collections.abc import Mapping
from argon2.low_level import Type, hash_secret_raw
import os
from typing import TypedDict

from .server_config import (
    JWT_SECRET,
    HMAC_SECRET,
    JWT_EXPIRY_SECONDS,
    VAULT_PATH,
    ensure_secrets_exist,
)


class JWTClaims(TypedDict):
    user_id: str
    vault_unlocked: bool
    iat: int
    exp: int
    nonce: str


def _load_secret(path: Path) -> bytes:
    """Load a secret from file, generating if it doesn't exist."""
    if not path.exists():
        ensure_secrets_exist()

    with open(path, "rb") as f:
        return f.read()


def _derive_key_from_secret(secret: bytes) -> bytes:
    """Derive a 32-byte key from secret using Argon2id."""
    salt = b"jwt_derivation_salt_v1"
    return hash_secret_raw(
        secret=secret,
        salt=salt,
        time_cost=2,
        memory_cost=19 * 1024,
        parallelism=1,
        hash_len=32,
        type=Type.ID,
    )


def generate_jwt_token(user_id: str, vault_unlocked: bool = True) -> str:
    """Generate a JWT token for API access.

    Args:
        user_id: The authenticated user ID
        vault_unlocked: Whether the vault is currently unlocked

    Returns:
        JWT token string
    """
    secret = _load_secret(JWT_SECRET)
    key = _derive_key_from_secret(secret)

    header = (
        base64.urlsafe_b64encode(
            json.dumps({"alg": "HS256", "typ": "JWT"}, sort_keys=True).encode()
        )
        .rstrip(b"=")
        .decode()
    )

    payload = {
        "user_id": user_id,
        "vault_unlocked": vault_unlocked,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRY_SECONDS,
        "nonce": os.urandom(16).hex(),
    }

    payload_str = (
        base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True).encode()).rstrip(b"=").decode()
    )

    signature = hmac.new(key, f"{header}.{payload_str}".encode(), hashlib.sha256).digest()

    signature_str = base64.urlsafe_b64encode(signature).rstrip(b"=").decode()

    return f"{header}.{payload_str}.{signature_str}"


def verify_jwt_token(token: str) -> Optional[JWTClaims]:
    """Verify and decode a JWT token.

    Args:
        token: JWT token string

    Returns:
        Decoded payload dict if valid, None if invalid
    """
    if not token or "." not in token:
        return None

    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header, payload, signature = parts

        # Decode and verify header
        import json

        header_data = base64.urlsafe_b64decode(header + "==" * (len(header) % 4))
        header_dict = json.loads(header_data.decode())

        if not isinstance(header_dict, dict) or header_dict.get("alg") != "HS256":
            return None

        # Verify signature
        secret = _load_secret(JWT_SECRET)
        key = _derive_key_from_secret(secret)

        expected_sig = hmac.new(key, f"{header}.{payload}".encode(), hashlib.sha256).digest()

        # Decode signature from base64 to bytes
        try:
            signature_bytes = base64.urlsafe_b64decode(signature + "==" * (len(signature) % 4))
        except Exception:
            return None

        if not hmac.compare_digest(signature_bytes, expected_sig):
            return None

        # Decode and verify payload
        payload_data = base64.urlsafe_b64decode(payload + "==" * (len(payload) % 4))
        payload_json = payload_data.decode()
        payload_dict = json.loads(payload_json)
        if not isinstance(payload_dict, dict):
            return None

        user_id = payload_dict.get("user_id")
        vault_unlocked = payload_dict.get("vault_unlocked")
        issued_at = payload_dict.get("iat")
        expires_at = payload_dict.get("exp")
        nonce = payload_dict.get("nonce")
        if (
            not isinstance(user_id, str)
            or not isinstance(vault_unlocked, bool)
            or not isinstance(issued_at, int)
            or isinstance(issued_at, bool)
            or not isinstance(expires_at, int)
            or isinstance(expires_at, bool)
            or not isinstance(nonce, str)
        ):
            return None

        # Check expiration
        if expires_at < int(time.time()):
            return None

        # Check vault is unlocked
        if not vault_unlocked:
            return None

        return {
            "user_id": user_id,
            "vault_unlocked": vault_unlocked,
            "iat": issued_at,
            "exp": expires_at,
            "nonce": nonce,
        }

    except Exception as e:
        print(f"JWT verification error: {e}")
        import traceback

        traceback.print_exc()
        return None


def sign_request(payload: Mapping[str, object]) -> Tuple[str, str]:
    """Sign an API request with HMAC.

    Args:
        payload: Request data to sign

    Returns:
        Tuple of (signature, timestamp)
    """
    secret = _load_secret(HMAC_SECRET)

    # Create message to sign
    message = f"POST{VAULT_PATH}{payload.get('data', '')}".encode()

    # Sign with HMAC-SHA256
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()

    # Generate timestamp
    timestamp = str(int(time.time()))

    return signature, timestamp


def verify_request_signature(
    signature: str,
    timestamp: str,
    payload: Mapping[str, object],
) -> bool:
    """Verify an API request signature.

    Args:
        signature: HMAC signature from client
        timestamp: Timestamp from client
        payload: Request data

    Returns:
        True if valid, False otherwise
    """
    if not signature or not timestamp:
        return False

    # Check timestamp freshness (reject requests older than 30 seconds)
    try:
        req_time = int(timestamp)
        now = int(time.time())
        if now - req_time > 30:
            return False
    except ValueError:
        return False

    # Verify signature
    secret = _load_secret(HMAC_SECRET)

    # Reconstruct message
    message = f"POST{str(VAULT_PATH)}{payload.get('data', '')}".encode()

    # Compute expected signature
    expected_sig = hmac.new(secret, message, hashlib.sha256).hexdigest()

    return hmac.compare_digest(signature, expected_sig)
