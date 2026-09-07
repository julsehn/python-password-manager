"""Configuration management for the Password Manager application.
"""
import os
import re
from pathlib import Path
import json
from typing import Optional, Callable

_DEFAULT_CONFIG = {
    "clipboard_clear_seconds": 30,
    "auto_lock_seconds": 300,
    "show_tutorial": True,
    "railway_url": "https://password-manager-cloud-production.up.railway.app",
    "railway_vault_id": "",
    "railway_token": "",
    "railway_version": None,
    "railway_project_id": "",
    "cloud_provider": "official",  # "official" or "custom"
}


def _get_config_path() -> Path:
    """Get the secure path to the config file in user's home directory."""
    config_dir = Path.home() / ".password_manager"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "config.json"


_config_cache: Optional[dict] = None
_config_lock = Lock()


def _load_config_file() -> dict:
    """Load configuration from file if not already cached."""
    global _config_cache
    with _config_lock:
        if _config_cache is not None:
            return _config_cache
        
        config_path = _get_config_path()
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                _config_cache = {**_DEFAULT_CONFIG, **data}
                return _config_cache
            except (json.JSONDecodeError, IOError):
                _config_cache = _DEFAULT_CONFIG.copy()
                return _config_cache
        _config_cache = _DEFAULT_CONFIG.copy()
        return _config_cache


def load_config() -> dict:
    """Load configuration from file, falling back to defaults.
    
    Returns:
        Configuration dictionary with defaults merged in
    """
    return _load_config_file()


def save_config(config: dict) -> None:
    """Save configuration to file with secure permissions.
    
    Args:
        config: Configuration dictionary to save
    """
    global _config_cache
    with _config_lock:
        _config_cache = None  # Invalidate cache
        _write_secure_json(_get_config_path(), config)


def get_railway_url() -> str:
    """Get the configured Railway API URL.
    
    Returns:
        The Railway API URL, or default official cloud URL if not configured
    """
    config = load_config()
    provider = config.get("cloud_provider", "official")
    
    # If using official cloud, return the official URL
    if provider == "official":
        return "https://password-manager-cloud-production.up.railway.app"
    
    # Otherwise use configured URL
    url = config.get("railway_url", "")
    
    # Auto-generate URL from project_id if only project_id is set
    if not url and config.get("railway_project_id"):
        return generate_railway_url(config["railway_project_id"])
    
    return url or "https://password-manager-cloud-production.up.railway.app"


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
        True if URL, vault_id, and token are all set (for custom cloud)
        or True if using official cloud
    """
    config = load_config()
    provider = config.get("cloud_provider", "official")
    
    if provider == "official":
        # Official cloud is always configured
        return True
    
    # For custom cloud, check all required fields
    return bool(
        config.get("railway_url") and
        config.get("railway_vault_id") and
        config.get("railway_token")
    )


def save_cloud_provider(provider: str) -> None:
    """Save the cloud provider configuration.
    
    Args:
        provider: "official" or "custom"
    """
    config = load_config()
    config["cloud_provider"] = provider
    save_config(config)


def _parse_railway_domain(url: str) -> Optional[str]:
    """Extract project ID from Railway domain.
    
    Extracts the project ID from URLs like:
    - https://password-manager-cloud-abc123.up.railway.app
    
    Args:
        url: The Railway URL
        
    Returns:
        Project ID string or None if URL is invalid
    """
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        if not hostname.endswith(".up.railway.app"):
            return None
        # Extract project ID: password-manager-cloud-XXXXX
        base = hostname.replace(".up.railway.app", "")
        if base.startswith("password-manager-cloud-"):
            return base[len("password-manager-cloud-"):]
        return None
    except Exception:
        return None


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
    
    return f"https://password-manager-cloud-{project_id[:8]}.up.railway.app"



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
