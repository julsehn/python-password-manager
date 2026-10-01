#!/usr/bin/env python3
"""Compute extension hash and update registry."""

import sys
import os
import json
import hashlib

def compute_hash(file_path):
    """Compute SHA-256 hash of a file."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hasher.update(chunk)
    return hasher.hexdigest()

def update_registry(extension_id, hash_value):
    """Update extension hash in registry."""
    registry_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extensions.json")
    try:
        with open(registry_path, "r") as f:
            registry = json.load(f)
        registry["extensions"][extension_id]["hash"] = hash_value
        registry["extensions"][extension_id]["approved"] = True
        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)
        print(f"Updated registry for extension {extension_id}")
        print(f"Hash: {hash_value}")
    except FileNotFoundError:
        print(f"Registry not found at {registry_path}")
    except Exception as e:
        print(f"Error updating registry: {e}")

def main():
    """Compute hash of extension manifest and update registry."""
    manifest_path = os.path.join(
        os.path.dirname(
            os.path.dirname(
                os.path.abspath(__file__)
            )
        ),
        "manifest.json"
    )
    if not os.path.exists(manifest_path):
        print(f"Manifest not found at {manifest_path}")
        return
    hash_value = compute_hash(manifest_path)
    print(f"Computed hash: {hash_value}")
    update_registry("caixa_forta_manager", hash_value)

if __name__ == "__main__":
    main()