#!/usr/bin/env python3
"""Generate certificates for browser extension mTLS."""

import subprocess
from pathlib import Path
from .server_config import CERT_DIR, CLIENT_CERT_PATH, CLIENT_KEY_PATH

def generate_extension_certs():
    """Generate client certificates for browser extension."""
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    
    print("Generating browser extension client certificates...")
    
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:4096",
        "-keyout", str(CLIENT_KEY_PATH),
        "-out", str(CLIENT_CERT_PATH),
        "-days", "365",
        "-nodes",
        "-subj", "/CN=extension/CN=Browser Extension/O=Caixa Forta"
    ], check=True)
    
    print(f"Client certificate created at: {CLIENT_CERT_PATH}")
    print(f"Client key created at: {CLIENT_KEY_PATH}")
    
    # Copy to browser-extension build directory
    build_dir = Path(__file__).resolve().parent.parent / "browser-extension" / "certs"
    build_dir.mkdir(parents=True, exist_ok=True)
    
    subprocess.run([
        "cp", str(CLIENT_CERT_PATH), str(build_dir / "client.crt")
    ], check=True)
    
    subprocess.run([
        "cp", str(CLIENT_KEY_PATH), str(build_dir / "client.key")
    ], check=True)
    
    print(f"Copied to: {build_dir}")

if __name__ == "__main__":
    generate_extension_certs()
