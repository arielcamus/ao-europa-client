#!/usr/bin/env python3
"""Stage an ARM64 UTM bundle and unattended seed; never launch or compile."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import uuid
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
STATE = Path(os.environ.get('AO_VM_STATE', '~/Projects/ao-reference/runtime/ao-vm')).expanduser().resolve()
WIN_SHA256 = '8992f2d2cfd2fa647e579e9eb31fc21f34da8333c29b6170fde17d2ed6623e9c'


def run(*args):
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, text=True, timeout=120).stdout


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check_space(extra=0):
    free = shutil.disk_usage(STATE).free
    if free - extra < 28 * 1024**3:
        raise SystemExit('Insufficient host space: preserve 28 GiB before starting or staging additional data.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iso', type=Path, help='Official Microsoft English Windows 11 ARM64 ISO')
    parser.add_argument('--sha256', default=WIN_SHA256, help='Hash published by Microsoft for this ISO')
    parser.add_argument('--guest-tools-mount', type=Path, default=Path('/Volumes/UTM Guest Tools'))
    args = parser.parse_args()
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    STATE.chmod(0o700)
    check_space(512 * 1024**2)
    bundle = STATE / 'ao-build.utm'
    data = bundle / 'Data'
    # The seed wipes guest disk 0. Never regenerate boot media after first boot.
    if any(data.glob('*.fd')) or (data / 'efi_vars.fd').exists():
        raise SystemExit('VM has firmware state. Refusing to replace its unattended installation media.')
    data.mkdir(parents=True, exist_ok=True)
    seed = STATE / 'seed'
    seed.mkdir(exist_ok=True)
    identity = STATE / 'identity.json'
    if identity.exists():
        ident = json.loads(identity.read_text())
    else:
        ident = {'username': 'aobuilder', 'password': 'Ao9!' + secrets.token_hex(16), 'uuid': str(uuid.uuid4()).upper()}
        identity.write_text(json.dumps(ident, indent=2) + '\n')
    key = STATE / 'id_ed25519'
    if not key.exists():
        run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'ao-build-only', '-f', key)
    shutil.copyfile(key.with_suffix('.pub'), seed / 'authorized_keys')
    xml = (HERE / 'autounattend.xml.in').read_text().replace('@@PASSWORD@@', ident['password'])
    ET.fromstring(xml)
    (seed / 'autounattend.xml').write_text(xml)
    shutil.copyfile(HERE / 'bootstrap.ps1', seed / 'bootstrap.ps1')
    for driver in ('NetKVM', 'viogpudo'):
        source = args.guest_tools_mount / 'Drivers' / driver / 'w11' / 'ARM64'
        if not source.is_dir():
            raise SystemExit(f'Missing official UTM ARM64 driver directory: {source}')
        shutil.copytree(source, seed / 'drivers' / driver, dirs_exist_ok=True)
    run('hdiutil', 'makehybrid', '-iso', '-joliet', '-default-volume-name', 'AOSEED',
        '-o', data / 'seed.iso', seed, '-ov')
    disk = data / 'windows.img'
    if not disk.exists():
        with disk.open('xb') as stream:
            stream.truncate(40_000_000_000)  # APFS sparse raw image, 40 decimal GB maximum.
    if disk.stat().st_size != 40_000_000_000:
        raise SystemExit('Existing virtual disk does not have the requested 40 GB capacity.')
    iso = data / 'windows.iso'
    if args.iso:
        source = args.iso.expanduser().resolve()
        if digest(source) != args.sha256.lower():
            raise SystemExit('Windows ISO does not match the supplied Microsoft SHA-256.')
        mount = plistlib.loads(subprocess.check_output(['hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(source)]))
        volumes = [Path(e['mount-point']) for e in mount['system-entities'] if 'mount-point' in e]
        try:
            if not any((v / 'efi/boot/bootaa64.efi').exists() for v in volumes):
                raise SystemExit('ISO does not contain the ARM64 UEFI loader.')
        finally:
            for volume in volumes:
                run('hdiutil', 'detach', volume)
        if not iso.exists():
            if source.stat().st_dev == data.stat().st_dev:
                os.link(source, iso)  # No second 6+ GB copy on the host.
            else:
                check_space(source.stat().st_size)
                shutil.copyfile(source, iso)
        elif digest(iso) != args.sha256.lower():
            raise SystemExit('A different Windows ISO is already attached.')
    drives = [
        {'ImageName': 'windows.img', 'ImageType': 'Disk', 'Interface': 'NVMe', 'InterfaceVersion': 1, 'Identifier': 'ao-system', 'ReadOnly': False},
        {'ImageType': 'CD', 'Interface': 'USB', 'InterfaceVersion': 1, 'Identifier': 'ao-windows-installer', 'ReadOnly': True},
        {'ImageName': 'seed.iso', 'ImageType': 'CD', 'Interface': 'USB', 'InterfaceVersion': 1, 'Identifier': 'ao-unattended-seed', 'ReadOnly': True},
    ]
    if iso.exists():
        drives[1]['ImageName'] = 'windows.iso'
    config = {
        'Backend': 'QEMU', 'ConfigurationVersion': 4,
        'Information': {'Name': 'ao-build', 'UUID': ident['uuid'], 'Icon': 'windows', 'IconCustom': False,
                        'Notes': 'Local AO build VM. 4096 MiB RAM; sparse 40 GB disk. Manual twinBASIC Community build only.'},
        'System': {'Architecture': 'aarch64', 'Target': 'virt', 'CPU': 'default', 'CPUCount': 4,
                   'CPUFlagsAdd': [], 'CPUFlagsRemove': [], 'ForceMulticore': False, 'MemorySize': 4096, 'JITCacheSize': 0},
        'QEMU': {'DebugLog': True, 'UEFIBoot': True, 'RNGDevice': True, 'BalloonDevice': False,
                 'TPMDevice': True, 'Hypervisor': True, 'RTCLocalTime': True, 'PS2Controller': False, 'AdditionalArguments': []},
        'Input': {'UsbBusSupport': '3.0', 'UsbSharing': False, 'MaximumUsbShare': 0},
        'Sharing': {'DirectoryShareMode': 'None', 'DirectoryShareReadOnly': True, 'ClipboardSharing': False},
        'Display': [{'Hardware': 'virtio-ramfb', 'DynamicResolution': True, 'NativeResolution': False,
                     'UpscalingFilter': 'Linear', 'DownscalingFilter': 'Linear'}],
        'Drive': drives,
        'Network': [{'Mode': 'Emulated', 'Hardware': 'virtio-net-pci', 'MacAddress': '52:54:00:A0:B0:01',
                     'IsolateFromHost': False,
                     'PortForward': [{'Protocol': 'TCP', 'HostAddress': '127.0.0.1', 'HostPort': h, 'GuestPort': g}
                                     for h, g in ((2222, 22), (7667, 7667))]}],
        'Serial': [], 'Sound': [],
    }
    with (bundle / 'config.plist').open('wb') as stream:
        plistlib.dump(config, stream)
    (STATE / 'ssh_config').write_text(f'''Host ao-build
    HostName 127.0.0.1
    Port 2222
    User aobuilder
    IdentityFile "{key}"
    IdentitiesOnly yes
    UserKnownHostsFile "{STATE / 'known_hosts'}"
    StrictHostKeyChecking accept-new
    ConnectTimeout 5
    ServerAliveInterval 15
    ServerAliveCountMax 3
''')
    print(f'Staged {bundle}; ISO attached: {iso.exists()}; guest not started.')
    print(f'Disk: {disk.stat().st_size} logical bytes; {disk.stat().st_blocks * 512} allocated bytes.')


if __name__ == '__main__':
    main()
