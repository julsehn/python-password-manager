"""Client for interacting with the Railway vault service.

This client provides a REST API wrapper for the Password Manager Cloud service.
All encryption/decryption happens client-side before sending data to the server.
"""

from dataclasses import dataclass
from collections.abc import Callable, Mapping
from typing import Optional, ParamSpec, TypeVar
import requests
import secrets
import uuid
import time
from functools import wraps
from threading import Lock

# Retry configuration
MAX_RETRIES = 3
BASE_DELAY = 1  # seconds
MAX_DELAY = 8  # seconds
P = ParamSpec("P")
R = TypeVar("R")
JSONValue = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


class RateLimiter:
    """Simple rate limiter for API requests using token bucket algorithm."""

    def __init__(self, max_requests: int = 100, per_period: int = 60) -> None:
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

    def __call__(self, func: Callable[P, R]) -> Callable[P, R]:
        """Decorator to rate limit a function."""

        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
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

    def __init__(
        self,
        base_url: str,
        vault_id: str,
        token: str,
        timeout: int = 15,
    ) -> None:
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
        payload: Mapping[str, JSONValue] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> dict[str, object]:
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
        headers = dict(headers or {})
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
                    json=dict(payload) if payload else None,
                    headers=headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()

                if response.status_code == 204:
                    return {}

                if response.status_code == 409:
                    response_json = response.json() if response.content else {}
                    raise Exception(
                        f"Vault conflict: {response_json.get('detail', 'Unknown error')}"
                    )

                response_body = response.json()
                if not isinstance(response_body, dict):
                    raise ValueError("Invalid response from server")
                response_data = {
                    key: value for key, value in response_body.items() if isinstance(key, str)
                }

                # Validate response has expected fields
                if (
                    "vault_id" not in response_data
                    or "blob" not in response_data
                    or "version" not in response_data
                ):
                    raise Exception("Invalid response from server")
                return response_data

            except requests.RequestException as e:
                if attempt < MAX_RETRIES:
                    delay = min(BASE_DELAY * (2 ** (attempt - 1)), MAX_DELAY)
                    time.sleep(delay)
                    print(f"Network retry {attempt}/{MAX_RETRIES} after {delay}s delay...")
                else:
                    self._raise_http_error(e)
                    raise e

            except Exception as e:
                self._raise_http_error(e)
                raise

        raise RuntimeError("Request retry loop ended unexpectedly")

    def _raise_http_error(self, error: Exception) -> None:
        response = getattr(error, "response", None)
        if not isinstance(response, requests.Response):
            return
        if response.status_code == 404:
            raise ValueError(f"Vault not found: {self.vault_id}") from error
        if response.status_code == 409:
            response_body = response.json()
            detail = response_body.get("detail", "") if isinstance(response_body, dict) else ""
            if not isinstance(detail, str):
                detail = str(detail)
            if "expected " in detail.lower():
                expected = detail.split("expected ", 1)[1].split(",", 1)[0]
                raise ValueError(f"Version conflict: expected {expected}") from error
            raise ValueError(f"Version conflict: {detail}") from error

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
        payload = {
            "vault_id": self.vault_id,
            "token": self.token,
            "blob": blob,
        }

        response = self._request("POST", "/v1/vaults", payload=payload)
        return self._to_remote_vault(response)

    def download(self) -> RemoteVault:
        """Download the current vault state from the server.

        Returns:
            RemoteVault with the latest vault data

        Raises:
            Exception: If vault not found (404) or other error
        """
        response = self._request("GET", self._get_vault_path())
        return self._to_remote_vault(response)

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
        payload: dict[str, JSONValue] = {"blob": blob}

        # Only include expected_version if provided (version conflict check)
        if expected_version is not None:
            payload["expected_version"] = expected_version

        response = self._request("PUT", url, payload=payload)
        return self._to_remote_vault(response)

    @staticmethod
    def _to_remote_vault(response: Mapping[str, object]) -> RemoteVault:
        vault_id = response.get("vault_id")
        blob = response.get("blob")
        version = response.get("version")
        updated_at = response.get("updated_at")
        if (
            not isinstance(vault_id, str)
            or not isinstance(blob, str)
            or not isinstance(version, int)
            or isinstance(version, bool)
            or not isinstance(updated_at, str)
        ):
            raise ValueError("Invalid response from server")
        return RemoteVault(vault_id, blob, version, updated_at)

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

    def register_user(self, username: str, password: str) -> dict[str, object]:
        """Register a new user account on the server.

        Args:
            username: Desired username
            password: Password to encrypt the vault with

        Returns:
            dict with user_id, username, email, and access_token

        Raises:
            Exception: If registration fails
        """
        payload = {
            "username": username,
            "password": password,
            "email": "",
        }

        response = self._request("POST", "/v1/auth/register", payload=payload)
        return response

    def login_user(self, username: str, password: str) -> dict[str, object]:
        """Login with username and password.

        Args:
            username: Registered username
            password: Password

        Returns:
            dict with user_id, username, email, and access_token

        Raises:
            Exception: If login fails (invalid credentials)
        """
        payload = {
            "username": username,
            "password": password,
        }

        response = self._request("POST", "/v1/auth/login", payload=payload)
        return response

    def get_user_info(self) -> dict[str, object]:
        """Get current authenticated user info.

        Returns:
            dict with user_id, username, and email

        Raises:
            Exception: If not authenticated (401)
        """
        response = self._request("GET", "/v1/auth/me")
        return response
