#!/usr/bin/env python3
"""
Caixa Forta - Secure Native Messaging Host
Cross-platform, stdio (length-prefixed) native messaging protocol.

Security model (Phase 1):
  - The browser enforces the allowed origin via the native host manifest
    (allowed_origins for Chrome, allowed_extensions for Firefox).
  - This host performs a defence-in-depth check on argv[1] (Chrome passes
    "chrome-extension://<id>/" there; Firefox passes the extension ID as
    argv[2] in some versions, but the manifest-level check is the primary
    trust boundary).
  - The self-reported extension_id / extension_hash fields in the message
    body are IGNORED entirely; they cannot be trusted.
  - No extensions.json registry is read or written.
"""

import sys
import os
import json
import struct
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, NoReturn, Optional

# ── Allowed launcher origin ───────────────────────────────────────────────────
# Chrome passes the extension origin as argv[1].
# Firefox passes the host-manifest path as argv[1]; the extension ID may appear
# in argv[2] in some versions. The primary trust boundary is the browser
# manifest; this check is defence-in-depth only.
ALLOWED_CHROME_ORIGIN = "chrome-extension://lcbgmkafanopplcefoapdfmhhjfoaamd/"
ALLOWED_FIREFOX_ID = "caixa-forta@juls.com"

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_MESSAGE_SIZE = 1024 * 1024  # 1 MB
VAULT_DIR: str = os.path.expanduser("~/.password_manager")
VAULT_PATH: str = os.path.join(VAULT_DIR, "vault.json")
APP_API_BASE = "http://127.0.0.1:8080/api/v1"
APP_TOKEN: Optional[str] = None

DEBUG_MODE: bool = "--debug" in sys.argv or "-d" in sys.argv

logging.basicConfig(
    level=logging.DEBUG if DEBUG_MODE else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger: logging.Logger = logging.getLogger("caixa_forta_native")


# ── Origin check (defence-in-depth) ──────────────────────────────────────────

def _validate_argv_origin() -> None:
    """
    Warn if the caller origin doesn't match the expected Chrome origin.
    This is defence-in-depth only; the browser-level manifest is the real
    trust boundary. We do NOT exit here because:
      - Firefox argv layout differs across versions.
      - The installed host manifest already filters by extension ID/origin.
    """
    if len(sys.argv) < 2:
        return  # launched directly or by Firefox (no origin in argv[1])
    caller = sys.argv[1]
    # Chrome passes "chrome-extension://<id>/"; skip the check for
    # anything that looks like a file path (Firefox manifest path).
    if caller.startswith("chrome-extension://") and caller != ALLOWED_CHROME_ORIGIN:
        logger.error(
            "Unexpected Chrome extension origin '%s'; expected '%s'. Exiting.",
            caller,
            ALLOWED_CHROME_ORIGIN,
        )
        # Send a structured error before exiting so the extension sees it.
        try:
            _send_and_exit({"success": False, "error": "Origin not allowed"})
        except OSError:
            pass
        sys.exit(1)


def _send_and_exit(msg: Dict[str, Any]) -> NoReturn:
    send_message(msg)
    sys.exit(1)


# ── Wire protocol ─────────────────────────────────────────────────────────────

def write_native(data: bytes) -> None:
    """Write all native-messaging bytes to stdout without text buffering."""
    offset = 0
    stdout_fd = sys.stdout.fileno()
    while offset < len(data):
        written: int = os.write(stdout_fd, data[offset:])
        if written <= 0:
            raise OSError("Native messaging stdout closed")
        offset += written


def read_message_native() -> Optional[Dict[str, Any]]:
    """
    Read one length-prefixed JSON message from stdin.
    Returns None on EOF or a malformed message.
    """
    try:
        raw_length = bytearray()
        while len(raw_length) < 4:
            chunk: bytes = os.read(sys.stdin.fileno(), 4 - len(raw_length))
            if not chunk:
                if raw_length:
                    logger.warning("Incomplete length header: %d bytes", len(raw_length))
                else:
                    logger.debug("Native messaging stdin closed (clean EOF)")
                return None
            raw_length.extend(chunk)

        message_length: int = struct.unpack("@I", raw_length)[0]
        if message_length > MAX_MESSAGE_SIZE:
            logger.error("Message size %d exceeds limit %d", message_length, MAX_MESSAGE_SIZE)
            return None

        message_data = bytearray()
        while len(message_data) < message_length:
            chunk = os.read(sys.stdin.fileno(), message_length - len(message_data))
            if not chunk:
                logger.warning(
                    "Incomplete payload: expected %d bytes, got %d",
                    message_length,
                    len(message_data),
                )
                return None
            message_data.extend(chunk)

        try:
            message = json.loads(bytes(message_data).decode("utf-8"))
            if not isinstance(message, dict):
                logger.error("Message must be a JSON object")
                return None
            return message
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            logger.error("Invalid message encoding: %s", exc)
            return None

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Error reading message: %s", exc)
        return None


def send_message(message: Dict[str, Any]) -> None:
    """Send one length-prefixed JSON message to stdout."""
    try:
        encoded: bytes = json.dumps(
            message, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        write_native(struct.pack("@I", len(encoded)) + encoded)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Error sending message: %s", exc)
        try:
            error_msg: bytes = json.dumps(
                {"success": False, "error": f"Host send error: {exc}"}, separators=(",", ":")
            ).encode("utf-8")
            write_native(struct.pack("@I", len(error_msg)) + error_msg)
        except OSError:
            pass


# ── App communication ─────────────────────────────────────────────────────────

def app_request(
    method: str,
    endpoint: str,
    payload: Optional[Dict[str, Any]] = None,
    query: Optional[Dict[str, str]] = None,
    timeout: int = 5,
) -> Dict[str, Any]:
    """Call the desktop app's loopback API and return its JSON response."""
    url: str = f"{APP_API_BASE}{endpoint}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    body = None
    headers: Dict[str, str] = {
        "Accept": "application/json",
        "Origin": "http://127.0.0.1:8080",
    }
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
    authenticated = app_request("POST", "/auth", {"shared_secret": shared_secret})
    if authenticated.get("success") and authenticated.get("token"):
        APP_TOKEN = authenticated["token"]
        return True
    return False


def generate_password(options: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a cryptographically secure random password (local fallback)."""
    try:
        length = options.get("length", 16)
        if not (8 <= length <= 128):
            length = 16

        chars: str = ""
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

        password: str = "".join(secrets.choice(chars) for _ in range(length))
        return {"success": True, "password": password, "length": length}
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Password generation error: %s", exc)
        return {"success": False, "error": str(exc)}


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    global APP_TOKEN

    _validate_argv_origin()

    logger.info("Caixa Forta Native Messaging Host started")

    if sys.version_info < (3, 6):
        logger.error("Python 3.6+ required")
        sys.exit(1)

    import signal

    def signal_handler(signum, frame) -> NoReturn:  # type: ignore[type-arg]
        logger.info("Received signal %d, shutting down gracefully", signum)
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    logger.info("Running in Native Messaging API mode (stdio)")

    while True:
        try:
            message = read_message_native()
            if message is None:
                break  # EOF – host must exit so the browser can restart it

            action = message.get("action", "")
            # NOTE: extension_id and extension_hash from the message body are
            # untrusted (self-reported by caller). They are intentionally ignored.
            # The browser manifest is the sole identity gate.
            request_id = message.get("request_id")  # echo back for ID-based matching
            logger.info("Received action: %s", action)

            try:
                if action == "ping":
                    response: Dict[str, Any] = {"success": True, "pong": True}

                elif action == "getVaultInfo":
                    response = get_vault_info()

                elif action == "generatePassword":
                    response = app_request(
                        "POST", "/generate-password", message.get("options", {})
                    )
                    if not response.get("success"):
                        response = generate_password(message.get("options", {}))

                elif action == "fetchCredentials":
                    if not APP_TOKEN:
                        ensure_app_token()
                    response = app_request(
                        "GET",
                        "/credentials",
                        query={"domain": message.get("site", "")},
                        timeout=8,
                    )
                    response["site"] = message.get("site", "")
                    if not response.get("success") and "Authentication required" in response.get(
                        "error", ""
                    ):
                        logger.info("Token expired, refreshing…")
                        if ensure_app_token():
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
                    response = app_request(
                        "POST", "/credentials", message.get("data", {}), timeout=10
                    )
                    if not response.get("success") and (
                        "Authentication required" in response.get("error", "")
                        or "Desktop app unavailable" in response.get("error", "")
                    ):
                        logger.info("Token expired or app unavailable, refreshing…")
                        if ensure_app_token():
                            response = app_request(
                                "POST", "/credentials", message.get("data", {}), timeout=10
                            )

                elif action == "lockVault":
                    # Phase 2 will remove this; for now relay to app
                    response = app_request("POST", "/lock")
                    if response.get("success"):
                        APP_TOKEN = None

                else:
                    response = {"success": False, "error": f"Unknown action: {action}"}

            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Error processing action %s: %s", action, exc)
                response = {"success": False, "error": f"Processing error: {exc}"}

            if request_id is not None:
                response["request_id"] = request_id

            logger.info("Sending response for action=%s success=%s", action, response.get("success"))
            send_message(response)

        except KeyboardInterrupt:
            logger.info("Host interrupted by user")
            break
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Critical host error: %s", exc)
            try:
                send_message({"success": False, "error": f"Host error: {exc}"})
            except OSError:
                pass

    logger.info("Native messaging host stopped")


if __name__ == "__main__":
    main()
