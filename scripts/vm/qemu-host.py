#!/usr/bin/env python3
"""Headless fallback for ao-build while UTM's macOS application cannot launch."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time

STATE = Path(os.environ.get('AO_VM_STATE', '~/Projects/ao-reference/runtime/ao-vm')).expanduser().resolve()
DATA = STATE / 'ao-build.utm/Data'
QMP = STATE / 'qmp.sock'
PAUSE_AT = 14_000_000_000  # 2 GB headroom above Ariel's 12 GB floor.


def qmp(command, arguments=None):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(2)
        sock.connect(str(QMP))
        stream = sock.makefile('rwb')
        json.loads(stream.readline())
        for request in [{'execute': 'qmp_capabilities'}, {'execute': command, 'arguments': arguments or {}}]:
            stream.write(json.dumps(request).encode() + b'\n')
            stream.flush()
            while True:
                response = json.loads(stream.readline())
                if 'error' in response:
                    raise RuntimeError(response['error'])
                if 'return' in response:
                    break
        return response['return']


def running_pid():
    path = STATE / 'qemu.pid'
    if not path.exists():
        return None
    pid = int(path.read_text())
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True, timeout=3)
    if 'qemu-system-aarch64' in result.stdout and '-name ao-build' in result.stdout:
        return pid
    return None


def status():
    return qmp('query-status')['status'] if running_pid() else 'stopped'


def guard():
    with (STATE / 'qemu-guard.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        minimum = shutil.disk_usage(STATE).free
        previous = STATE / 'disk-guard-status.json'
        if previous.exists():
            minimum = min(minimum, json.loads(previous.read_text())['minimum_free_bytes'])
        last_report = 0
        while pid := running_pid():
            free = shutil.disk_usage(STATE).free
            minimum = min(minimum, free)
            if free < PAUSE_AT:
                process_stopped = False
                try:
                    qmp('stop')
                except Exception:
                    # Stop CPU/writes without writing a 4 GiB saved-memory image.
                    if running_pid() == pid:
                        os.kill(pid, signal.SIGSTOP)
                        process_stopped = True
                (STATE / 'disk-safety-stop.json').write_text(json.dumps({'pid': pid, 'process_stopped': process_stopped, 'free_bytes': free, 'minimum_free_bytes': minimum, 'time': time.time()}) + '\n')
                print(f'Paused ao-build: host free {free} bytes; approved floor 12000000000.', flush=True)
                return
            if time.monotonic() - last_report > 30:
                (STATE / 'disk-guard-status.json').write_text(json.dumps({'free_bytes': free, 'minimum_free_bytes': minimum, 'time': time.time()}) + '\n')
                last_report = time.monotonic()
            time.sleep(0.25)


def start_guard():
    with (STATE / 'disk-guard.log').open('a') as log:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'guard'], stdout=log, stderr=log, start_new_session=True)


def up():
    if shutil.disk_usage(STATE).free < PAUSE_AT:
        raise SystemExit('Refusing start: 14 GB host free required to protect the approved 12 GB floor.')
    if running_pid():
        paused = STATE / 'disk-safety-stop.json'
        if paused.exists():
            record = json.loads(paused.read_text())
            if record.get('process_stopped') and record['pid'] == running_pid():
                os.kill(record['pid'], signal.SIGCONT)
        if status() == 'paused':
            qmp('cont')
        start_guard()
        print('ao-build:', status())
        return
    assert (DATA / 'windows.img').stat().st_size == 40_000_000_000
    for port in (2222, 7667, 5905):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    vars_path = DATA / 'efi_vars.fd'
    if not vars_path.exists():
        shutil.copyfile('/Applications/UTM.app/Contents/Resources/qemu/edk2-arm-secure-vars.fd', vars_path)
    QMP.unlink(missing_ok=True)
    command = [
        'qemu-system-aarch64', '-name', 'ao-build', '-machine', 'virt,highmem=on,gic-version=3',
        '-accel', 'hvf', '-cpu', 'host', '-smp', '4', '-m', '4096',
        '-drive', 'if=pflash,format=raw,readonly=on,file=/Applications/UTM.app/Contents/Resources/qemu/edk2-aarch64-secure-code.fd',
        '-drive', f'if=pflash,format=qcow2,file={vars_path}',
        '-drive', f'if=none,id=system,format=raw,discard=unmap,detect-zeroes=unmap,file={DATA / "windows.img"}',
        '-device', 'nvme,drive=system,serial=ao-system,bootindex=1',
        '-device', 'qemu-xhci', '-device', 'usb-kbd', '-device', 'usb-tablet',
        '-device', 'ramfb', '-display', 'none', '-vnc', '127.0.0.1:5',
        '-netdev', 'user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22,hostfwd=tcp:127.0.0.1:7667-:7667',
        '-device', 'virtio-net-pci,netdev=net0,mac=52:54:00:a0:b0:01',
        '-device', 'virtio-rng-pci',
        '-qmp', f'unix:{QMP},server=on,wait=off', '-serial', f'file:{STATE / "serial.log"}',
        '-rtc', 'base=localtime', '-no-shutdown',
    ]
    if not (STATE / 'windows-installed.json').exists() and not (STATE / 'provisioned.json').exists():
        for drive_id, filename, boot in [('installer', 'windows-noprompt.iso', ',bootindex=2'), ('seed', 'seed.iso', '')]:
            command += ['-drive', f'if=none,id={drive_id},media=cdrom,format=raw,readonly=on,file={DATA / filename}', '-device', f'usb-storage,drive={drive_id}{boot}']
    with (STATE / 'qemu.log').open('a') as log:
        process = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
    (STATE / 'qemu.pid').write_text(str(process.pid))
    # A CLI started by an automation host may inherit macOS background I/O
    # throttling. Restore normal scheduling for this emulator only.
    if policy := shutil.which('taskpolicy'):
        subprocess.run([policy, '-B', '-p', str(process.pid)], capture_output=True, timeout=3)
    start_guard()
    for _ in range(100):
        if process.poll() is not None:
            raise SystemExit('QEMU failed; see qemu.log')
        if QMP.exists():
            print('ao-build:', status(), '; SSH 127.0.0.1:2222; VNC 127.0.0.1:5905')
            return
        time.sleep(0.1)
    raise SystemExit('QEMU monitor did not become ready; see qemu.log')


def main(action):
    os.umask(0o077)
    if action == 'guard':
        guard()
    elif action == 'status':
        print(f'ao-build: {status()}; host free {shutil.disk_usage(STATE).free / 1e9:.2f} GB')
    elif action == 'up':
        up()
    elif action == 'down':
        if not running_pid():
            print('ao-build is already stopped.')
            return
        qmp('system_powerdown')
        for _ in range(90):
            if status() == 'shutdown':
                qmp('quit')
                print('ao-build stopped after guest shutdown.')
                return
            time.sleep(1)
        raise SystemExit('Guest did not shut down after 90 seconds; no forced stop was sent.')
    else:
        raise SystemExit('Usage: qemu-host.py up|down|status|guard')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '')
