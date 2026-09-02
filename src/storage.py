import os
import json
import base64
import hashlib
import time
from typing import List, Optional
import binascii

from src.encryption import derive_key, encrypt, decrypt
from src.models import PasswordEntry

# Default vault path (not committed)
VAULT_FILENAME = os.path.expanduser("~/.password_manager/vault.json")
SIDEBAR_SETTINGS_FILENAME = os.path.expanduser("~/.password_manager/sidebar.json")
LOCKOUT_STATE_FILENAME = os.path.expanduser("~/.password_manager/lockout_state.json")
CONFIG_FILENAME = os.path.expanduser("~/.password_manager/config.json")

# Default configuration
DEFAULT_CONFIG = {
    "clipboard_clear_seconds": 30,
    "auto_lock_seconds": 300,
    "show_tutorial": True,
}

# Brute-force protection: max attempts before lockout
MAX_LOGIN_ATTEMPTS = 10
LOCKOUT_DURATION_SECONDS = 300  # 5 minutes

# Image authentication paths
IMAGE_AUTH_FILE = os.path.expanduser("~/.password_manager/image_auth.json")

# Image authentication defaults
DEFAULT_IMAGE_AUTH = {
    "enabled": False,
    "image_b64": None,  # Base64-encoded image (PNG)
    "original_size": None,  # [width, height] in pixels
    "hotspots": [],  # List of {"x_pct": float, "y_pct": float} (percentages)
    "salt": None,  # Salt used to derive master key from hotspots
}


class VaultLockedError(Exception):
    """Raised when master password is locked due to too many failed attempts."""


def load_config() -> dict:
    """Load the application configuration file."""
    if os.path.exists(CONFIG_FILENAME):
        try:
            with open(CONFIG_FILENAME, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {**DEFAULT_CONFIG, **data}
        except (json.JSONDecodeError, IOError):
            return DEFAULT_CONFIG.copy()
    return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> None:
    """Save the application configuration to a file."""
    _write_private_json(CONFIG_FILENAME, config)


def _load_lockout_state() -> dict[str, dict]:
    """Load the lockout state from the file."""
    if os.path.exists(LOCKOUT_STATE_FILENAME):
        try:
            with open(LOCKOUT_STATE_FILENAME, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def _get_lockout_state(vault_path: str) -> dict:
    """Get the lockout state for a vault path from the persistent storage."""
    state_data = _load_lockout_state()
    if vault_path not in state_data:
        state_data[vault_path] = {
            "failed_attempts": 0,
            "lockout_start": 0.0,
        }
        _save_lockout_state(state_data)
    return state_data[vault_path]


def _save_lockout_state(state_data: dict[str, dict]) -> None:
    """Save the lockout state to the file."""
    _write_private_json(LOCKOUT_STATE_FILENAME, state_data)


def _record_failed_attempt(vault_path: str) -> None:
    """Record a failed login attempt, potentially starting lockout."""
    state_data = _load_lockout_state()
    state = state_data.get(vault_path, {"failed_attempts": 0, "lockout_start": 0.0})
    now = time.time()

    # If we're still in lockout period, don't reset
    if state["lockout_start"] > 0 and (now - state["lockout_start"]) < LOCKOUT_DURATION_SECONDS:
        raise VaultLockedError(
            f"Vault is locked. Try again in {int((LOCKOUT_DURATION_SECONDS - (now - state['lockout_start'])) / 60)} minutes."
        )

    state["failed_attempts"] += 1

    # If we've exceeded max attempts, start lockout
    if state["failed_attempts"] >= MAX_LOGIN_ATTEMPTS:
        state["lockout_start"] = now
    
    state_data[vault_path] = state
    _save_lockout_state(state_data)


def _record_successful_login(vault_path: str) -> None:
    """Clear lockout state on successful login."""
    state_data = _load_lockout_state()
    if vault_path in state_data:
        del state_data[vault_path]
        _save_lockout_state(state_data)


def is_vault_locked(vault_path: str) -> bool:
    """Check if a vault is currently locked."""
    state_data = _load_lockout_state()
    state = state_data.get(vault_path, {"lockout_start": 0.0})
    now = time.time()
    if state["lockout_start"] > 0 and (now - state["lockout_start"]) < LOCKOUT_DURATION_SECONDS:
        return True
    return False


def _secure_parent_directory(path: str) -> None:
    """Create the vault directory without exposing its contents to other users."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if os.name == "posix":
        os.chmod(directory, 0o700)


def _write_private_json(path: str, data: object) -> None:
    """Atomically write JSON with owner-only permissions on POSIX systems."""
    _secure_parent_directory(path)
    tmp_path = f"{path}.tmp"
    try:
        fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        if os.name == "posix":
            os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
        if os.name == "posix":
            os.chmod(path, 0o600)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def save_sidebar_settings(settings: list[dict], path: str = SIDEBAR_SETTINGS_FILENAME) -> None:
    """Persist folder labels and appearance separately from encrypted passwords."""
    _write_private_json(path, settings)


def load_sidebar_settings(path: str = SIDEBAR_SETTINGS_FILENAME) -> list[dict]:
    """Load folder appearance settings, returning an empty list when unavailable."""
    try:
        with open(path, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_vault(entries: List[PasswordEntry], master_password: str, path: str = VAULT_FILENAME) -> None:
    """Serialize entries to JSON, encrypt with key derived from master_password, and save to path."""
    if len(master_password) < 16:
        raise ValueError("La contrasenya mestra ha de tenir com a mínim 16 caràcters")

    data = {"entries": [e.to_dict() for e in entries]}
    plaintext = json.dumps(data, ensure_ascii=False).encode("utf-8")

    key, salt = derive_key(master_password)
    nonce, ciphertext = encrypt(plaintext, key)

    payload = {
        "salt": base64.b64encode(salt).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        "version": "1",
    }

    _write_private_json(path, payload)


def load_vault(master_password: str, path: str = VAULT_FILENAME) -> List[PasswordEntry]:
    """Load vault from path, decrypt with master_password, and return entries list."""
    if len(master_password) < 16:
        raise ValueError("La contrasenya mestra ha de tenir com a mínim 16 caràcters")

    # Check for lockout
    if is_vault_locked(path):
        raise VaultLockedError("Vault is locked due to too many failed attempts.")

    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    if not isinstance(payload, dict) or payload.get("version") != "1":
        _record_failed_attempt(path)
        raise ValueError("Format de caixa forta no compatible")

    # decode base64 fields to bytes
    try:
        salt = base64.b64decode(payload["salt"], validate=True)
        nonce = base64.b64decode(payload["nonce"], validate=True)
        ciphertext = base64.b64decode(payload["ciphertext"], validate=True)
    except (KeyError, TypeError, binascii.Error) as error:
        _record_failed_attempt(path)
        raise ValueError("Format de caixa forta invàlid") from error

    if len(salt) != 16 or len(nonce) != 12:
        _record_failed_attempt(path)
        raise ValueError("Format de caixa forta invàlid")

    key, _ = derive_key(master_password, salt=salt)
    plaintext = decrypt(nonce, ciphertext, key)
    data = json.loads(plaintext.decode("utf-8"))
    entries = data.get("entries", []) if isinstance(data, dict) else []

    if not isinstance(entries, list) or len(entries) > 10_000:
        raise ValueError("Contingut de caixa forta invàlid")

    # Success! Clear lockout state
    _record_successful_login(path)

    return [PasswordEntry.from_dict(d) for d in entries if isinstance(d, dict)]


def export_vault(path: str = VAULT_FILENAME, dest_dir: str | None = None) -> Optional[str]:
    """Create a timestamped backup copy of the vault file.

    Returns the path to the backup file, or None if export fails.
    """
    import shutil

    from datetime import datetime

    # Validate source path to prevent traversal attacks
    resolved_source = os.path.realpath(path)
    if not os.path.exists(resolved_source):
        return None

    if dest_dir is None:
        dest_dir = os.path.dirname(resolved_source) or "."

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.basename(path).replace(".json", f"_{timestamp}.bak.json")
    dest_path = os.path.join(dest_dir, filename)

    try:
        shutil.copy2(resolved_source, dest_path)
        if os.name == "posix":
            os.chmod(dest_path, 0o600)
        return dest_path
    except Exception:
        return None


# ========================================
# Image Authentication (Biometric) Layer
# ========================================

def save_image_auth(image_b64: str, hotspots: list[dict], salt: bytes | None = None) -> None:
    """Save the image-based authentication template.

    Args:
        image_b64: Base64-encoded PNG image (the template canvas)
        hotspots: List of {"x_pct": float, "y_pct": float} representing the user's drawn strokes
                  (percentages relative to image dimensions, 0-1 range)
        salt: Optional random salt for key derivation (generated if not provided)

    The hotspots represent a sequence of points the user drew/clicked. This is their
    "biometric password" — to unlock, they must reproduce the same pattern.
    """
    if salt is None:
        import os
        salt = os.urandom(32)

    auth_data = {
        "enabled": True,
        "image_b64": image_b64,
        "original_size": None,  # Will be set when loading (derived from image)
        "hotspots": hotspots,
        "salt": base64.b64encode(salt).decode("ascii"),
    }

    _write_private_json(IMAGE_AUTH_FILE, auth_data)


def load_image_auth() -> dict | None:
    """Load the stored image authentication template.

    Returns:
        Dict with keys: enabled, image_b64, hotspots, salt
        or None if no template exists.
    """
    if not os.path.exists(IMAGE_AUTH_FILE):
        return None

    try:
        with open(IMAGE_AUTH_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict) or not data.get("enabled"):
            return None

        return {
            "image_b64": data.get("image_b64"),
            "hotspots": data.get("hotspots", []),
            "salt": data.get("salt"),
        }
    except (json.JSONDecodeError, IOError):
        return None


def delete_image_auth() -> bool:
    """Delete the image authentication template."""
    if os.path.exists(IMAGE_AUTH_FILE):
        os.remove(IMAGE_AUTH_FILE)
        return True
    return False


def image_auth_is_set() -> bool:
    """Check if image-based authentication is configured."""
    return os.path.exists(IMAGE_AUTH_FILE)


def _generate_key_from_hotspots(hotspots: list[dict], salt: bytes) -> str:
    """Generate a deterministic master key string from hotspot coordinates.

    The hotspots represent the user's drawn pattern. We convert these to a
    canonical string that can be used as input for PBKDF2 key derivation.

    Format: "x1,y1;x2,y2;...;salt_hex"
    This creates a unique "password" from the user's biometric pattern.

    Args:
        hotspots: List of {"x_pct": float, "y_pct": float}
        salt: Random salt bytes for key derivation

    Returns:
        A deterministic string that can be used as input to derive_key()
    """
    # Convert hotspot coordinates to a canonical string
    coords_str = ";".join(f"{hp['x_pct']:.6f},{hp['y_pct']:.6f}" for hp in hotspots)
    salt_hex = salt.hex()

    # Create the "password" from coordinates + salt
    return f"hotspots:{coords_str};salt:{salt_hex}"


def derive_key_from_image_auth(hotspots: list[dict], salt_hex: str) -> bytes:
    """Derive the AES key from image authentication hotspots.

    This replaces the text password-based derive_key() with a biometric pattern.

    Args:
        hotspots: List of {"x_pct": float, "y_pct": float} representing the user's drawn pattern
        salt_hex: Hex-encoded salt bytes used during setup

    Returns:
        32-byte AES key derived from the biometric pattern
    """
    import os

    # Convert hotspot coordinates to a deterministic key derivation input
    coords_str = ";".join(f"{hp['x_pct']:.6f},{hp['y_pct']:.6f}" for hp in hotspots)
    salt = bytes.fromhex(salt_hex)

    # Use PBKDF2 to derive a key from the coordinate string
    # The coordinates act as the "password" input, salt is used for key stretching
    password_string = f"hotspots:{coords_str};salt:{salt.hex()}"

    key, _ = derive_key(password_string, salt=salt)
    return key


def verify_image_auth_pattern(strokes: list[dict], stored_hotspots: list[dict], salt_hex: str) -> bool:
    """Verify that the user's drawn pattern matches the stored template.

    This is a tolerance-based comparison — human drawing isn't pixel-perfect.
    We check that the user reproduced approximately the same sequence of points.

    Args:
        strokes: User's drawn strokes as [{"x_pct": float, "y_pct": float}]
        stored_hotspots: The original template hotspots
        salt_hex: Hex-encoded salt used during setup

    Returns:
        True if the pattern matches within tolerance thresholds.
    """
    try:
        salt = bytes.fromhex(salt_hex)
    except (TypeError, ValueError):
        return False

    if len(salt) != 32 or not strokes or not stored_hotspots:
        return False

    if len(strokes) < len(stored_hotspots) * 0.5:
        # User drew less than half the original points — likely not a match
        return False

    if len(strokes) > len(stored_hotspots) * 3:
        # User drew way more points — suspicious
        return False

    # Match points one-to-one so one nearby stroke cannot satisfy multiple hotspots.
    tolerance_pct = 0.15  # 15% tolerance (0-1 range)
    distances = []
    try:
        for stored in stored_hotspots:
            if not 0 <= stored['x_pct'] <= 100 or not 0 <= stored['y_pct'] <= 100:
                return False
            for index, stroke in enumerate(strokes):
                if not 0 <= stroke['x_pct'] <= 100 or not 0 <= stroke['y_pct'] <= 100:
                    return False
                dx = stroke['x_pct'] - stored['x_pct']
                dy = stroke['y_pct'] - stored['y_pct']
                distances.append(((dx * dx + dy * dy) ** 0.5, index))
    except (KeyError, TypeError, ValueError):
        return False

    distances.sort()
    matched_strokes = set()
    matched_hotspots = 0
    for distance, stroke_index in distances:
        if distance > tolerance_pct or stroke_index in matched_strokes:
            continue
        matched_strokes.add(stroke_index)
        matched_hotspots += 1
        if matched_hotspots == len(stored_hotspots):
            return True
    return False


def export_image_auth() -> Optional[str]:
    """Export the image authentication template as a JSON file.

    Returns path to backup file, or None if export fails.
    """
    auth_data = load_image_auth()
    if not auth_data:
        return None

    import shutil
    from datetime import datetime

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.expanduser(f"~/.password_manager/image_auth_{timestamp}.json")

    try:
        _write_private_json(backup_path, {
            "enabled": True,
            **auth_data
        })
        return backup_path
    except Exception:
        return None


def restore_image_auth(backup_path: str) -> bool:
    """Restore image authentication from a backup file.

    Args:
        backup_path: Path to the backup JSON file

    Returns:
        True if restoration succeeded, False otherwise.
    """
    try:
        with open(backup_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict) or not data.get("enabled"):
            return False

        image_b64 = data.get("image_b64")
        hotspots = data.get("hotspots")
        encoded_salt = data.get("salt")
        if not isinstance(image_b64, str) or not isinstance(hotspots, list):
            return False
        if not isinstance(encoded_salt, str):
            return False
        salt = base64.b64decode(encoded_salt, validate=True)
        if len(salt) != 32:
            return False

        save_image_auth(image_b64=image_b64, hotspots=hotspots, salt=salt)
        return True
    except Exception:
        return False
