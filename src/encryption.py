import os
from typing import Tuple

from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# Minimum iterations per OWASP 2023 guidelines for PBKDF2-SHA256 (600k+ recommended for modern threats)
# (200k is the old default; 600k+ is recommended for modern threats)
DEFAULT_ITERATIONS = 600_000


def derive_key(
    password: str,
    salt: bytes | None = None,
    iterations: int = DEFAULT_ITERATIONS,
) -> Tuple[bytes, bytes]:
    """Derive a 32-byte key from password using PBKDF2-HMAC-SHA256.

    Returns (key, salt). If salt is None a new random 16-byte salt is generated.
    """
    if iterations < DEFAULT_ITERATIONS:
        raise ValueError(
            f"PBKDF2 iterations must be >= {DEFAULT_ITERATIONS}, got {iterations}"
        )

    if salt is None:
        salt = os.urandom(16)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    key = kdf.derive(password.encode("utf-8"))
    return key, salt


def encrypt(plaintext: bytes, key: bytes) -> tuple[bytes, bytes]:
    """Encrypt plaintext with AES-256-GCM. Returns (nonce, ciphertext).
    Ciphertext includes the authentication tag as produced by AESGCM.
    """
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    return nonce, ct


def decrypt(nonce: bytes, ciphertext: bytes, key: bytes) -> bytes:
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, associated_data=None)
