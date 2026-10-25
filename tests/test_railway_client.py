from unittest.mock import Mock

import requests

from src import railway_client
from src.railway_client import RailwayVaultClient


def response(status_code=200, payload=None):
    result = Mock()
    result.status_code = status_code
    result.content = b"" if status_code == 204 else b"{}"
    result.json.return_value = payload or {}
    result.raise_for_status.return_value = None
    return result


def test_register_uses_relative_api_path(monkeypatch):
    http_response = response(
        payload={
            "vault_id": "vault-1",
            "blob": "encrypted",
            "version": 1,
            "updated_at": "2026-10-24T00:00:00Z",
        }
    )
    request = Mock(return_value=http_response)
    monkeypatch.setattr(railway_client.requests, "request", request)
    client = RailwayVaultClient("https://vault.test/", "vault-1", "token")

    remote = client.register("encrypted")

    assert remote.vault_id == "vault-1"
    assert request.call_args.args[:2] == ("POST", "https://vault.test/v1/vaults")


def test_delete_accepts_no_content_response(monkeypatch):
    request = Mock(return_value=response(status_code=204))
    monkeypatch.setattr(railway_client.requests, "request", request)
    client = RailwayVaultClient("https://vault.test", "vault-1", "token")

    client.delete()

    assert request.call_args.args[:2] == (
        "DELETE",
        "https://vault.test/v1/vaults/vault-1",
    )


def test_request_retries_with_bounded_delay(monkeypatch):
    request = Mock(
        side_effect=[
            requests.ConnectionError("offline"),
            requests.ConnectionError("offline"),
            response(
                payload={
                    "vault_id": "vault-1",
                    "blob": "encrypted",
                    "version": 1,
                    "updated_at": "2026-10-24T00:00:00Z",
                }
            ),
        ]
    )
    sleep = Mock()
    monkeypatch.setattr(railway_client.requests, "request", request)
    monkeypatch.setattr(railway_client.time, "sleep", sleep)
    client = RailwayVaultClient("https://vault.test", "vault-1", "token")

    assert client.download().version == 1
    assert request.call_count == 3
    assert [call.args[0] for call in sleep.call_args_list] == [1, 2]
