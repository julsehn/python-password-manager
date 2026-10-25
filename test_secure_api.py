#!/usr/bin/env python3
"""Test script for secure API server."""

import ssl
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest

from src import auth as auth_module
from src import server as server_module


def test_auth_module_uses_isolated_secrets(tmp_path, monkeypatch):
    jwt_secret = tmp_path / "jwt_secret.bin"
    hmac_secret = tmp_path / "hmac_secret.bin"
    jwt_secret.write_bytes(b"j" * 32)
    hmac_secret.write_bytes(b"h" * 32)
    monkeypatch.setattr(auth_module, "JWT_SECRET", jwt_secret)
    monkeypatch.setattr(auth_module, "HMAC_SECRET", hmac_secret)

    token = auth_module.generate_jwt_token("test_user", vault_unlocked=True)
    payload = auth_module.verify_jwt_token(token)
    signature, timestamp = auth_module.sign_request({"data": "test"})

    assert payload is not None
    assert payload["user_id"] == "test_user"
    assert payload["vault_unlocked"] is True
    assert auth_module.verify_request_signature(signature, timestamp, {"data": "test"})


def test_auth_rejects_locked_vault_token(tmp_path, monkeypatch):
    jwt_secret = tmp_path / "jwt_secret.bin"
    jwt_secret.write_bytes(b"j" * 32)
    monkeypatch.setattr(auth_module, "JWT_SECRET", jwt_secret)

    token = auth_module.generate_jwt_token("test_user", vault_unlocked=False)

    assert auth_module.verify_jwt_token(token) is None


def test_server_lifecycle_uses_ephemeral_port(monkeypatch):
    monkeypatch.setattr(server_module, "PORT", 0)
    monkeypatch.setattr(server_module, "ensure_certificates_exist", lambda: None)
    monkeypatch.setattr(
        server_module.SecureVaultServer,
        "_create_ssl_context",
        Mock(return_value=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)),
    )
    api_server = server_module.SecureVaultServer("test-only-password")

    try:
        assert api_server.start()
        assert api_server.is_running()
    finally:
        api_server.stop()


def test_client_certificate_check_uses_tls_peer():
    connection = SimpleNamespace(getpeercert=lambda: {"subject": ()})
    handler = cast(
        server_module.SecureAPIHandler,
        SimpleNamespace(connection=connection),
    )

    assert server_module.SecureAPIHandler._verify_client_certificate(handler)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
