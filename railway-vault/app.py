import hashlib
import hmac
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Path as ApiPath, status
from pydantic import BaseModel, Field

app = FastAPI(title="Caixa Forta Vault Service", version="1.0.0")

DB_PATH = Path(os.environ.get("VAULT_DB_PATH", "/data/vaults.db"))
MAX_BLOB_BYTES = int(os.environ.get("MAX_BLOB_BYTES", str(10 * 1024 * 1024)))
VAULT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


class VaultRegistration(BaseModel):
    vault_id: str = Field(min_length=16, max_length=128)
    token: str = Field(min_length=32, max_length=256)
    blob: str = Field(default="", max_length=MAX_BLOB_BYTES)


class VaultBlob(BaseModel):
    blob: str = Field(max_length=MAX_BLOB_BYTES)
    expected_version: int | None = Field(default=None, ge=0)


class VaultResponse(BaseModel):
    vault_id: str
    blob: str
    version: int
    updated_at: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def database() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS vaults (
            vault_id TEXT PRIMARY KEY,
            token_digest TEXT NOT NULL,
            blob TEXT NOT NULL,
            version INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.commit()
    return connection


def validate_vault_id(vault_id: str) -> str:
    if not VAULT_ID_PATTERN.fullmatch(vault_id):
        raise HTTPException(status_code=400, detail="Invalid vault id")
    return vault_id


def require_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization[7:].strip()
    if len(token) < 32 or len(token) > 256:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")
    return token


def get_vault(vault_id: str, token: str) -> sqlite3.Row:
    with closing(database()) as connection:
        row = connection.execute(
            "SELECT * FROM vaults WHERE vault_id = ?",
            (vault_id,),
        ).fetchone()
    if row is None or not hmac.compare_digest(row["token_digest"], token_digest(token)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vault not found")
    return row


def check_blob_size(blob: str) -> None:
    if len(blob.encode("utf-8")) > MAX_BLOB_BYTES:
        raise HTTPException(status_code=413, detail="Encrypted vault is too large")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    with closing(database()) as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "ok"}


@app.post("/v1/vaults", response_model=VaultResponse, status_code=status.HTTP_201_CREATED)
def register_vault(payload: VaultRegistration) -> VaultResponse:
    validate_vault_id(payload.vault_id)
    check_blob_size(payload.blob)
    now = utc_now()
    try:
        with closing(database()) as connection:
            connection.execute(
                "INSERT INTO vaults(vault_id, token_digest, blob, version, updated_at) VALUES (?, ?, ?, 1, ?)",
                (payload.vault_id, token_digest(payload.token), payload.blob, now),
            )
            connection.commit()
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="Vault already exists") from error
    return VaultResponse(vault_id=payload.vault_id, blob=payload.blob, version=1, updated_at=now)


@app.get("/v1/vaults/{vault_id}", response_model=VaultResponse)
def download_vault(
    vault_id: str = ApiPath(...),
    token: str = Depends(require_token),
) -> VaultResponse:
    row = get_vault(validate_vault_id(vault_id), token)
    return VaultResponse(
        vault_id=row["vault_id"],
        blob=row["blob"],
        version=row["version"],
        updated_at=row["updated_at"],
    )


@app.put("/v1/vaults/{vault_id}", response_model=VaultResponse)
def upload_vault(
    payload: VaultBlob,
    vault_id: str = ApiPath(...),
    token: str = Depends(require_token),
) -> VaultResponse:
    vault_id = validate_vault_id(vault_id)
    check_blob_size(payload.blob)
    current = get_vault(vault_id, token)
    if payload.expected_version is not None and payload.expected_version != current["version"]:
        raise HTTPException(status_code=409, detail="Vault has changed on the server")

    now = utc_now()
    with closing(database()) as connection:
        connection.execute(
            "UPDATE vaults SET blob = ?, version = version + 1, updated_at = ? WHERE vault_id = ?",
            (payload.blob, now, vault_id),
        )
        connection.commit()
    return VaultResponse(
        vault_id=vault_id,
        blob=payload.blob,
        version=current["version"] + 1,
        updated_at=now,
    )


@app.delete("/v1/vaults/{vault_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vault(
    vault_id: str = ApiPath(...),
    token: str = Depends(require_token),
) -> None:
    vault_id = validate_vault_id(vault_id)
    get_vault(vault_id, token)
    with closing(database()) as connection:
        connection.execute("DELETE FROM vaults WHERE vault_id = ?", (vault_id,))
        connection.commit()
