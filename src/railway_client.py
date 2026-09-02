"""Client for the Railway service that stores client-encrypted vault blobs."""

import json
import secrets
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


class RailwayVaultError(Exception):
    """Raised when the Railway vault service rejects an operation."""


class VaultConflictError(RailwayVaultError):
    """Raised when a newer server revision exists."""


@dataclass(frozen=True)
class RemoteVault:
    vault_id: str
    blob: str
    version: int
    updated_at: str


def create_vault_credentials() -> tuple[str, str]:
    """Create credentials suitable for registering a new remote vault."""
    return secrets.token_urlsafe(24), secrets.token_urlsafe(48)


class RailwayVaultClient:
    def __init__(self, base_url: str, vault_id: str, token: str, timeout: int = 15):
        parsed = urlparse(base_url.rstrip("/"))
        if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Railway vault service must use HTTPS")
        if not vault_id or not token:
            raise ValueError("vault_id and token are required")
        self.base_url = base_url.rstrip("/")
        self.vault_id = vault_id
        self.token = token
        self.timeout = timeout

    def register(self, blob: str = "") -> RemoteVault:
        response = self._request(
            "POST",
            "/v1/vaults",
            {"vault_id": self.vault_id, "token": self.token, "blob": blob},
            authenticated=False,
        )
        return self._remote_vault(response)

    def download(self) -> RemoteVault:
        return self._remote_vault(self._request("GET", self._vault_path()))

    def upload(self, blob: str, expected_version: int | None = None) -> RemoteVault:
        payload = {"blob": blob}
        if expected_version is not None:
            payload["expected_version"] = expected_version
        try:
            response = self._request("PUT", self._vault_path(), payload)
        except RailwayVaultError as error:
            if str(error) == "Vault has changed on the server":
                raise VaultConflictError(str(error)) from error
            raise
        return self._remote_vault(response)

    def delete(self) -> None:
        self._request("DELETE", self._vault_path())

    def _vault_path(self) -> str:
        return f"/v1/vaults/{quote(self.vault_id, safe='')}"

    def _request(self, method: str, path: str, payload: dict | None = None, authenticated: bool = True) -> dict:
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = f"Bearer {self.token}"
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        request = Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                if response.status == 204:
                    return {}
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8")).get("detail", "Request failed")
            except (ValueError, OSError):
                detail = "Request failed"
            raise RailwayVaultError(str(detail)) from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise RailwayVaultError("Could not reach Railway vault service") from error

    @staticmethod
    def _remote_vault(response: dict) -> RemoteVault:
        return RemoteVault(
            vault_id=response["vault_id"],
            blob=response["blob"],
            version=response["version"],
            updated_at=response["updated_at"],
        )
