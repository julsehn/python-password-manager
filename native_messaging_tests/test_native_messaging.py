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
    Path(__file__).resolve().parents[1]
    / "browser-extension"
    / "native"
    / "caixa_forta_native.py"
)
TEST_EXTENSION_ID = "caixa_forta_manager"
MESSAGE_TIMEOUT_SECONDS = 5


@pytest.fixture
def host_process(tmp_path, monkeypatch):
    host_dir = tmp_path / "native"
    host_dir.mkdir()
    host_script = host_dir / "caixa_forta_native.py"
    shutil.copy2(HOST_SCRIPT, host_script)
    (host_dir / "extensions.json").write_text(
        json.dumps(
            {
                "extensions": {
                    TEST_EXTENSION_ID: {
                        "name": "Test extension",
                        "permissions": [],
                        "approved": True,
                        "hash": None,
                        "last_active": None,
                    }
                },
                "next_check": None,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOME", str(tmp_path))

    process = subprocess.Popen(
        [sys.executable, str(host_script)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    try:
        yield process
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=MESSAGE_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=MESSAGE_TIMEOUT_SECONDS)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def send_message(process, message):
    encoded = json.dumps(message, separators=(",", ":")).encode("utf-8")
    process.stdin.write(struct.pack("@I", len(encoded)) + encoded)
    process.stdin.flush()


def read_exact(process, byte_count):
    deadline = time.monotonic() + MESSAGE_TIMEOUT_SECONDS
    data = bytearray()
    descriptor = process.stdout.fileno()

    while len(data) < byte_count:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([descriptor], [], [], remaining)[0]:
            raise TimeoutError("Timed out waiting for native host response")
        chunk = os.read(descriptor, byte_count - len(data))
        if not chunk:
            raise EOFError("Native host closed stdout before completing response")
        data.extend(chunk)

    return bytes(data)


def read_response(process):
    length = struct.unpack("@I", read_exact(process, 4))[0]
    return json.loads(read_exact(process, length).decode("utf-8"))


def test_native_host_ping_and_unknown_action(host_process):
    send_message(
        host_process,
        {"action": "ping", "extension_id": TEST_EXTENSION_ID},
    )
    ping_response = read_response(host_process)
    assert ping_response == {"success": True, "pong": True}

    send_message(
        host_process,
        {
            "action": "generatePassword",
            "extension_id": TEST_EXTENSION_ID,
            "options": {"length": 24},
        },
    )
    password_response = read_response(host_process)
    assert password_response["success"] is True
    assert len(password_response["password"]) == 24

    send_message(
        host_process,
        {"action": "unknown_action", "extension_id": TEST_EXTENSION_ID},
    )
    error_response = read_response(host_process)
    assert error_response["success"] is False
    assert error_response["error"] == "Unknown action: unknown_action"