import hashlib
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
USER = "admin"
vaults = {}

@app.get("/healthz")
def health():
    return {"status": "ok"}

@app.post("/v1/vaults", response_model=BaseModel)
def create(vault_id: str, data: str = "", ver: int = 1):
    if vault_id in vaults:
        raise HTTPException(409, "exists")
    vaults[vault_id] = {"data": data, "ver": 1, "user": USER}
    return {"id": vault_id, "ver": ver}

@app.get("/v1/vaults/{id}", response_model=BaseModel)
def get(id: str, ver: int):
    v = vaults.get(id)
    if not v or v["user"] != USER:
        raise HTTPException(401, "auth")
    if v["ver"] != ver:
        raise HTTPException(409, "version")
    return {"id": id, "data": v["data"], "ver": ver}

@app.put("/v1/vaults/{id}", response_model=BaseModel)
def update(id: str, data: str, ver: int):
    v = vaults.get(id)
    if not v or v["user"] != USER:
        raise HTTPException(401, "auth")
    if v["ver"] != ver:
        raise HTTPException(409, "version")
    v["data"] = data
    v["ver"] = ver
    return {"ver": ver}

@app.delete("/v1/vaults/{id}")
def delete(id: str, ver: int):
    v = vaults.get(id)
    if not v or v["user"] != USER:
        raise HTTPException(401, "auth")
    if v["ver"] != ver:
        raise HTTPException(409, "version")
    del vaults[id]
    return {"deleted": True}
