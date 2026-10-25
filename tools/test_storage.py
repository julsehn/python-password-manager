from src import storage
from src.password_manager import PasswordManager


def test_vault_storage_round_trip(tmp_path, monkeypatch):
    vault_path = tmp_path / "vault.json"
    lockout_path = tmp_path / "lockout_state.json"
    monkeypatch.setattr(storage, "LOCKOUT_STATE_FILENAME", str(lockout_path))

    manager = PasswordManager()
    manager.add_entry("example.com", "alice", "test-entry-password", "smoke test")
    storage.save_vault(manager.get_entries(), "test-master-password-123", str(vault_path))

    loaded_entries = storage.load_vault("test-master-password-123", str(vault_path))

    assert len(loaded_entries) == 1
    assert loaded_entries[0].site == "https://example.com"
    assert loaded_entries[0].username == "alice"
    assert loaded_entries[0].password == "test-entry-password"
    assert not lockout_path.exists()
