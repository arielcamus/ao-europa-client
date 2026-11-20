#!/usr/bin/env python3
"""Make an APFS-cloned no-prompt Windows ISO; optionally collect WinPE logs.

The supplied Microsoft ISO is verified and never modified. Diagnostics add a
setup wrapper and Microsoft's curl to a separate Windows PE image, not the OS.
"""
import argparse
import hashlib
import mmap
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
STATE = Path(os.environ.get('AO_VM_STATE', '~/Projects/ao-reference/runtime/ao-vm')).expanduser()
SHA256 = '500bcb6f272b7c455156470ea06816f558f13b885723f84ee9eab7534c7dee61'


def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, timeout=120, **kwargs)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(source, target, diagnostics):
    if target.exists():
        raise SystemExit(f'Refusing to overwrite existing media: {target}')
    if shutil.disk_usage(STATE).free < 16_000_000_000:
        raise SystemExit('16 GB free required while preparing media (12 GB reserve plus workspace).')
    if digest(source) != SHA256:
        raise SystemExit('ISO hash differs from the Microsoft download supplied by Ariel.')
    mounted = plistlib.loads(run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', source]).stdout)
    volume = next(Path(e['mount-point']) for e in mounted['system-entities'] if 'mount-point' in e)
    try:
        original = (volume / 'efi/microsoft/boot/efisys.bin').read_bytes()
        replacement = (volume / 'efi/microsoft/boot/efisys_noprompt.bin').read_bytes()
        with source.open('rb') as stream:
            catalog = None
            for sector in range(16, 32):
                stream.seek(sector * 2048)
                descriptor = stream.read(2048)
                if descriptor[:7] == b'\x00CD001\x01':
                    catalog = struct.unpack_from('<I', descriptor, 71)[0]
                    break
            assert catalog is not None, 'No El Torito boot catalog'
            stream.seek(catalog * 2048)
            catalog = stream.read(2048)
            assert catalog[1] == 0xef and catalog[32] == 0x88, 'Not an EFI boot image'
            size = struct.unpack_from('<H', catalog, 38)[0] * 512
            offset = struct.unpack_from('<I', catalog, 40)[0] * 2048
            assert size == len(original) == len(replacement)
            stream.seek(offset)
            assert stream.read(size) == original
        # -c must succeed: never fall back to a full extra 8.5 GB copy.
        run(['cp', '-c', source, target])
        assert not os.path.samefile(source, target)
        with target.open('r+b') as stream:
            stream.seek(offset)
            stream.write(replacement)
        if diagnostics:
            with tempfile.TemporaryDirectory(prefix='pe-media-', dir=STATE) as folder:
                work = Path(folder)
                boot = work / 'boot.wim'
                original_boot = volume / 'sources/boot.wim'
                run(['wimlib-imagex', 'export', original_boot, '2', boot, '--boot'])
                run(['wimlib-imagex', 'extract', volume / 'sources/install.wim', '3', 'Windows/System32/curl.exe', f'--dest-dir={work}'])
                (work / 'winpeshl.ini').write_bytes(b'[LaunchApps]\r\n%SYSTEMROOT%\\System32\\cmd.exe, /c X:\\Windows\\System32\\ao-setup.cmd\r\n')
                pairs = [(work / 'winpeshl.ini', 'winpeshl.ini'), (work / 'curl.exe', 'curl.exe'),
                         (HERE / 'pe-setup.cmd', 'ao-setup.cmd'), (HERE / 'pe-logs.cmd', 'ao-logs.cmd')]
                commands = ''.join(f'add "{src}" /Windows/System32/{dst}\n' for src, dst in pairs)
                run(['wimlib-imagex', 'update', boot, '1'], input=commands.encode())
                assert boot.stat().st_size <= original_boot.stat().st_size, 'Diagnostic WIM does not fit original extent'
                with original_boot.open('rb') as stream:
                    header = stream.read(208)
                with target.open('r+b') as stream:
                    with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
                        location = mapped.find(header)
                        assert location > 0 and mapped.find(header, location + 1) == -1
                        proof = hashlib.sha256()
                        for pos in range(0, original_boot.stat().st_size, 8 * 1024**2):
                            proof.update(mapped[location + pos:location + min(pos + 8 * 1024**2, original_boot.stat().st_size)])
                        assert proof.hexdigest() == digest(original_boot), 'Boot WIM is not a contiguous verified extent'
                    stream.seek(location)
                    with boot.open('rb') as data:
                        shutil.copyfileobj(data, stream, 8 * 1024**2)
                    stream.write(bytes(original_boot.stat().st_size - boot.stat().st_size))
        print(f'Created {target}; diagnostics={diagnostics}; original Microsoft ISO unchanged.')
    finally:
        run(['hdiutil', 'detach', volume])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iso', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=STATE / 'ao-build.utm/Data/windows-noprompt.iso')
    parser.add_argument('--diagnostics', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    build(args.iso.expanduser().resolve(), args.output.expanduser().resolve(), args.diagnostics)
