"""Configuration management for the Password Manager application.

This module handles loading, saving, and managing application configuration.
All sensitive configuration is stored securely in the user's home directory.
"""
import os
from pathlib import Path
import json
from typing import Optional

# Default configuration values
DEFAULT_CONFIG = {
    "clipboard_clear_seconds": 30,           # Seconds before clipboard is cleared
    "auto_lock_seconds": 300,                # Seconds before auto-lock
    "show_tutorial": True,                   # Show tutorial on first run
    "railway_url": "",                       # Railway API server URL
    "railway_vault_id": "",                  # Vault ID for cloud sync
    "railway_token": "",                     # Auth token (for version checking)
    "railway_version": None,                 # Current version from server
    "railway_project_id": "",                # Railway project ID for auto-generating URL
}


def get_config_path() -> Path:
    """Get the secure path to the config file in user's home directory.

    Returns:
        Path to ~/.password_manager/config.json
    """
    config_dir = Path.home() / ".password_manager"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "config.json"


def load_config() -> dict:
    """Load configuration from file, falling back to defaults.

    Returns:
        Configuration dictionary with defaults merged in
    """
    config_path = get_config_path()
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {**DEFAULT_CONFIG, **data}
        except (json.JSONDecodeError, IOError):
            return DEFAULT_CONFIG.copy()
    return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> None:
    """Save configuration to file with secure permissions.

    Args:
        config: Configuration dictionary to save
    """
    config_path = get_config_path()
    _write_secure_json(config_path, config)


def get_railway_url() -> str:
    """Get the configured Railway API URL.

    Returns:
        The Railway API URL, or default if not configured
    """
    config = load_config()
    url = config.get("railway_url", "")
    
    # Auto-generate URL from project name if only project_id is set
    if not url and config.get("railway_project_id"):
        # Railway generates domains like: password-manager-cloud-abc123.up.railway.app
        project_id = config["railway_project_id"][:8]  # Use first 8 chars
        url = f"https://password-manager-cloud-{project_id}.up.railway.app"
    
    return url or "https://password-manager-cloud.up.railway.app"


def get_railway_vault_id() -> str:
    """Get the configured vault ID.

    Returns:
        The vault ID, or empty string if not configured
    """
    return load_config().get("railway_vault_id", "")


def get_railway_token() -> str:
    """Get the configured authentication token.

    Returns:
        The auth token, or empty string if not configured
    """
    return load_config().get("railway_token", "")


def is_railway_configured() -> bool:
    """Check if the Railway service is fully configured.

    Returns:
        True if URL, vault_id, and token are all set
    """
    config = load_config()
    return bool(
        config.get("railway_url") and
        config.get("railway_vault_id") and
        config.get("railway_token")
    )


def generate_railway_url(project_id: str) -> str:
    """Generate Railway URL from project ID.

    Railway generates domains like: password-manager-cloud-abc123.up.railway.app

    Args:
        project_id: Railway project ID (typically UUID)

    Returns:
        Generated Railway URL
    """
    if not project_id:
        return ""
    
    # Use first 8 characters of project ID
    project_id_short = project_id[:8]
    return f"https://password-manager-cloud-{project_id_short}.up.railway.app"


def set_railway_url(url: str) -> None:
    """Set the Railway API URL.

    Args:
        url: The Railway API server URL
    """
    config = load_config()
    config["railway_url"] = url
    config["last_update_url"] = url
    save_config(config)


def set_railway_credentials(vault_id: str, token: str) -> None:
    """Set the Railway vault credentials.

    Args:
        vault_id: The vault identifier
        token: The authentication token
    """
    config = load_config()
    config["railway_vault_id"] = vault_id
    config["railway_token"] = token
    save_config(config)


def clear_railway_credentials() -> None:
    """Clear Railway credentials from configuration."""
    config = load_config()
    config["railway_vault_id"] = ""
    config["railway_token"] = ""
    config["railway_version"] = None
    config["railway_project_id"] = ""
    save_config(config)


def set_railway_project_id(project_id: str) -> None:
    """Set the Railway project ID for auto-generating the URL.

    Args:
        project_id: Railway project ID (e.g., from the project dashboard)
    """
    config = load_config()
    config["railway_project_id"] = project_id
    save_config(config)


def _write_secure_json(path: Path, data: dict) -> None:
    """Write JSON to file with secure file permissions.

    Args:
        path: File path to write to
        data: Data to serialize as JSON
    """
    _secure_parent_directory(path)
    tmp_path = path.with_suffix(".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        # Set file permissions (owner only) for POSIX systems
        os.chmod(tmp_path, 0o600)
        # Atomic replace for security
        os.replace(str(tmp_path), str(path))
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def _secure_parent_directory(path: Path) -> None:
    """Create parent directory with secure permissions if needed.

    Args:
        path: The target file path
    """
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    # Set directory permissions (owner only) for POSIX systems
    if os.name == "posix":
        os.chmod(parent, 0o700)
