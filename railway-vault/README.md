# Railway encrypted vault service

This service stores opaque, client-encrypted vault blobs. It never receives a master password and has no decryption key.

## Deploy

1. Create a Railway service from this directory using the included `Dockerfile`.
2. Attach a Railway Volume mounted at `/data`; without it, SQLite data is ephemeral on redeploy.
3. Set `MAX_BLOB_BYTES` if a different vault size limit is required.
4. Restrict the service to HTTPS and keep the returned vault token only in the desktop client.

## API

Generate a random vault ID and at least 32 random token bytes on the client. Register once:

```http
POST /v1/vaults
Content-Type: application/json

{"vault_id":"...","token":"...","blob":"<encrypted envelope>"}
```

Read and write with `Authorization: Bearer <token>`:

```http
GET /v1/vaults/{vault_id}
PUT /v1/vaults/{vault_id}
Content-Type: application/json

{"blob":"<encrypted envelope>","expected_version":1}
```

A `409` response means another client uploaded a newer version. Do not overwrite it automatically; download, decrypt locally, merge, and upload with the returned version.

`DELETE /v1/vaults/{vault_id}` permanently deletes the stored blob after token authentication.

The server treats `blob` as opaque text. The client must encrypt and authenticate the complete vault before upload, and must not put passwords, tokens, or plaintext entries in URLs or logs.

The Python application client is available as `src.railway_client.RailwayVaultClient`:

```python
from src.railway_client import RailwayVaultClient, create_vault_credentials

vault_id, token = create_vault_credentials()
client = RailwayVaultClient("https://your-service.up.railway.app", vault_id, token)
client.register(encrypted_vault_json)
remote = client.download()
client.upload(new_encrypted_vault_json, expected_version=remote.version)
```

Keep `vault_id` and `token` in the local application configuration. They are the only credentials that authorize access to the remote blob.
