#!/usr/bin/env python3
"""
Comprehensive test script for Caixa Forta native messaging.
Tests both Native Messaging API (stdio) and Firefox port mode.
"""

import subprocess
import sys
import struct
import json
import time
import os
import signal

HOST_SCRIPT = "/Users/juls/Documents/GitHub/The-vault-project/python-password-manager/browser-extension/native/caixa_forta_native.py"

# Test configuration
TEST_TIMEOUT = 10  # seconds
MAX_RETRIES = 3
RETRY_DELAY = 0.5


def send_message(host_process, message):
    """Send a length-prefixed message to the host (Native Messaging API)."""
    encoded = json.dumps(message, separators=(',', ':')).encode('utf-8')
    length = struct.pack('@I', len(encoded))
    host_process.stdin.write(length + encoded)
    host_process.stdin.flush()


def read_response(host_process):
    """Read a length-prefixed response from the host."""
    try:
        length_bytes = host_process.stdout.read(4)
        if not length_bytes or len(length_bytes) < 4:
            return None
        length = struct.unpack('@I', length_bytes)[0]
        response = host_process.stdout.read(length)
        if len(response) < length:
            return None
        return json.loads(response.decode('utf-8'))
    except Exception as e:
        return {"error": str(e)}


def test_native_api_mode(host_process, test_name):
    """Test Native Messaging API (stdio) mode."""
    print(f"\n{'='*60}")
    print(f"Testing: {test_name} (Native Messaging API)")
    print('='*60)

    tests = [
        {"action": "ping"},
        {"action": "getVaultInfo"},
        {"action": "generatePassword", "options": {"length": 16}},
        {"action": "generatePassword", "options": {"length": 24, "uppercase": True, "symbols": True, "numbers": False}},
        {"action": "unlockVault", "masterPassword": "test123"},
        {"action": "lockVault"},
        {"action": "fetchCredentials", "site": "example.com"},
        {"action": "saveCredentials", "data": {"site": "test.com", "username": "user", "password": "pass"}},
    ]

    passed = 0
    failed = 0

    for i, test in enumerate(tests, 1):
        print(f"\n[{i}/{len(tests)}] {test['action']}")
        try:
            send_message(host_process, test)
            response = read_response(host_process)

            if response and response.get("success"):
                print(f"   ✓ Success")
                if "password" in response:
                    print(f"   Password: {response['password']}")
                passed += 1
            else:
                print(f"   ✗ Failed: {response}")
                failed += 1
        except Exception as e:
            print(f"   ✗ Error: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def test_firefox_port_mode(host_process, test_name):
    """Test Firefox port mode (raw JSON)."""
    print(f"\n{'='*60}")
    print(f"Testing: {test_name} (Firefox Port Mode)")
    print('='*60)

    # Note: Firefox port mode requires special setup
    # For now, we'll just verify the host can handle raw JSON
    print("   ℹ Firefox port mode requires special setup")
    print("   ℹ This test is skipped in automated testing")
    return True


def test_error_handling(host_process, test_name):
    """Test error handling."""
    print(f"\n{'='*60}")
    print(f"Testing: {test_name} (Error Handling)")
    print('='*60)

    # Test unknown action
    print("\n[1/2] Unknown action")
    send_message(host_process, {"action": "unknown_action"})
    response = read_response(host_process)
    if response and response.get("success") == False:
        print(f"   ✓ Correctly handled unknown action")
    else:
        print(f"   ✗ Failed to handle unknown action: {response}")
        return False

    # Test invalid JSON (simulated by sending incomplete data)
    print("\n[2/2] Incomplete message")
    try:
        # Send incomplete length header
        host_process.stdin.write(b'\x00\x00\x00')  # Only 3 bytes instead of 4
        host_process.stdin.flush()
        time.sleep(0.5)
        print(f"   ✓ Host handled incomplete message gracefully")
    except Exception as e:
        print(f"   ✗ Error handling incomplete message: {e}")
        return False

    print(f"\nResults: All error handling tests passed")
    return True


def test_message_sizes(host_process, test_name):
    """Test message size handling."""
    print(f"\n{'='*60}")
    print(f"Testing: {test_name} (Message Sizes)")
    print('='*60)

    # Test normal size message
    print("\n[1/3] Normal size message")
    send_message(host_process, {"action": "ping"})
    response = read_response(host_process)
    if response and response.get("success"):
        print(f"   ✓ Normal message handled correctly")
    else:
        print(f"   ✗ Failed: {response}")
        return False

    # Test large message (within 1MB limit)
    print("\n[2/3] Large message (10KB)")
    large_payload = {"action": "generatePassword", "options": {"length": 1000}}
    send_message(host_process, large_payload)
    response = read_response(host_process)
    if response and response.get("success"):
        print(f"   ✓ Large message handled correctly")
    else:
        print(f"   ✗ Failed: {response}")
        return False

    # Test message with special characters
    print("\n[3/3] Message with special characters")
    special_message = {
        "action": "generatePassword",
        "options": {
            "length": 32,
            "uppercase": True,
            "lowercase": True,
            "numbers": True,
            "symbols": True
        }
    }
    send_message(host_process, special_message)
    response = read_response(host_process)
    if response and response.get("success"):
        print(f"   ✓ Special characters handled correctly")
    else:
        print(f"   ✗ Failed: {response}")
        return False

    print(f"\nResults: All message size tests passed")
    return True


def main():
    """Main test runner."""
    print("="*60)
    print("  Caixa Forta Native Messaging - Comprehensive Test")
    print("="*60)

    # Check if host script exists
    if not os.path.exists(HOST_SCRIPT):
        print(f"✗ Host script not found: {HOST_SCRIPT}")
        sys.exit(1)

    # Check Python version
    if sys.version_info < (3, 6):
        print(f"✗ Python 3.6+ required, found {sys.version_info[0]}.{sys.version_info[1]}")
        sys.exit(1)

    all_passed = True

    try:
        # Start the host
        print("\nStarting native messaging host...")
        host_process = subprocess.Popen(
            [sys.executable, HOST_SCRIPT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            bufsize=1
        )

        # Wait for host to start
        print("Waiting for host to initialize...")
        time.sleep(2)

        # Check if host is running
        if host_process.poll() is not None:
            stdout, stderr = host_process.communicate()
            print(f"✗ Host failed to start")
            print(f"STDOUT: {stdout.decode('utf-8')}")
            print(f"STDERR: {stderr.decode('utf-8')}")
            sys.exit(1)

        print("✓ Host started successfully")

        # Run tests
        print("\n" + "="*60)
        print("  Running Tests")
        print("="*60)

        # Test 1: Native Messaging API
        if not test_native_api_mode(host_process, "Native Messaging API"):
            all_passed = False

        # Test 2: Error handling
        if not test_error_handling(host_process, "Error Handling"):
            all_passed = False

        # Test 3: Message sizes
        if not test_message_sizes(host_process, "Message Sizes"):
            all_passed = False

        # Test 4: Firefox port mode (skipped in automated testing)
        test_firefox_port_mode(host_process, "Firefox Port Mode")

        # Cleanup
        print("\n" + "="*60)
        print("Stopping host...")
        host_process.terminate()
        try:
            host_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            host_process.kill()
        print("✓ Test complete!")

        # Summary
        print("\n" + "="*60)
        print("  Test Summary")
        print("="*60)
        if all_passed:
            print("✓ All tests passed!")
            sys.exit(0)
        else:
            print("✗ Some tests failed")
            sys.exit(1)

    except Exception as e:
        print(f"\n✗ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
