"""Client for interacting with the Railway vault service.

This client provides a REST API wrapper for the Password Manager Cloud service.
All encryption/decryption happens client-side before sending data to the server.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import requests
import secrets
import uuid
import time
from functools import wraps
from threading import Lock
from collections import defaultdict

# Retry configuration
MAX_RETRIES = 3
BASE_DELAY = 1  # seconds


class RateLimiter:
    """Simple rate limiter for API requests using token bucket algorithm."""
    def __init__(self, max_requests: int = 100, per_period: int = 60):
        self.max_requests = max_requests
        self.per_period = per_period
        self.requests: list[float] = []
        self.lock = Lock()
    
    def acquire(self) -> bool:
        """Acquire permission to make a request.
        
        Returns True if allowed, False if rate limited.
        """
        with self.lock:
            now = time.time()
            # Remove old requests outside the period
            self.requests = [t for t in self.requests if now - t < self.per_period]
            
            if len(self.requests) < self.max_requests:
                self.requests.append(now)
                return True
            return False
    
    def __call__(self, func):
        """Decorator to rate limit a function."""
        @wraps(func)
        def wrapper(*args, **kwargs):
            while not self.acquire():
                # Wait for next available slot
                oldest = self.requests[0]
                wait_time = self.per_period - (time.time() - oldest)
                time.sleep(min(wait_time, 0.1))  # Check frequently, not in long sleep
            return func(*args, **kwargs)
        return wrapper


def create_vault_credentials() -> tuple[str, str]:
    """Create new credentials for a vault registration.

    Returns:
        Tuple of (vault_id, token) where:
        - vault_id: UUID to identify this vault
        - token: Random string used as authentication/version token
    """
    return uuid.uuid4().hex, secrets.token_urlsafe(32)


@dataclass(frozen=True)
class RemoteVault:
    """Represents a version of the vault retrieved from the server.

    Attributes:
        vault_id: Unique identifier for this vault
        blob: Encrypted vault data as JSON string
        version: Version number for optimistic locking
        updated_at: ISO timestamp of last update
    """
    vault_id: str
    blob: str
    version: int
    updated_at: str


class RailwayVaultClient:
    """Client for interacting with the Railway vault service.

    All API calls assume the server is running at the configured base_url.
    The vault_id and token are used for authentication and vault identification.
    """

    def __init__(self, base_url: str, vault_id: str, token: str, timeout: int = 15):
        """Initialize the client.

        Args:
            base_url: URL of the Railway API server
            vault_id: Unique identifier for this vault
            token: Authentication token (also used for version checking)
            timeout: Request timeout in seconds
        """
        self.base_url = base_url.rstrip("/")
        self.vault_id = vault_id
        self.token = token
        self.timeout = timeout

    def _get_vault_path(self) -> str:
        return f"/v1/vaults/{self.vault_id}"

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Make an HTTP request to the API with retry logic.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            path: API path (e.g., /v1/vaults)
            payload: JSON payload for POST/PUT
            headers: Additional headers to send

        Returns:
            Parsed JSON response

        Raises:
            Exception: If the request fails
        """
        url = f"{self.base_url}{path}"
        if headers is None:
            headers = {}
        headers.setdefault("Accept", "application/json")

        # Add auth token for protected endpoints
        if method in ("GET", "PUT", "DELETE"):
            headers["Authorization"] = f"Bearer {self.token}"

        response_data = None
        
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.request(
                    method,
                    url,
                    json=payload if payload else None,
                    headers=headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                
                # Handle specific status codes
                if response.status_code == 409:
                    response_json = response.json() if response.content else {}
                    raise Exception(f"Vault conflict: {response_json.get('detail', 'Unknown error')}")
                
                if response.status_code == 204:
                    response_data = {}
                else:
                    response_data = response.json()
                
                # Validate response has expected fields
                if "vault_id" not in response_data or "blob" not in response_data or "version" not in response_data:
                    raise Exception("Invalid response from server")
                return response_data
                
            except requests.RequestException as e:
                if attempt < MAX_RETRIES:
                    delay = min(BASE_DELAY * (2 ** (attempt - 1)), MAX_DELAY)
                    time.sleep(delay)
                    print(f"Network retry {attempt}/{MAX_RETRIES} after {delay}s delay...")
                else:
                    # All retries exhausted - handle 404 specially
                    if hasattr(e, 'response') and e.response is not None:
                        if e.response.status_code == 404:
                            raise Exception(f"Vault not found: {self.vault_id}")
                        if e.response.status_code == 409:
                            try:
                                detail = e.response.json().get('detail', '')
                                if "expected" in detail.lower():
                                    expected = detail.split("expected ")[1].split(",")[0]
                                    raise Exception(f"Version conflict: expected {expected}")
                                raise Exception(f"Version conflict: {detail}")
                            except Exception:
                                raise
                    raise e
            
            except Exception as e:
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 404:
                        raise Exception(f"Vault not found: {self.vault_id}")
                    if e.response.status_code == 409:
                        try:
                            detail = e.response.json().get('detail', '')
                            if "expected" in detail.lower():
                                expected = detail.split("expected ")[1].split(",")[0]
                                raise Exception(f"Version conflict: expected {expected}")
                            raise Exception(f"Version conflict: {detail}")
                        except Exception:
                            raise
                raise

    def register(self, blob: str = "") -> RemoteVault:
        """Register a new vault on the server.

        This creates a new vault entry with the provided encrypted blob.
        Typically called during initial vault creation.

        Args:
            blob: Encrypted vault data as JSON string

        Returns:
            RemoteVault with the registered vault details

        Raises:
            Exception: If vault already exists (409) or other error
        """
        url = f"{self.base_url}/v1/vaults"
        headers = {"Content-Type": "application/json"}
        payload = {
            "vault_id": self.vault_id,
            "token": self.token,
            "blob": blob,
        }

        response = self._request("POST", url, payload=payload)
        return RemoteVault(
            vault_id=response["vault_id"],
            blob=response["blob"],
            version=response["version"],
            updated_at=response["updated_at"],
        )

    def download(self) -> RemoteVault:
        """Download the current vault state from the server.

        Returns:
            RemoteVault with the latest vault data

        Raises:
            Exception: If vault not found (404) or other error
        """
        response = self._request("GET", self._get_vault_path())
        return RemoteVault(
            vault_id=response["vault_id"],
            blob=response["blob"],
            version=response["version"],
            updated_at=response["updated_at"],
        )

    def upload(self, blob: str, expected_version: Optional[int] = None) -> RemoteVault:
        """Upload a new version of the vault blob.

        Includes optimistic version checking to prevent data corruption
        from simultaneous updates.

        Args:
            blob: Encrypted vault data as JSON string
            expected_version: Expected current version (for version conflict handling)

        Returns:
            RemoteVault with the updated vault details

        Raises:
            Exception: If version conflict or other error
        """
        url = self._get_vault_path()
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {"blob": blob}

        # Only include expected_version if provided (version conflict check)
        if expected_version is not None:
            payload["expected_version"] = expected_version

        response = self._request("PUT", url, payload=payload)
        return RemoteVault(
            vault_id=response["vault_id"],
            blob=response["blob"],
            version=response["version"],
            updated_at=response["updated_at"],
        )

    def delete(self) -> None:
        """Delete the vault from the server.

        Raises:
            Exception: If vault not found (404) or other error
        """
        response = self._request("DELETE", self._get_vault_path())
        if isinstance(response, dict) and response.get("detail"):
            raise Exception(f"Delete failed: {response['detail']}")

    def reset(self) -> None:
        """Reset client state (vault ID and token).

        Generate new random credentials for the same vault.
        This is useful after re-registration or credential rotation.
        """
        self.vault_id = str(uuid.uuid4())
        self.token = secrets.token_urlsafe(32)
