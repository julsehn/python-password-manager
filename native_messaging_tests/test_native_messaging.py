"""
native_messaging_tests/test_native_messaging.py

Phase 1 test suite for the Caixa Forta native messaging host.

Key invariants tested:
  - Host works with no extensions.json (registry removed).
  - extension_id / extension_hash fields in message body are ignored.
  - request_id is echoed back in the response.
  - Wrong Chrome origin in argv[1] causes host to exit without answering.
  - No stale unapproved entries are ever written to disk.
  - Basic ping / generatePassword / unknown action still work.
"""

import json
import os
import select
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

import pytest

HOST_SCRIPT = (
    Path(__file__).resolve().parents[1] / "browser-extension" / "native" / "caixa_forta_native.py"
)
MESSAGE_TIMEOUT_SECONDS = 5


# ── Helpers ───────────────────────────────────────────────────────────────────


def send_message(process: subprocess.Popen, message: dict) -> None:
    encoded = json.dumps(message, separators=(",", ":")).encode("utf-8")
    process.stdin.write(struct.pack("@I", len(encoded)) + encoded)
    process.stdin.flush()


def read_exact(process: subprocess.Popen, byte_count: int) -> bytes:
    deadline = time.monotonic() + MESSAGE_TIMEOUT_SECONDS
    data = bytearray()
    descriptor = process.stdout.fileno()
    while len(data) < byte_count:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([descriptor], [], [], remaining)[0]:
            raise TimeoutError(f"Timed out waiting for native host response ({len(data)}/{byte_count} bytes)")
        chunk = os.read(descriptor, byte_count - len(data))
        if not chunk:
            raise EOFError("Native host closed stdout before completing response")
        data.extend(chunk)
    return bytes(data)


def read_response(process: subprocess.Popen) -> dict:
    length = struct.unpack("@I", read_exact(process, 4))[0]
    return json.loads(read_exact(process, length).decode("utf-8"))


def _terminate(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=MESSAGE_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def host_dir(tmp_path):
    """A temporary directory containing a copy of the host script (no registry file)."""
    d = tmp_path / "native"
    d.mkdir()
    shutil.copy2(HOST_SCRIPT, d / "caixa_forta_native.py")
    return d


@pytest.fixture
def host_process(host_dir, monkeypatch):
    """Host started as the browser would, with no registry file."""
    monkeypatch.setenv("HOME", str(host_dir.parent))
    proc = subprocess.Popen(
        [sys.executable, str(host_dir / "caixa_forta_native.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    try:
        yield proc
    finally:
        _terminate(proc)


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestBasicProtocol:
    """Phase 1: host works without a registry file."""

    def test_ping(self, host_process):
        """ping returns {success: true, pong: true}."""
        send_message(host_process, {"action": "ping"})
        r = read_response(host_process)
        assert r["success"] is True
        assert r["pong"] is True

    def test_request_id_echoed(self, host_process):
        """request_id present in request is echoed in the response."""
        send_message(host_process, {"action": "ping", "request_id": 42})
        r = read_response(host_process)
        assert r["success"] is True
        assert r.get("request_id") == 42, f"Expected request_id=42, got: {r}"

    def test_generate_password(self, host_process):
        """generatePassword (local fallback) produces a password of the requested length."""
        send_message(
            host_process,
            {"action": "generatePassword", "options": {"length": 24}, "request_id": 1},
        )
        r = read_response(host_process)
        assert r["success"] is True
        assert len(r["password"]) == 24
        assert r.get("request_id") == 1

    def test_unknown_action(self, host_process):
        """Unknown action returns a structured error."""
        send_message(host_process, {"action": "unknown_action", "request_id": 99})
        r = read_response(host_process)
        assert r["success"] is False
        assert "Unknown action: unknown_action" in r["error"]
        assert r.get("request_id") == 99

    def test_multiple_requests_sequential(self, host_process):
        """Multiple sequential requests all succeed and echo their own request_id."""
        for i in range(1, 4):
            send_message(host_process, {"action": "ping", "request_id": i})
            r = read_response(host_process)
            assert r["success"] is True
            assert r.get("request_id") == i, f"Request {i}: got request_id={r.get('request_id')}"


class TestRegistryRemoved:
    """Phase 1: the extensions.json registry mechanism is gone."""

    def test_no_registry_file_created(self, host_dir, monkeypatch):
        """Host must NOT create an extensions.json or similar registry file."""
        monkeypatch.setenv("HOME", str(host_dir.parent))
        proc = subprocess.Popen(
            [sys.executable, str(host_dir / "caixa_forta_native.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        try:
            send_message(proc, {"action": "ping"})
            read_response(proc)
        finally:
            _terminate(proc)

        # No registry file should have been written anywhere in host_dir
        registry_files = list(host_dir.rglob("extensions.json"))
        assert not registry_files, (
            f"Host created extensions.json files: {registry_files}. "
            "This would leave stale unapproved entries."
        )

    def test_extension_id_field_ignored(self, host_process):
        """
        extension_id and extension_hash in the message body are ignored.
        A forged extension_id must not change the outcome.
        """
        send_message(
            host_process,
            {
                "action": "ping",
                "extension_id": "completely_forged_evil_id",
                "extension_hash": "deadbeef",
            },
        )
        r = read_response(host_process)
        # The host should still respond normally (body fields are untrusted and ignored)
        assert r["success"] is True
        assert r["pong"] is True


class TestArgvOriginValidation:
    """Phase 1: host exits if an unexpected Chrome extension origin is in argv[1]."""

    def test_wrong_chrome_origin_exits(self, host_dir, monkeypatch):
        """
        If argv[1] looks like a Chrome extension origin but doesn't match the
        allowed ID, the host must exit without answering any messages.
        """
        monkeypatch.setenv("HOME", str(host_dir.parent))
        wrong_origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
        proc = subprocess.Popen(
            [sys.executable, str(host_dir / "caixa_forta_native.py"), wrong_origin],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        try:
            # The host may send one error message then exit, or just exit.
            # Either way it must not answer a ping successfully.
            deadline = time.monotonic() + 3
            # Try to read stdout; host should exit quickly.
            fd = proc.stdout.fileno()
            ready, _, _ = select.select([fd], [], [], 3)
            if ready:
                # Something was written – read it; it must be an error response, not pong.
                try:
                    raw_len = b""
                    while len(raw_len) < 4:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            break
                        r2, _, _ = select.select([fd], [], [], remaining)
                        if not r2:
                            break
                        chunk = os.read(fd, 4 - len(raw_len))
                        if not chunk:
                            break
                        raw_len += chunk
                    if len(raw_len) == 4:
                        length = struct.unpack("@I", raw_len)[0]
                        body = b""
                        while len(body) < length:
                            remaining = deadline - time.monotonic()
                            if remaining <= 0:
                                break
                            r2, _, _ = select.select([fd], [], [], remaining)
                            if not r2:
                                break
                            chunk = os.read(fd, length - len(body))
                            if not chunk:
                                break
                            body += chunk
                        if body:
                            msg = json.loads(body.decode("utf-8"))
                            assert msg.get("success") is not True, (
                                "Host accepted wrong-origin request and returned success=true"
                            )
                except (OSError, json.JSONDecodeError):
                    pass  # Host exited before we could read – that's fine too

            # Host must have exited or be exiting.
            proc.stdin.close()
            exit_code = proc.wait(timeout=3)
            assert exit_code != 0, (
                f"Host exited 0 after receiving wrong Chrome origin – should exit non-zero"
            )
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()

    def test_correct_chrome_origin_accepted(self, host_dir, monkeypatch):
        """Host with the correct allowed Chrome origin runs normally."""
        monkeypatch.setenv("HOME", str(host_dir.parent))
        allowed_origin = "chrome-extension://lcbgmkafanopplcefoapdfmhhjfoaamd/"
        proc = subprocess.Popen(
            [sys.executable, str(host_dir / "caixa_forta_native.py"), allowed_origin],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        try:
            send_message(proc, {"action": "ping"})
            r = read_response(proc)
            assert r["success"] is True
            assert r["pong"] is True
        finally:
            _terminate(proc)

    def test_no_argv_accepted(self, host_dir, monkeypatch):
        """Host with no origin argv (Firefox / direct) runs normally."""
        monkeypatch.setenv("HOME", str(host_dir.parent))
        proc = subprocess.Popen(
            [sys.executable, str(host_dir / "caixa_forta_native.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        try:
            send_message(proc, {"action": "ping"})
            r = read_response(proc)
            assert r["success"] is True
        finally:
            _terminate(proc)


class TestExtensionIdCheck:
    """Confirm the Chrome extension ID in manifest.chrome.json matches the host allowlist."""

    def test_chrome_manifest_has_key(self):
        """manifest.chrome.json must have a 'key' so the Chrome ID is stable."""
        manifest_path = (
            Path(__file__).resolve().parents[1]
            / "browser-extension"
            / "manifest.chrome.json"
        )
        data = json.loads(manifest_path.read_text())
        assert "key" in data, (
            "manifest.chrome.json is missing the 'key' field. "
            "Without it, the unpacked extension gets a path-derived ID that "
            "won't match the allowed_origins in the host manifest."
        )

    def test_chrome_manifest_key_matches_root(self):
        """manifest.chrome.json key must match the key in the root manifest.json."""
        root = (
            Path(__file__).resolve().parents[1]
            / "browser-extension"
            / "manifest.json"
        )
        chrome = (
            Path(__file__).resolve().parents[1]
            / "browser-extension"
            / "manifest.chrome.json"
        )
        root_data = json.loads(root.read_text())
        chrome_data = json.loads(chrome.read_text())
        assert root_data.get("key") == chrome_data.get("key"), (
            "Root manifest.json and manifest.chrome.json have different keys. "
            "They must be identical so both load the same extension ID."
        )

    def test_firefox_manifest_has_gecko_id(self):
        """manifest.firefox.json must contain a stable gecko ID."""
        ff_manifest = (
            Path(__file__).resolve().parents[1]
            / "browser-extension"
            / "manifest.firefox.json"
        )
        data = json.loads(ff_manifest.read_text())
        gecko_id = (
            data.get("browser_specific_settings", {}).get("gecko", {}).get("id", "")
        )
        assert gecko_id == "caixa-forta@juls.com", (
            f"Firefox gecko ID is '{gecko_id}', expected 'caixa-forta@juls.com'. "
            "This must match allowed_extensions in the host manifest."
        )
