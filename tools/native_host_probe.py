#!/usr/bin/env python3
"""
native_host_probe.py – Scripted native-messaging client for Caixa Forta.

Spawns the native host the way a browser would (length-prefixed JSON on stdio)
and sends a sequence of test messages.  Used for Phase 0 baseline and ongoing
regression testing.

Usage:
    python3 tools/native_host_probe.py [--host /path/to/caixa_forta_native.py]

Exit codes:
    0  All probed actions got a response (success/failure is reported, not fatal).
    1  Timeout or protocol error.
"""

import json
import os
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST_SCRIPT = ROOT / "browser-extension" / "native" / "caixa_forta_native.py"
PYTHON = sys.executable
TIMEOUT = 6  # seconds per response

CHROME_EXTENSION_ID = "lcbgmkafanopplcefoapdfmhhjfoaamd"
FIREFOX_EXTENSION_ID = "caixa-forta@juls.com"


def send_msg(proc, obj: dict) -> None:
    payload = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    proc.stdin.write(struct.pack("@I", len(payload)) + payload)
    proc.stdin.flush()


def recv_msg(proc) -> dict:
    def read_exact(n: int) -> bytes:
        data = bytearray()
        deadline = time.monotonic() + TIMEOUT
        fd = proc.stdout.fileno()
        while len(data) < n:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"Timed out reading {n} bytes (got {len(data)})")
            ready, _, _ = select.select([fd], [], [], remaining)
            if not ready:
                raise TimeoutError(f"Timed out reading {n} bytes (got {len(data)})")
            chunk = os.read(fd, n - len(data))
            if not chunk:
                raise EOFError("Host closed stdout")
            data.extend(chunk)
        return bytes(data)

    length = struct.unpack("@I", read_exact(4))[0]
    return json.loads(read_exact(length).decode("utf-8"))


def probe(host_script: Path, argv_origin: str, setup_registry: bool) -> bool:
    """
    Spawn the host and run a sequence of probe messages.

    :param host_script:     Path to caixa_forta_native.py in the install dir.
    :param argv_origin:     What the browser passes as argv[1] (origin string).
    :param setup_registry:  If True, copy an approved extensions.json next to the host.
    :returns: True if all probes completed without protocol errors.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        script = tmp_dir / "caixa_forta_native.py"
        shutil.copy2(host_script, script)

        if setup_registry:
            (tmp_dir / "extensions.json").write_text(
                json.dumps(
                    {
                        "extensions": {
                            "caixa_forta_manager": {
                                "name": "Test",
                                "permissions": [],
                                "approved": True,
                                "hash": None,
                                "last_active": None,
                            }
                        }
                    }
                )
            )

        cmd = [PYTHON, str(script)]
        if argv_origin:
            cmd.append(argv_origin)

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
            env={**os.environ, "HOME": tmp},
        )

        ok = True
        try:
            # ── Probe 1: ping ─────────────────────────────────────────────
            print("\n[probe] action=ping")
            send_msg(proc, {"action": "ping", "extension_id": "caixa_forta_manager"})
            r = recv_msg(proc)
            print(f"       response: {r}")
            if r.get("pong"):
                print("       ✅ ping OK")
            elif "Extension permission denied" in r.get("error", ""):
                print("       ❌ CONFIRMS F2: permission denied (no registry or not approved)")
                ok = False
            else:
                print(f"       ⚠️  unexpected: {r}")

            # ── Probe 2: getVaultInfo ─────────────────────────────────────
            print("\n[probe] action=getVaultInfo")
            send_msg(proc, {"action": "getVaultInfo", "extension_id": "caixa_forta_manager"})
            r = recv_msg(proc)
            print(f"       response: {r}")
            if r.get("connected") or r.get("success"):
                print("       ✅ getVaultInfo reached the app (or graceful app-unavailable)")
            elif "Extension permission denied" in r.get("error", ""):
                print("       ❌ CONFIRMS F2: permission denied")
                ok = False
            else:
                print(f"       ℹ️  {r.get('error','no error field')}")

            # ── Probe 3: fetchCredentials ─────────────────────────────────
            print("\n[probe] action=fetchCredentials")
            send_msg(
                proc,
                {"action": "fetchCredentials", "extension_id": "caixa_forta_manager", "site": "example.com"},
            )
            r = recv_msg(proc)
            print(f"       response: {r}")

            # ── Probe 4: forged extension_id (F3 / bypass check) ─────────
            print("\n[probe] F3 check – forged extension_id, no hash")
            send_msg(proc, {"action": "ping", "extension_id": "evil_forged_id"})
            r = recv_msg(proc)
            print(f"       response: {r}")
            if r.get("pong"):
                print("       ❌ CONFIRMS F3: forged ID was accepted (hash bypass)")
            elif "denied" in r.get("error", "").lower():
                print("       ✅ forged ID rejected")
            else:
                print(f"       ⚠️  {r}")

        except TimeoutError as exc:
            print(f"\n[probe] ❌ TIMEOUT: {exc}")
            ok = False
        except EOFError as exc:
            print(f"\n[probe] ❌ EOF: {exc}")
            ok = False
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            stderr = proc.stderr.read().decode("utf-8", errors="replace")
            if stderr.strip():
                print(f"\n[host stderr]\n{stderr.strip()}")

    return ok


def check_extension_id_mismatch() -> None:
    """F1: compare the ID derived from the key in manifest.json vs chrome manifest."""
    print("\n── F1: Extension ID Mismatch Check ─────────────────────────────")
    chrome_manifest = ROOT / "browser-extension" / "manifest.chrome.json"
    root_manifest = ROOT / "browser-extension" / "manifest.json"

    with open(root_manifest) as f:
        root_data = json.load(f)
    with open(chrome_manifest) as f:
        chrome_data = json.load(f)

    root_key = root_data.get("key")
    chrome_key = chrome_data.get("key")

    if root_key:
        print(f"  root manifest.json has key: {root_key[:40]}…")
    else:
        print("  root manifest.json has NO key")

    if chrome_key:
        print(f"  manifest.chrome.json has key: {chrome_key[:40]}…")
        if chrome_key == root_key:
            print("  ✅ Keys match – Chrome ID will be stable (lcbgmkafanopplcefoapdfmhhjfoaamd)")
        else:
            print("  ❌ Keys DIFFER – different Chrome extension ID!")
    else:
        print("  ❌ CONFIRMS F1: manifest.chrome.json has NO key → unpacked extension")
        print("     gets a path-derived ID that differs from the registered allowed_origin.")


def check_f7_handshake() -> None:
    """F7: describe curl command for unauthenticated handshake (cannot run without network)."""
    print("\n── F7: Unauthenticated /handshake ───────────────────────────────")
    print("  To confirm F7, run against a live app:")
    print("  curl -s http://127.0.0.1:8080/api/v1/handshake")
    print("  Expected (vulnerable): returns shared_secret + token with no auth.")
    print("  Safe: returns 401 or 403.")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Caixa Forta native host probe")
    parser.add_argument("--host", type=Path, default=HOST_SCRIPT, help="Path to caixa_forta_native.py")
    args = parser.parse_args()

    host = args.host.resolve()
    if not host.exists():
        print(f"ERROR: host script not found: {host}", file=sys.stderr)
        sys.exit(1)

    print("═" * 60)
    print("Caixa Forta Native Host Probe – Phase 0 Baseline")
    print("═" * 60)

    # F1 static check (no network needed)
    check_extension_id_mismatch()

    # F7 guidance
    check_f7_handshake()

    # ── Scenario A: No registry file (confirms F2) ────────────────────────
    print("\n── Scenario A: Host started with NO registry file (F2) ──────────")
    result_a = probe(host, argv_origin="", setup_registry=False)

    # ── Scenario B: Approved registry, forged id (confirms F3) ───────────
    print("\n── Scenario B: Approved registry present, forged ID (F3) ────────")
    result_b = probe(host, argv_origin="", setup_registry=True)

    print("\n" + "═" * 60)
    if result_a and result_b:
        print("Probe completed without protocol errors.")
    else:
        print("Probe found issues (see ❌ above).")
    print("═" * 60)


if __name__ == "__main__":
    main()

