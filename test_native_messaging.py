#!/usr/bin/env python3
"""
Quick test script for Caixa Forta native messaging connection.
Run this to verify the host is working correctly.
"""

import subprocess
import sys
import struct
import json
import time
import os

HOST_SCRIPT = "/Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py"

def send_message(host_process, message):
    """Send a length-prefixed message to the host."""
    encoded = json.dumps(message, separators=(',', ':')).encode('utf-8')
    length = struct.pack('@I', len(encoded))
    host_process.stdin.write(length + encoded)
    host_process.stdin.flush()

def read_response(host_process):
    """Read a length-prefixed response from the host."""
    try:
        length_bytes = host_process.stdout.read(4)
        if not length_bytes:
            return None
        length = struct.unpack('@I', length_bytes)[0]
        response = host_process.stdout.read(length)
        return json.loads(response.decode('utf-8'))
    except Exception as e:
        return {"error": str(e)}

def test_host(host_process):
    """Test the native messaging host with various actions."""
    tests = [
        {"action": "ping"},
        {"action": "getVaultInfo"},
        {"action": "generatePassword", "options": {"length": 16}},
        {"action": "generatePassword", "options": {"length": 24, "uppercase": True, "symbols": True}},
    ]
    
    print("\n🧪 Testing Native Messaging Host")
    print("=" * 60)
    
    for i, test in enumerate(tests, 1):
        print(f"\n[{i}/{len(tests)}] Testing: {test['action']}")
        send_message(host_process, test)
        response = read_response(host_process)
        
        if response and response.get("success"):
            print(f"   ✓ Success")
            if "password" in response:
                print(f"   Password: {response['password']}")
            elif "entryCount" in response:
                print(f"   Entry count: {response['entryCount']}")
            elif "pong" in response:
                print(f"   Pong: {response['pong']}")
        else:
            print(f"   ✗ Failed: {response}")

def main():
    print("🚀 Caixa Forta Native Messaging Test")
    print("=" * 60)
    
    # Check if host script exists
    if not os.path.exists(HOST_SCRIPT):
        print(f"✗ Host script not found: {HOST_SCRIPT}")
        sys.exit(1)
    
    # Start the host
    print("Starting native messaging host...")
    host_process = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False
    )
    
    time.sleep(1)  # Give it time to start
    
    # Check if it started successfully by sending a ping
    print("Verifying host is running...")
    send_message(host_process, {"action": "ping"})
    response = read_response(host_process)
    
    if response and response.get("success"):
        print("✓ Host started successfully")
    else:
        print(f"✗ Host failed to start: {response}")
        host_process.terminate()
        sys.exit(1)
    
    # Run tests
    test_host(host_process)
    
    # Cleanup
    print("\n" + "=" * 60)
    print("Stopping host...")
    host_process.terminate()
    host_process.wait()
    print("✓ Test complete!")

if __name__ == "__main__":
    main()
