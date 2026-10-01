# Extension Permission System

Caixa Forta uses a hash-based extension permission system to control access to the vault. Extensions must be explicitly approved and their identity is verified using cryptographic hashes.

## How It Works

1. When an extension connects to the native messaging host, it identifies itself with an `extension_id` and a computed hash of its manifest file
2. The host checks the extension registry for approval status
3. Approved extensions are verified using their stored hash
4. Unknown extensions are recorded for review and approval
5. Only approved extensions with matching hashes can access the vault

## Managing Permissions

The extension registry is managed through the CLI tool:

```bash
# List all registered extensions
python3 extension_manager.py list

# Approve an extension
python3 extension_manager.py approve <extension_id>

# Deny an extension
python3 extension_manager.py deny <extension_id>

# Show pending approvals
python3 extension_manager.py pending
```

## Extension Hashing

The extension computes a SHA-256 hash of its manifest.json file and includes it with every request. This hash is verified against the stored hash in the registry to ensure the extension hasn't been modified.

To compute and store the hash for an extension:

```bash
python3 hash_extension.py
```

## Extension Registry Format

Extensions are stored in `extensions.json`:

```json
{
  "extensions": {
    "extension_id": {
      "name": "Extension Name",
      "permissions": ["action1", "action2"],
      "approved": true,
      "hash": "sha256_hash_value",
      "last_active": "timestamp"
    }
  }
}
```

## Permission Actions

- `get_vault_info` - Get vault status
- `unlock_vault` - Unlock the vault
- `lock_vault` - Lock the vault
- `fetch_credentials` - Retrieve credentials
- `save_credentials` - Save credentials
- `generate_password` - Generate passwords

## Security Notes

- Unknown extensions are not automatically approved
- Built-in extensions use hash verification
- Permission decisions are logged for auditing
- Registry file is stored in the native messaging host directory
- Hash verification prevents modified extensions from being approved
- The hash must match exactly for approval