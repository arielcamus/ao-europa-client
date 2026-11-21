#!/usr/bin/env python3
"""frmMapaGrande dungeon world picture (docs/DATA-PATCHES.md section 9). AGPL-3.0-or-later.

The pinned `init/mapsworlddata.dat` (Recursos 043cdf20, 2024-04-05) places every map on a 19 x 22 grid of 27 px cells. The world-2
("Dungeons") picture `interface/{es,en}_mapa2.bmp` was redrawn in Recursos 847f4a23 (2025-07-20, "Added missing images for
interfaces") with the dungeons rearranged, while the grid was never updated: 87 of the 112 dungeon maps (the Newbie Dungeon
37/168/264/167, Catacumbas 40-45, ...) now sit on black. frmMapaGrande puts the player marker in the grid cell, so on any dungeon
the marker lands on an empty spot. The 043cdf20 picture is the one drawn for this grid (5 of 112 on black, small dark maps).
Worlds 1 and 3 (847f4a23 too) match the grid: 0 cells on black.

  apply-worldmap-picture.py [--assets <Recursos dir>] [--check | --restore]

--assets   the client's AO_ASSETS folder (default: $AO_ASSETS)
--check    report which picture each world has and how many mapped cells are on black; write nothing
--restore  put the backed-up pictures (<file>.orig-worldmap) back

Applying replaces interface/es_mapa2.bmp and en_mapa2.bmp with the 043cdf20 files (downloaded from github.com/ao-org/Recursos,
sha256 checked), after copying the current ones to <file>.orig-worldmap. Idempotent. Pre-HOO: 2024 data, nothing from 1b50fd6 on.
"""
import argparse, collections, hashlib, os, re, shutil, struct, sys, urllib.request
from pathlib import Path

GOOD_SHA = '80e768afb1c3adad522162bdb8f53d22276bdec1130270287307ebcb62bbce12'  # 043cdf20 es_/en_mapa2.bmp (identical)
PINNED_SHA = 'f8e5bea18e14f701e04579267ed4cda5ec6da323976c2b4549ca657e44ad9e24'  # 847f4a23 es_/en_mapa2.bmp (identical)
URL = 'https://raw.githubusercontent.com/ao-org/Recursos/043cdf20b5931dd572dc0725beb5ce6467047427/interface/{}'
FILES = ['es_mapa2.bmp', 'en_mapa2.bmp']
TILE, COLUMNS = 27, 19  # frmMapaGrande TILE_SIZE, MAPAS_ANCHO
BACKUP = '.orig-worldmap'


def worlds(path):
    """Recursos.Cargarmapsworlddata: [INIT] TotalWorlds, [WORLDMAPn] Alto/Ancho and one key per cell (keys are case-insensitive)."""
    sections, cur = {}, None
    for line in path.read_text(encoding='latin-1').splitlines():
        line = line.strip()
        m = re.match(r'\[(.*)\]$', line)
        if m: cur = sections.setdefault(m.group(1).upper(), {}); continue
        if cur is not None and '=' in line:
            k, v = line.split('=', 1); cur[k.strip().upper()] = v.strip()
    out = []
    for j in range(1, int(sections['INIT']['TOTALWORLDS']) + 1):
        s = sections[f'WORLDMAP{j}']; n = int(s['ALTO']) * int(s['ANCHO'])
        out.append([int(s.get(str(i), '0') or 0) for i in range(1, n + 1)])
    return out


def bmp(path):
    b = path.read_bytes(); off = struct.unpack_from('<I', b, 10)[0]
    w, h = struct.unpack_from('<ii', b, 18); bpp = struct.unpack_from('<H', b, 28)[0]
    assert bpp in (24, 32), f'{path}: {bpp} bpp'
    stride = (w * bpp // 8 + 3) // 4 * 4; bottom_up = h > 0; h = abs(h)
    def px(x, y):
        i = off + ((h - 1 - y) if bottom_up else y) * stride + x * (bpp // 8)
        return b[i + 2], b[i + 1], b[i]
    return w, h, px


def on_black(indice, picture):
    """Maps whose 27 px cell is (almost) all black. The world's filler value (the most common one, 300 / 400) is skipped."""
    w, h, px = bmp(picture); filler = collections.Counter(indice).most_common(1)[0][0]; mapped, dark = 0, []
    for i, m in enumerate(indice):
        if not m or m == filler: continue
        mapped += 1; col, row = i % COLUMNS, i // COLUMNS
        lit = sum(1 for y in range(row * TILE, min(row * TILE + TILE, h)) for x in range(col * TILE, min(col * TILE + TILE, w)) if max(px(x, y)) > 24)
        if lit < 20: dark.append(m)
    return mapped, sorted(dark)


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--assets', default=os.environ.get('AO_ASSETS'))
    ap.add_argument('--check', action='store_true'); ap.add_argument('--restore', action='store_true')
    a = ap.parse_args()
    if not a.assets: sys.exit('--assets or AO_ASSETS is required')
    root = Path(a.assets).expanduser(); face = root / 'interface'
    if a.restore:
        for name in FILES:
            b = face / (name + BACKUP)
            if b.exists(): shutil.copy2(b, face / name); print(f'restored {name} from {b.name}')
            else: print(f'{name}: no backup, left as is')
        return
    if a.check:
        grid = worlds(root / 'init' / 'mapsworlddata.dat')
        for j, indice in enumerate(grid, 1):
            pic = face / f'es_mapa{j}.bmp'
            if not pic.exists(): print(f'world {j}: no {pic.name}'); continue
            digest = sha(pic); tag = {GOOD_SHA: '043cdf20 (2024, drawn for this grid)', PINNED_SHA: '847f4a23 (2025, NOT drawn for this grid)'}.get(digest, digest[:12])
            mapped, dark = on_black(indice, pic)
            print(f'world {j}: {pic.name} {tag}; {len(dark)} of {mapped} mapped cells on black {dark[:40]}')
        return
    for name in FILES:
        dest = face / name
        if dest.exists() and sha(dest) == GOOD_SHA: print(f'{name}: already the 043cdf20 picture'); continue
        data = urllib.request.urlopen(URL.format(name), timeout=60).read()
        if hashlib.sha256(data).hexdigest() != GOOD_SHA: sys.exit(f'{name}: downloaded file has an unexpected sha256, nothing written')
        backup = face / (name + BACKUP)
        if dest.exists() and not backup.exists(): shutil.copy2(dest, backup)
        tmp = face / (name + '.tmp-worldmap'); tmp.write_bytes(data); os.replace(tmp, dest)
        print(f'{name}: replaced with 043cdf20 (backup {backup.name})')


if __name__ == '__main__':
    main()
