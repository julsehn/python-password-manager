"""Client-side orchestration for a Railway-hosted encrypted vault.

All encryption/decryption happens on the client side - passwords never leave
the device in plaintext. The server only stores encrypted blobs.

Backup: Use Railway dashboard or the backup_database() function in app/main.py
"""

from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from src.railway_client import RailwayVaultClient, create_vault_credentials
from src.storage import deserialize_vault, serialize_vault, VAULT_FILENAME
from src.models import PasswordEntry
from src.config import load_config, save_config, CONFIG


@dataclass
class RemoteVaultStatus:
    """Status of remote vault connection."""
    configured: bool = False
    has_server: bool = False
    version: Optional[int] = None
    url: str = ""
    vault_id: str = ""
    error: Optional[str] = None


class RemoteVaultStore:
    def __init__(self, config: Optional[dict] = None):
        self.config = config if config else load_config()
        self._status = RemoteVaultStatus()
        self._auth_required = False  # True if user must register/login first
        self._update_status()

    def _update_status(self) -> None:
        """Update the internal status based on current configuration."""
        url = self.config.get("railway_url", "")
        vault_id = self.config.get("railway_vault_id", "")
        token = self.config.get("railway_token", "")
        
        self._status.configured = bool(url and vault_id and token)
        self._status.has_server = bool(url)
        self._status.version = self.config.get("railway_version")
        self._status.url = url
        self._status.vault_id = vault_id
        self._status.error = None

    def _get_config(self) -> dict:
        """Get current configuration."""
        return load_config()

    def _save_config(self) -> None:
        """Save current configuration."""
        save_config(self.config)

    @property
    def configured(self) -> bool:
        """Check if remote vault is fully configured."""
        self._update_status()
        return self._status.configured

    @property
    def has_server(self) -> bool:
        """Check if server URL is configured."""
        self._update_status()
        return self._status.has_server

    def _client(self) -> RailwayVaultClient:
        """Create a new client instance."""
        config = self._get_config()
        url = config.get("railway_url", "").rstrip("/")
        return RailwayVaultClient(url, self._status.vault_id, self._status.vault_id)

    def load(self, master_password: str) -> tuple[List[PasswordEntry], int, bool]:
        """Download vault from remote server.
        
        Args:
            master_password: The master password for decryption
            
        Returns:
            Tuple of (entries list, version number, success bool)
            
        Raises:
            ValueError: If not configured
            Exception: If server returns error
        """
        if not self._status.configured:
            raise ValueError("Caixa forta remota no està configurada")

        try:
            remote = self._client().download()
            if not remote.blob:
                self.config["railway_version"] = remote.version
                self._save_config()
                return [], remote.version, True
            entries = deserialize_vault(
                remote.blob, master_password, 
                lockout_key=f"remote:{remote.vault_id}"
            )
            self.config["railway_version"] = remote.version
            self._save_config()
            return entries, remote.version, True
        except Exception as e:
            self._status.error = str(e)
            raise

    def save(self, entries: List[PasswordEntry], master_password: str) -> dict:
        """Save vault to remote server.
        
        Will fail if version is stale (syncing to old version will cause conflicts).
        Delete and recreate vault if version > 10000.
        
        Args:
            entries: List of password entries to encrypt and save
            master_password: The master password for encryption
            
        Returns:
            Configuration dict with updated version
            
        Raises:
            ValueError: If not configured
            Exception: If server returns error
        """
        if not self._status.configured:
            raise ValueError("Caixa forta remota no està configurada")

        try:
            blob = serialize_vault(entries, master_password)
            remote = self._client().upload(
                blob, 
                expected_version=self._status.version
            )
            self.config["railway_version"] = remote.version
            self._save_config()
            self._status.error = None
            return self.config
        except Exception as e:
            self._status.error = str(e)
            raise

    def delete(self) -> bool:
        """Delete the configured remote vault from the server.
        
        Returns:
            True if deletion successful
        """
        if not self._status.configured:
            raise ValueError("La caixa forta remota no està configurada")
        try:
            self._client().delete()
            self.config.update({
                "railway_vault_id": "",
                "railway_token": "",
                "railway_version": None,
            })
            self._save_config()
            self._update_status()
            return True
        except Exception as e:
            self._status.error = str(e)
            raise
    
    def authenticate_user(self, username: str, password: str, create_if_not_exists: bool = False) -> dict:
        """Authenticate user with the cloud service.
        
        Args:
            username: Username for authentication
            password: Password (used for vault encryption and server auth)
            create_if_not_exists: If True, create new user if doesn't exist
            
        Returns:
            dict with user_id, username, email, access_token
            
        Raises:
            Exception: If authentication fails
        """
        if not self._status.configured:
            raise ValueError("Servidor no configurat. Assegura't que l'URL és correcta.")
        
        try:
            client = self._client()
            response = client.login_user(username, password)
            self.config["auth_user"] = response["username"]
            self._save_config()
            return response
        except Exception as auth_error:
            if create_if_not_exists:
                # Try to register new user
                try:
                    response = client.register_user(username, password)
                    self.config["auth_user"] = response["username"]
                    self._save_config()
                    return response
                except Exception as reg_error:
                    raise Exception(f"No es pot autenticar: {str(auth_error)}")
            else:
                raise
