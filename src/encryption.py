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


def derive_key_from_hotspots(hotspots: list[dict], salt_hex: str, iterations: int = DEFAULT_ITERATIONS) -> Tuple[bytes, bytes]:
    """Derive an AES key from biometric hotspot coordinates.

    This function converts a sequence of (x, y) percentage coordinates into
    a deterministic key using PBKDF2. The coordinates act as the "password" input,
    and the salt provides key stretching to prevent brute-force attacks.

    This is used for image-based biometric authentication where the user's
    drawn pattern (hotspots) serves as their "password".

    Args:
        hotspots: List of {"x_pct": float, "y_pct": float} representing the user's drawn pattern
        salt_hex: Hex-encoded random salt bytes (32 bytes encoded as hex)
        iterations: PBKDF2 iteration count for key derivation

    Returns:
        Tuple of (derived_32_byte_key, salt_bytes) for use with encrypt/decrypt
    """
    # Convert hotspot coordinates to a deterministic string
    coords_str = ";".join(f"{hp['x_pct']:.6f},{hp['y_pct']:.6f}" for hp in hotspots)
    salt = bytes.fromhex(salt_hex)

    # Create the key derivation input from coordinates
    password_string = f"hotspots:{coords_str};salt:{salt.hex()}"

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    key = kdf.derive(password_string.encode("utf-8"))

    return key, salt
