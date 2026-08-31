import os
import json
import base64
import binascii
import time
from typing import List, Optional

from src.encryption import derive_key, encrypt, decrypt
from src.models import PasswordEntry

# Default vault path (not committed)
VAULT_FILENAME = os.path.expanduser("~/.password_manager/vault.json")
SIDEBAR_SETTINGS_FILENAME = os.path.expanduser("~/.password_manager/sidebar.json")
LOCKOUT_STATE_FILENAME = os.path.expanduser("~/.password_manager/lockout_state.json")

# Brute-force protection: max attempts before lockout
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 300  # 5 minutes


class VaultLockedError(Exception):
    """Raised when master password is locked due to too many failed attempts."""


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
    if not os.path.isfile(resolved_source):
        raise FileNotFoundError(f"Vault not found: {path}")

    if dest_dir is None:
        dest_dir = os.path.dirname(path)

    # Validate destination directory to prevent path traversal
    if dest_dir is not None:
        resolved_dest = os.path.realpath(dest_dir)
        # Ensure the destination is within a reasonable scope (home dir or parent of vault)
        allowed_base = os.path.dirname(resolved_source)
        if not resolved_dest.startswith(allowed_base):
            raise ValueError("Backup destination must be within the vault directory.")

    if not os.path.exists(path):
        raise FileNotFoundError(f"Vault not found: {path}")

    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    base = os.path.basename(path)
    backup_name = f"{base}.backup-{ts}"

    # Use realpath on the resolved path to prevent traversal
    dest_path = os.path.join(dest_dir, backup_name)

    # Final safety check: ensure resolved dest is within expected directory
    resolved_dest_path = os.path.realpath(dest_path)
    if not resolved_dest_path.startswith(allowed_base):
        raise ValueError("Backup destination is outside the allowed directory.")

    shutil.copy2(resolved_source, resolved_dest_path)
    return resolved_dest_path
