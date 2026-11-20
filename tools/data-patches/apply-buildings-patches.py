#!/usr/bin/env python3
# AGPL-3.0-or-later. Re-applies the Ullathorpe building patches (docs/DATA-PATCHES.md) to a server's Recursos folder.
# Usage: apply-buildings-patches.py <Recursos dir> [--dry-run] [--zero-castle-triggers]. Idempotent; writes <file>.orig-<patch> backups before the first change.
import re, shutil, struct, sys
from pathlib import Path

root = Path(sys.argv[1]); dry = '--dry-run' in sys.argv
OBJ = root / 'Dat' / 'obj.dat'; COPIA = root / 'Dat' / 'obj - copia.dat'; MAP1 = root / 'Mapas' / 'mapa1.csm'

DOOR_1425 = ("Name=Puerta abierta\r\nTexto=Puerta abierta\r\nGrhIndex=26106\r\nObjType=6\r\nExtraStr=Puerta abierta\r\n"
  "IndexAbierta=1425\r\nIndexCerrada=1426\r\nIndexCerradaLlave=1426\r\nLlave=0\r\nAgarrable=1\r\nCerrada=0\r\n"
  "en_Name=Open door\r\nen_Texto=Open door\r\npt_Name=Porta aberta\r\npt_Texto=Porta aberta\r\n"
  "fr_Name=Porte ouverte\r\nfr_Texto=Porte ouverte\r\nit_Name=Porta aperta\r\nit_Texto=Porta aperta\r\n").encode('latin-1')
# Map-referenced doors that were empty/absent, plus their open/locked partners (all present in `obj - copia.dat`).
COPIA_IDS = [241, 242, 244, 245, 248, 249, 1235, 3598, 3599, 3600]
# SUPERSEDED by the server fix (vm-server 7b7ecbf, CheckCastleEntryWhiteList): the map keeps its original triggers. Only applied with --zero-castle-triggers,
# for a server build without that fix. 21..40 = EMPEROR_CASTLE_ENTRY_n on the server.
CASTLE_TRIGGERS = {26, 27, 29, 31, 32, 33}

def backup(path, tag):
    b = path.with_name(path.name + '.orig-' + tag)
    if not b.exists() and not dry: shutil.copy2(path, b)

def split(t):
    parts = re.split(rb'(?m)^(?=\[OBJ\d+\]\r?$)', t)
    return parts[0], [(int(re.match(rb'\[OBJ(\d+)\]', p).group(1)), p) for p in parts[1:]]

def patch_obj():
    head, blocks = split(OBJ.read_bytes()); d = dict(blocks); order = [n for n, _ in blocks]
    norm = lambda body: body.rstrip(b'\r\n') + b'\r\n\r\n'
    want = {1425: b'[OBJ1425]\r\n' + DOOR_1425 + b'\r\n'}
    _, cb = split(COPIA.read_bytes()); cb = dict(cb)
    for i in COPIA_IDS:
        assert cb[i].split(b'\r\n', 1)[1].strip(), f'copia has no data for OBJ{i}'
        want[i] = norm(cb[i])
    for i, body in want.items():
        d[i] = body
        if i not in order:
            later = [k for k, n in enumerate(order) if n > i]; order.insert(later[0] if later else len(order), i)
    out = head + b''.join(d[n] for n in order)
    return out

def patch_map():
    b = bytearray(MAP1.read_bytes()); first = struct.unpack_from('<i', b, 0)[0]; five = first == 0x324c3557; o = 4
    if five: nb = struct.unpack_from('<i', b, o)[0]; o += 4
    else: nb = first
    nl = 5 if five else 4; layers = struct.unpack_from('<%di' % nl, b, o); o += 4 * nl
    ntrig = struct.unpack_from('<6i', b, o)[0]; o += 32
    text = lambda p: p + 2 + struct.unpack_from('<H', b, p)[0]
    o = text(o); o += 1; o = text(o); o += 9; o = text(o); o = text(o); o = text(o); o += 16; o = text(o); o += 3
    o += 5 * nb + 8 * sum(layers); n = 0
    for _ in range(ntrig):
        if struct.unpack_from('<h', b, o + 4)[0] in CASTLE_TRIGGERS: struct.pack_into('<h', b, o + 4, 0); n += 1
        o += 6
    return bytes(b), n

new_obj = patch_obj()
if new_obj != OBJ.read_bytes():
    print('obj.dat: patching'); backup(OBJ, 'buildings')
    if not dry: OBJ.write_bytes(new_obj)
else: print('obj.dat: already patched')
if '--zero-castle-triggers' in sys.argv:
    new_map, n = patch_map()
    print(f'mapa1.csm: {n} trigger tiles to zero')
    if n:
        backup(MAP1, 'buildings')
        if not dry: MAP1.write_bytes(new_map)
else: print('mapa1.csm: untouched (castle triggers are handled by the server fix)')
print('restart the server to load the changes.')
