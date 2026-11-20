#!/usr/bin/env python3
"""Package verified local official downloads and the pinned AO source for SSH."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import zipfile

STATE = Path(os.environ.get('AO_VM_STATE', '~/Projects/ao-reference/runtime/ao-vm')).expanduser().resolve()
REF = Path('~/Projects/ao-reference').expanduser()
DOWNLOADS = REF / 'runtime/downloads'
REV = 'caac31333f7cefdbe2b7771cf309e555b33a563e'
FILES = {
    'twinBASIC_IDE_BETA_1044.zip': (DOWNLOADS, 'd9e525fd7743f6161653025c130aec141fbcfa79dca7255b1eff067b519a0554', 'https://github.com/twinbasic/twinbasic/releases/tag/beta-x-1044', True),
    'VB60SP6-KB2708437-x86-ENU.msi': (STATE, '350602b2e084b39c97d1394c8594b18e41ef622315d4a9635c5e8ea6aa977b5e', 'https://www.microsoft.com/en-us/download/details.aspx?id=7030', False),
    'sqliteodbc.exe': (DOWNLOADS, '3bce566ecc2545a49c0cad1d0c4c62ddafd529b77bdc147c1dcee8eace8acc70', 'http://www.ch-werner.de/sqliteodbc/sqliteodbc.exe', False),
    'MicrosoftEdgeWebView2RuntimeInstallerX86.exe': (DOWNLOADS, '316965c12d39ebac80976c460c3573a8eea734b3d91fed861b69991a5c15c9e7', 'https://go.microsoft.com/fwlink/?linkid=2099617', False),
}


def main():
    os.umask(0o077)
    if shutil.disk_usage(STATE).free < 28 * 1024**3 + 512 * 1024**2:
        raise SystemExit('Not enough space to stage payload and retain the host reserve.')
    manifest = {'server_revision': REV, 'source': 'https://github.com/ao-org/argentum-online-server-classic',
                'twinbasic_download_page': 'https://twinbasic.com/licensing',
                'utm_guest_tools': {'url': 'https://getutm.app/downloads/utm-guest-tools-latest.iso',
                                    'release': '0.1.271',
                                    'sha256': '65b6a69b392ee01dd314c10f3dad9ebbf9c4160be43f5f0dd6bb715944d9095b',
                                    'publisher_hash_verified': True},
                'files': {}}
    for name, (folder, expected, source, publisher_hash) in FILES.items():
        with (folder / name).open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != expected:
            raise SystemExit(f'Unexpected SHA-256: {folder / name}')
        manifest['files'][name] = {'sha256': actual, 'source': source, 'publisher_hash_verified': publisher_hash}
    resources = REF / 'Recursos'
    manifest['resources_revision'] = subprocess.check_output(['git', '-C', str(resources), 'rev-parse', 'HEAD'], text=True).strip()
    source_zip = subprocess.check_output(['git', '-C', str(REF / 'argentum-online-server-classic'),
                                          'archive', '--format=zip', REV])
    with tempfile.TemporaryDirectory(prefix='ao-vb6-', dir=STATE) as temporary:
        runtime = Path(temporary)
        subprocess.run(['7zz', 'e', str(STATE / 'VB60SP6-KB2708437-x86-ENU.msi'),
                        f'-o{runtime}', '-y', 'comctl32.ocx', 'MSINET.ocx', 'MSDatGrd.ocx', 'msstdfmt.dll', 'MSBind.dll'],
                       check=True, stdout=subprocess.DEVNULL)
        with zipfile.ZipFile(STATE / 'payload.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as out:
            with zipfile.ZipFile(io.BytesIO(source_zip)) as archive:
                for entry in archive.infolist():
                    if entry.is_dir():
                        continue
                    content = archive.read(entry)
                    if entry.filename.lower() == 'server.vbp':
                        text = content.decode('cp1252')
                        if 'PYMMO = 0' not in text:
                            raise SystemExit('Pinned source unexpectedly lacks PYMMO=0')
                        # Preserve existing constants, explicitly disable legacy DirectPlay.
                        text = text.replace('BATTLESERVER = 0"', 'BATTLESERVER = 0 : DIRECT_PLAY = 0"')
                        content = text.encode('cp1252')
                    out.writestr('server/' + entry.filename, content)
                for source, target in [('Example.Server.ini', 'Server.ini'),
                                       ('Example.feature_toggle.ini', 'feature_toggle.ini'),
                                       ('Example.Configuracion.ini', 'Configuracion.ini'), ('Empty_db.db', 'Database.db')]:
                    content = archive.read(source)
                    if source == 'Example.Server.ini':
                        content = content.replace(b'..\\re20-server\\', b'.\\')
                    out.writestr('server/' + target, content)
            for name in ('charfile', 'Chardelete', 'cuentas', 'DeleteCuentas', 'Logs'):
                out.writestr('server/' + name + '/', b'')
            for directory in ('Dat', 'Mapas'):
                for file in sorted((resources / directory).rglob('*')):
                    if file.is_file() and '.git' not in file.parts:
                        out.write(file, 'Recursos/' + str(file.relative_to(resources)))
            motd = resources / 'Dat/Example.Motd.ini'
            if motd.is_file() and not (resources / 'Dat/Motd.ini').exists():
                out.write(motd, 'Recursos/Dat/Motd.ini')
            for name, (folder, _, _, _) in FILES.items():
                if not name.endswith('.msi'):
                    out.write(folder / name, 'deps/' + name)
            for name in ('comctl32.ocx', 'msinet.ocx', 'msdatgrd.ocx', 'msstdfmt.dll', 'msbind.dll'):
                file = next((p for p in runtime.iterdir() if p.name.lower() == name), None)
                if file is None or not file.is_file():
                    raise SystemExit(f'Microsoft MSI did not contain {name}')
                out.write(file, 'deps/vb6/' + name)
            out.writestr('sources.json', json.dumps(manifest, indent=2) + '\n')
    (STATE / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Staged {STATE / "payload.zip"}: {(STATE / "payload.zip").stat().st_size:,} bytes; no compiler invoked.')


if __name__ == '__main__':
    main()
