#!/usr/bin/env python3
"""Test script for secure API server."""

import sys
import time
import threading
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.server_config import (
    HOST, PORT, SERVER_CERT_PATH, SERVER_KEY_PATH,
    JWT_SECRET, HMAC_SECRET
)
from src.server import SecureVaultServer
from src.auth import generate_jwt_token, verify_jwt_token, sign_request, verify_request_signature
from src.models import PasswordEntry

def test_auth_module():
    """Test authentication module."""
    print("Testing auth module...")
    
    # Generate test token
    token = generate_jwt_token("test_user", vault_unlocked=True)
    print(f"✓ Generated JWT token: {token[:50]}...")
    
    # Verify token
    payload = verify_jwt_token(token)
    assert payload is not None, "Token verification failed"
    assert payload["user_id"] == "test_user", "User ID mismatch"
    assert payload["vault_unlocked"] == True, "Vault unlocked flag mismatch"
    print("✓ JWT token verification passed")
    
    # Test expired token
    expired_token = generate_jwt_token("test_user", vault_unlocked=False)
    expired_payload = verify_jwt_token(expired_token)
    assert expired_payload is None, "Expired token should be rejected"
    print("✓ Expired token rejection passed")
    
    # Test HMAC signing
    sig, ts = sign_request({"data": "test"})
    assert sig and ts, "Signature generation failed"
    print("✓ HMAC signature generation passed")
    
    # Test HMAC verification
    assert verify_request_signature(sig, ts, {"data": "test"}), "HMAC verification failed"
    print("✓ HMAC signature verification passed")
    
    print("All auth tests passed!\n")


def test_server():
    """Test secure server."""
    print("Testing secure server...")
    
    # Create test vault
    test_entries = [
        PasswordEntry(site="Test Site", username="testuser", password="testpass123", notes="Test")
    ]
    
    # Save test vault
    from src.storage import save_vault
    save_vault(test_entries, "test_master_password")
    print("✓ Test vault created")
    
    # Create and start server
    server = SecureVaultServer("test_master_password")
    assert server.start(), "Failed to start server"
    
    # Wait briefly for server to be ready
    import time
    time.sleep(0.5)
    
    assert server.is_running(), "Server not running"
    print("✓ Server started")
    
    # Stop server
    server.stop()
    print("✓ Server stopped")
    
    print("All server tests passed!\n")


def test_certificates():
    """Test certificate generation."""
    print("Testing certificate generation...")
    
    # Check if certificates exist
    if SERVER_CERT_PATH.exists():
        print(f"✓ Server certificate exists: {SERVER_CERT_PATH}")
    else:
        print("⚠ Server certificate not found (will be generated on first run)")
    
    if SERVER_KEY_PATH.exists():
        print(f"✓ Server key exists: {SERVER_KEY_PATH}")
    else:
        print("⚠ Server key not found (will be generated on first run)")
    
    # Generate if needed
    if not SERVER_CERT_PATH.exists() or not SERVER_KEY_PATH.exists():
        import subprocess
        print("Generating certificates...")
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:4096",
            "-keyout", str(SERVER_KEY_PATH),
            "-out", str(SERVER_CERT_PATH),
            "-days", "365",
            "-nodes",
            "-subj", "/CN=localhost/O=Caixa Forta/C=US"
        ], check=True)
        print("✓ Certificates generated")
    
    print("Certificate tests passed!\n")


def main():
    """Run all tests."""
    print("=" * 60)
    print("Caixa Forta Secure API Tests")
    print("=" * 60)
    print()
    
    try:
        test_certificates()
        test_auth_module()
        test_server()
        
        print("=" * 60)
        print("✅ All tests passed!")
        print("=" * 60)
        return 0
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
