import os
from typing import Tuple

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


ARGON2_MEMORY_COST_KIB = 19 * 1024
ARGON2_TIME_COST = 2
ARGON2_PARALLELISM = 1
KEY_LENGTH = 32


def derive_key(
    password: str,
    salt: bytes | None = None,
) -> Tuple[bytes, bytes]:
    """Derive a 32-byte key from password using Argon2id.

    Returns (key, salt). If salt is None a new random 16-byte salt is generated.
    """
    if salt is None:
        salt = os.urandom(16)

    key = hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=ARGON2_TIME_COST,
        memory_cost=ARGON2_MEMORY_COST_KIB,
        parallelism=ARGON2_PARALLELISM,
        hash_len=KEY_LENGTH,
        type=Type.ID,
    )
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


def derive_key_from_hotspots(hotspots: list[dict], salt_hex: str) -> Tuple[bytes, bytes]:
    """Derive an AES key from biometric hotspot coordinates.

    This function converts a sequence of (x, y) percentage coordinates into
    a deterministic key using Argon2id. The coordinates act as the "password" input,
    and the salt provides key stretching to prevent brute-force attacks.

    This is used for image-based biometric authentication where the user's
    drawn pattern (hotspots) serves as their "password".

    Args:
        hotspots: List of {"x_pct": float, "y_pct": float} representing the user's drawn pattern
        salt_hex: Hex-encoded random salt bytes (32 bytes encoded as hex)
    Returns:
        Tuple of (derived_32_byte_key, salt_bytes) for use with encrypt/decrypt
    """
    # Convert hotspot coordinates to a deterministic string
    coords_str = ";".join(f"{hp['x_pct']:.6f},{hp['y_pct']:.6f}" for hp in hotspots)
    salt = bytes.fromhex(salt_hex)

    # Create the key derivation input from coordinates
    password_string = f"hotspots:{coords_str};salt:{salt.hex()}"

    key, _ = derive_key(password_string, salt=salt)

    return key, salt


def derive_key_from_grid_pattern(pattern_cells: list[int], salt_hex: str) -> Tuple[bytes, bytes]:
    """Derive an AES key from a grid-based pattern (cell indices).

    This converts grid cell indices to a password-like string and derives
    a key from it using Argon2id. Each cell index represents a discrete choice,
    making this resistant to keyloggers and RATs that see screen interactions.

    Args:
        pattern_cells: List of grid cell indices (each 0-24 for 5x5 grid)
        salt_hex: Hex-encoded random salt bytes (32 bytes encoded as hex)
    Returns:
        Tuple of (derived_32_byte_key, salt_bytes) for use with encrypt/decrypt
    """
    salt = bytes.fromhex(salt_hex)
    
    # Convert cell indices to a deterministic password-like string
    from src.storage import generate_grid_password
    password_string = generate_grid_password(pattern_cells)
    
    key, _ = derive_key(password_string, salt=salt)

    return key, salt
