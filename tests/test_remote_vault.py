from src import remote_vault
from src.remote_vault import RemoteVaultStore


def test_client_uses_vault_token_separately_from_vault_id(monkeypatch):
    config = {
        "railway_url": "https://vault.example.test/",
        "railway_vault_id": "vault-id",
        "railway_token": "vault-token",
    }
    monkeypatch.setattr(remote_vault, "load_config", lambda: config)

    client = RemoteVaultStore(config)._client()

    assert client.base_url == "https://vault.example.test"
    assert client.vault_id == "vault-id"
    assert client.token == "vault-token"
