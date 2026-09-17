#!/usr/bin/env python3
"""
Caixa Forta - Secure Native Messaging Host
Cross-platform, zero-trust security implementation

Supports both:
 1. Native Messaging API (stdio with length-prefixed messages)
"""

import sys
import os
import json
import struct
import logging
import secrets
import select
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple

# Security constants
MAX_MESSAGE_SIZE = 1024 * 1024  # 1 MB limit
MAX_READ_BUFFER = 65536  # 64KB buffer for Firefox port mode
VAULT_DIR = os.path.expanduser("~/.password_manager")
VAULT_PATH = os.path.join(VAULT_DIR, "vault.json")
APP_API_BASE = "http://127.0.0.1:8080/api/v1"
APP_TOKEN: Optional[str] = None

DEBUG_MODE = "--debug" in sys.argv or "-d" in sys.argv

# Configure logging to stderr (visible in browser console)
if DEBUG_MODE:
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        stream=sys.stderr
    )
else:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        stream=sys.stderr
    )
logger = logging.getLogger("caixa_forta_native")


def write_native(data: bytes) -> None:
    """Write all native-messaging bytes to stdout without text buffering."""
    offset = 0
    stdout_fd = sys.stdout.fileno()
    while offset < len(data):
        written = os.write(stdout_fd, data[offset:])
        if written <= 0:
            raise OSError("Native messaging stdout closed")
        offset += written


def read_message_native() -> Optional[Dict[str, Any]]:
    """
    Read length-prefixed JSON message from stdin (Native Messaging API).
    Accumulates pipe fragments before parsing and validates the message size.
    """
    try:
        raw_length = bytearray()
        while len(raw_length) < 4:
            chunk = os.read(sys.stdin.fileno(), 4 - len(raw_length))
            if not chunk:
                if raw_length:
                    logger.warning(
                        "Incomplete length header received: %s bytes",
                        len(raw_length),
                    )
                else:
                    logger.warning("Native messaging stdin closed")
                return None
            raw_length.extend(chunk)

        message_length = struct.unpack('@I', raw_length)[0]
        if message_length > MAX_MESSAGE_SIZE:
            logger.error(f"Message size {message_length} exceeds limit {MAX_MESSAGE_SIZE}")
            return None

        message_data = bytearray()
        while len(message_data) < message_length:
            chunk = os.read(
                sys.stdin.fileno(), message_length - len(message_data)
            )
            if not chunk:
                logger.warning(
                    "Incomplete message payload received: expected %s bytes, got %s",
                    message_length,
                    len(message_data),
                )
                return None
            message_data.extend(chunk)

        # Log the raw data for debugging (only for small messages)
        if message_length < 100:
            logger.debug(
                "Received message (length=%s): %s...",
                message_length,
                bytes(message_data[:50]),
            )

        # Safe JSON deserialization with strict validation
        try:
            message = json.loads(bytes(message_data).decode('utf-8'))
            if not isinstance(message, dict):
                logger.error("Message must be a JSON object")
                return None
            return message
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
            return None
        except UnicodeDecodeError as e:
            logger.error(f"Invalid UTF-8 encoding: {e}")
            return None

    except Exception as e:
        logger.error(f"Error reading message: {e}")
        return None


def read_message_firefox() -> Optional[Dict[str, Any]]:
    """
    Read raw JSON message from stdin (Firefox runtime.connectNative).
    Firefox sends raw JSON without length prefix over the port.
    """
    try:
        # Read available data non-blocking
        if sys.stdin.isatty():
            # For terminal input, read line by line
            line = sys.stdin.readline().strip()
            if not line:
                return None
        else:
            # For pipe/port input, read until we have complete JSON
            data = b""
            while True:
                chunk = sys.stdin.buffer.read(MAX_READ_BUFFER)
                if not chunk:
                    break
                data += chunk

                # Try to parse complete JSON
                try:
                    message = json.loads(data.decode('utf-8'))
                    if isinstance(message, dict):
                        return message
                    # If it's not a complete JSON object, keep reading
                    # Check if we have a complete JSON structure
                    if data.strip().endswith('}'):
                        # Try to find the complete object
                        depth = 0
                        in_string = False
                        escape_next = False
                        for i, char in enumerate(data.decode('utf-8')):
                            if escape_next:
                                escape_next = False
                                continue
                            if char == '\\' and in_string:
                                escape_next = True
                                continue
                            if char == '"':
                                in_string = not in_string
                            elif not in_string:
                                if char == '{':
                                    depth += 1
                                elif char == '}':
                                    depth -= 1
                                    if depth == 0:
                                        # Found complete object
                                        message = json.loads(data[:i+1].decode('utf-8'))
                                        if isinstance(message, dict):
                                            return message
                                        break
                except json.JSONDecodeError:
                    continue

            return None

        # Safe JSON deserialization
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                logger.error("Message must be a JSON object")
                return None
            return message
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
            return None
        except UnicodeDecodeError as e:
            logger.error(f"Invalid UTF-8 encoding: {e}")
            return None

    except Exception as e:
        logger.error(f"Error reading message: {e}")
        return None


def read_message_firefox_debug() -> Optional[Dict[str, Any]]:
    """
    Debug version of read_message_firefox that logs raw data received.
    Use this to diagnose protocol issues.
    """
    try:
        # Read available data non-blocking
        if sys.stdin.isatty():
            # For terminal input, read line by line
            line = sys.stdin.readline().strip()
            if not line:
                return None
        else:
            # For pipe/port input, read until we have complete JSON
            data = b""
            while True:
                chunk = sys.stdin.buffer.read(MAX_READ_BUFFER)
                if not chunk:
                    break
                data += chunk

                # Log raw data for debugging
                if len(data) < 100:  # Only log small chunks
                    logger.debug(f"Raw data received ({len(data)} bytes): {data[:50]}...")

                # Try to parse complete JSON
                try:
                    message = json.loads(data.decode('utf-8'))
                    if isinstance(message, dict):
                        return message
                    # If it's not a complete JSON object, keep reading
                    # Check if we have a complete JSON structure
                    if data.strip().endswith('}'):
                        # Try to find the complete object
                        depth = 0
                        in_string = False
                        escape_next = False
                        for i, char in enumerate(data.decode('utf-8')):
                            if escape_next:
                                escape_next = False
                                continue
                            if char == '\\' and in_string:
                                escape_next = True
                                continue
                            if char == '"':
                                in_string = not in_string
                            elif not in_string:
                                if char == '{':
                                    depth += 1
                                elif char == '}':
                                    depth -= 1
                                    if depth == 0:
                                        # Found complete object
                                        message = json.loads(data[:i+1].decode('utf-8'))
                                        if isinstance(message, dict):
                                            return message
                                        break
                except json.JSONDecodeError:
                    continue

            return None

        # Safe JSON deserialization
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                logger.error("Message must be a JSON object")
                return None
            return message
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
            return None
        except UnicodeDecodeError as e:
            logger.error(f"Invalid UTF-8 encoding: {e}")
            return None

    except Exception as e:
        logger.error(f"Error reading message: {e}")
        return None


def send_message(message: Dict[str, Any]) -> None:
    """
    Send length-prefixed JSON message to stdout.
    Ensures proper flushing without corrupting the buffer.
    """
    try:
        encoded = json.dumps(message, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        length = len(encoded)

        # Write a native-endian 4-byte length header.
        write_native(struct.pack('@I', length) + encoded)

    except Exception as e:
        logger.error(f"Error sending message: {e}")
        # Send error response even if we can't flush
        try:
            error_msg = {"success": False, "error": f"Host send error: {str(e)}"}
            encoded = json.dumps(error_msg, separators=(',', ':')).encode('utf-8')
            write_native(struct.pack('@I', len(encoded)) + encoded)
        except:
            pass


def generate_password(options: Dict[str, Any]) -> Dict[str, Any]:
    """Generate cryptographically secure random password."""
    try:
        length = options.get("length", 16)
        if length < 8 or length > 128:
            length = 16
        
        chars = ""
        if options.get("uppercase", True):
            chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if options.get("lowercase", True):
            chars += "abcdefghijklmnopqrstuvwxyz"
        if options.get("numbers", True):
            chars += "0123456789"
        if options.get("symbols", True):
            chars += "!@#$%^&*()_+-=[]{}|;:,.<>?"
        
        if not chars:
            chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        
        password = ''.join(secrets.choice(chars) for _ in range(length))
        
        return {
            "success": True,
            "password": password,
            "length": length
        }
    except Exception as e:
        logger.error(f"Password generation error: {e}")
        return {"success": False, "error": str(e)}


def app_request(
    method: str,
    endpoint: str,
    payload: Optional[Dict[str, Any]] = None,
    query: Optional[Dict[str, str]] = None,
    timeout: int = 5,
) -> Dict[str, Any]:
    """Call the desktop app's loopback API and return its JSON response."""
    url = f"{APP_API_BASE}{endpoint}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    body = None
    headers = {"Accept": "application/json", "Origin": "http://127.0.0.1:8080"}
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if APP_TOKEN:
        headers["Authorization"] = f"Bearer {APP_TOKEN}"

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            details = json.loads(error.read().decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            details = {"error": f"Desktop app returned HTTP {error.code}"}
        return {"success": False, **details}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {"success": False, "error": f"Desktop app unavailable: {error}"}


def get_vault_info() -> Dict[str, Any]:
    """Read the live vault state from the desktop app."""
    response = app_request("GET", "/vault-info")
    response["entryCount"] = response.get("entry_count", 0)
    response["exists"] = os.path.exists(VAULT_PATH)
    response["source"] = "native"
    return response


def ensure_app_token() -> bool:
    """Authenticate the native bridge when the desktop app is already unlocked."""
    global APP_TOKEN
    if APP_TOKEN:
        return True
    handshake = app_request("GET", "/handshake")
    shared_secret = handshake.get("shared_secret")
    if not shared_secret:
        return False
    authenticated = app_request(
        "POST", "/auth", {"shared_secret": shared_secret}
    )
    if authenticated.get("success") and authenticated.get("token"):
        APP_TOKEN = authenticated["token"]
        return True
    return False


def main():
    """Main message loop - handles all native messaging actions."""
    global APP_TOKEN
    logger.info("Caixa Forta Native Messaging Host started")

    # Validate Python version
    if sys.version_info < (3, 6):
        logger.error("Python 3.6+ required")
        sys.exit(1)

    # Set up signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down gracefully")
        sys.exit(0)

    import signal
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    logger.info("Running in Native Messaging API mode (stdio)")

    while True:
        try:
            message = read_message_native()

            if message is None:
                # EOF or a rejected message must not leave an orphaned host loop.
                break

            action = message.get("action", "")
            logger.info(f"Received action: {action}")

            # Process action with strict validation
            try:
                if action == "getVaultInfo":
                    response = get_vault_info()
                elif action == "generatePassword":
                    response = app_request(
                        "POST", "/generate-password", message.get("options", {})
                    )
                    if not response.get("success"):
                        response = generate_password(message.get("options", {}))
                elif action == "ping":
                    response = {"success": True, "pong": True}
                elif action == "unlockVault":
                    response = app_request(
                        "POST",
                        "/unlock",
                        {"master_password": message.get("masterPassword", "")},
                    )
                    if response.get("success") and response.get("token"):
                        APP_TOKEN = response["token"]
                elif action == "lockVault":
                    response = app_request("POST", "/lock")
                    if response.get("success"):
                        APP_TOKEN = None
                elif action == "fetchCredentials":
                    if not APP_TOKEN:
                        ensure_app_token()
                    # Try to get credentials with token refresh on failure
                    response = app_request(
                        "GET",
                        "/credentials",
                        query={"domain": message.get("site", "")},
                        timeout=8,
                    )
                    response["site"] = message.get("site", "")
                    # If auth failed, try to refresh token
                    if not response.get("success") and "Authentication required" in response.get("error", ""):
                        logger.info("Token expired, refreshing...")
                        if ensure_app_token():
                            # Retry with new token
                            response = app_request(
                                "GET",
                                "/credentials",
                                query={"domain": message.get("site", "")},
                                timeout=8,
                            )
                            response["site"] = message.get("site", "")
                elif action == "saveCredentials":
                    if not APP_TOKEN:
                        ensure_app_token()
                    # Try to save with token refresh on failure
                    response = app_request(
                        "POST",
                        "/credentials",
                        message.get("data", {}),
                        timeout=10,
                    )
                    # If auth failed or timeout, try to refresh token and retry
                    if not response.get("success") and ("Authentication required" in response.get("error", "") or "Desktop app unavailable" in response.get("error", "")):
                        logger.info("Token expired or app unavailable, refreshing...")
                        if ensure_app_token():
                            # Retry with new token
                            response = app_request(
                                "POST",
                                "/credentials",
                                message.get("data", {}),
                                timeout=10,
                            )
                else:
                    response = {
                        "success": False,
                        "error": f"Unknown action: {action}"
                    }
            except Exception as e:
                logger.error(f"Error processing action {action}: {e}")
                response = {
                    "success": False,
                    "error": f"Processing error: {str(e)}"
                }

            logger.info(f"Sending response: {response.get('success', False)}")

            send_message(response)

        except KeyboardInterrupt:
            logger.info("Host interrupted by user")
            break
        except Exception as e:
            logger.error(f"Critical host error: {e}")
            try:
                send_message({"success": False, "error": f"Host error: {str(e)}"})
            except:
                pass
            # Don't exit on error, continue processing

    logger.info("Native messaging host stopped")


if __name__ == "__main__":
    main()
