from src.password_manager import PasswordManager
from src.storage import save_vault, load_vault, VAULT_FILENAME

pm = PasswordManager()
pm.add_entry("example.com", "alice", "s3cr3t", "compte de prova")
master = "test_master_password"

# Save
save_vault(pm.get_entries(), master, VAULT_FILENAME)
print("Guardat a:", VAULT_FILENAME)

# Load to verify
entries = load_vault(master, VAULT_FILENAME)
print("Loaded entries:", [e.to_dict() for e in entries])
