#!/usr/bin/env python3
"""Control only ao-build. No compiler invocation; no forced shutdown."""
import fcntl
import os
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import sys
import time

STATE = Path(os.environ.get("AO_VM_STATE", "~/Projects/ao-reference/runtime/ao-vm")).expanduser().resolve()
BUNDLE = STATE / "ao-build.utm"
CTL = "/Applications/UTM.app/Contents/MacOS/utmctl"
# Ariel approved a 12 decimal GB floor on 2026-11-20. Pause with headroom.
PAUSE_AT = 14_000_000_000


def ctl(*args, timeout=20):
    return subprocess.run([CTL, *args, "ao-build"], check=True, text=True,
                          capture_output=True, timeout=timeout).stdout.strip()


def validate():
    with (BUNDLE / "config.plist").open("rb") as stream:
        config = plistlib.load(stream)
    assert config["Information"]["Name"] == "ao-build"
    assert config["System"]["MemorySize"] == 4096
    assert config["System"]["Architecture"] == "aarch64"
    assert (BUNDLE / "Data/windows.img").stat().st_size == 40_000_000_000
    expected = {(2222, 22), (7667, 7667)}
    actual = set()
    for network in config["Network"]:
        assert network["Mode"] == "Emulated"
        for forward in network["PortForward"]:
            assert forward["HostAddress"] == "127.0.0.1"
            assert forward["Protocol"] == "TCP"
            actual.add((forward["HostPort"], forward["GuestPort"]))
    assert actual == expected


def guard():
    # flock makes duplicate launches harmless and is released on process exit.
    with (STATE / "guard.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        started = time.monotonic()
        while True:
            free = shutil.disk_usage(STATE).free
            if free < PAUSE_AT:
                # No --save-state: writing 4 GiB of RAM would consume the reserve.
                ctl("suspend", timeout=5)
                print(f"Paused ao-build at {free / 1024**3:.2f} GiB free. "
                      "Free space before running vm-up.sh again.", flush=True)
                return
            if time.monotonic() - started > 30:
                status = ctl("status")
                if status in ("stopped", "paused"):
                    return
            time.sleep(1)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("up", "down", "guard", "status"):
        raise SystemExit("Usage: host.py up|down|guard|status")
    action = sys.argv[1]
    if (STATE / 'qemu-backend.json').exists():
        os.execv(sys.executable, [sys.executable, str(Path(__file__).with_name('qemu-host.py')), action])
    if action == "guard":
        guard()
        return
    validate()
    free = shutil.disk_usage(STATE).free
    if action == "status":
        print(f"{ctl('status')}; host free {free / 1024**3:.2f} GiB")
        return
    if action == "up":
        if free < PAUSE_AT:
            raise SystemExit(f"Refusing start: {free / 1024**3:.2f} GiB free; "
                             "14 GB required to protect the approved 12 GB reserve.")
        if not (BUNDLE / "Data/windows.iso").is_file() and not (STATE / "provisioned.json").is_file():
            raise SystemExit("Windows ARM64 media is missing. See docs/VM-BUILD-HANDOFF.md. "
                             "No VM was started.")
        status = ctl("status")  # Fails clearly if UTM has not imported the bundle.
        if status not in ("started", "paused", "stopped"):
            raise SystemExit(f"VM is {status}; wait for the transition to finish.")
        if status == "stopped":
            for port in (2222, 7667):
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", port))
        with (STATE / "disk-guard.log").open("a") as log:
            monitor = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "guard"],
                                       stdout=log, stderr=log, start_new_session=True)
        if status != "started":
            try:
                ctl("start", "--hide")
            except Exception:
                monitor.terminate()
                raise
        print(f"ao-build: {ctl('status')}; SSH 127.0.0.1:2222; AO TCP 127.0.0.1:7667. "
              f"Host free {free / 1024**3:.2f} GiB. Disk guard pauses below 14 GB (12 GB floor).")
    else:
        status = ctl("status")
        if status == "stopped":
            print("ao-build is already stopped.")
            return
        if status == "paused":
            raise SystemExit("VM is paused. Free space and resume it before a graceful shutdown.")
        ctl("stop", "--request")
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if ctl("status") == "stopped":
                print("ao-build stopped cleanly.")
                return
            time.sleep(1)
        raise SystemExit("Windows has not shut down after 90 seconds; no forced stop was sent.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, AssertionError, subprocess.SubprocessError) as error:
        details = getattr(error, "stderr", None) or str(error)
        raise SystemExit(f"ao-build: {details or 'VM configuration does not match the resource limits'}")
