import stat

from src import server_config


def test_ensure_secrets_exist_creates_private_stable_files(tmp_path, monkeypatch):
    jwt_secret = tmp_path / "nested" / "jwt_secret.bin"
    hmac_secret = tmp_path / "nested" / "hmac_secret.bin"
    monkeypatch.setattr(server_config, "JWT_SECRET", jwt_secret)
    monkeypatch.setattr(server_config, "HMAC_SECRET", hmac_secret)

    server_config.ensure_secrets_exist()
    jwt_value = jwt_secret.read_bytes()
    hmac_value = hmac_secret.read_bytes()

    assert len(jwt_value) == 32
    assert len(hmac_value) == 32
    assert stat.S_IMODE(jwt_secret.stat().st_mode) == 0o600
    assert stat.S_IMODE(hmac_secret.stat().st_mode) == 0o600

    server_config.ensure_secrets_exist()

    assert jwt_secret.read_bytes() == jwt_value
    assert hmac_secret.read_bytes() == hmac_value
