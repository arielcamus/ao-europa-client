#!/usr/bin/env python3
"""Newbie Dungeon signposting + newbie quest repairs (docs/DATA-PATCHES.md section 8). AGPL-3.0-or-later.

Pre-HOO data only (Recursos 2bfa51e Dat + the 9ccd server). Idempotent: every edit SETS a key to a value, the map edit
only inserts the NPC when it is not there yet.

  apply-newbie-patches.py --dat <server Dat dir> [--maps <Mapas dir>] [--client-init <client init dir>] [--check]

--dat          Ciudades.Dat, Motd.ini, npcs.dat, Quests.DAT (windows-1252, CRLF, as the server reads them)
--maps         Mapa64.csm gets one Cartelera <Quest> (NPC 1331) at (52,57), Lindos
--client-init  sp_localindex.dat (UTF-8, LF): the text the client shows for NPC 1331 and the patched quests
--check        report what would change, write nothing
"""
import argparse, os, re, struct, sys

RATES_NOTE = 'EXP X1 - RECOLECCIÓN X1 - ORO X1'  # Configuracion.ini [CONFIGURACIONES] ExpMult=1, RecoleccionMult=1, OroMult=1

CIUDADES = {'Renacimiento': {'X': '58', 'Y': '44', 'MAPA': '1'}}  # was 517 (Alta Mar), 48, 62

MOTD = {
    'INIT': {'NumLines': '11'},
    'MOTD': {
        'Line9': '* Rates del servidor: ' + RATES_NOTE + '~0~255~0~1~0',
        'Line10': '* ¿Eres nuevo? Hasta el nivel 12 entrena en el Dungeon Newbie: su entrada está en tu ciudad.~255~200~0~1~0',
        'Line11': '* Busca la Cartelera de tu ciudad y toma los encargos de Makrom. Al llegar a nivel 13 dejarás de ser Newbie y viajarás a Ullathorpe.~255~200~0~0~0',
    },
}

CARTELERA_DESC = ('Encargos para aventureros. Si eres nuevo por aquí, toma los encargos de Makrom y entrena en el Dungeon Newbie, '
                  'su entrada está en esta misma ciudad.')
CARTELERA_DESC_EN = ('Tasks for adventurers. If you are new here, take Makrom\'s tasks and train in the Newbie Dungeon, '
                     'its entrance is in this very city.')
CARTELERA_QUESTS = [190, 191, 192, 193, 194, 4, 154, 163, 164, 165]

NPCS = {
    1331: dict({'Desc': CARTELERA_DESC, 'en_desc': CARTELERA_DESC_EN, 'NumQuest': str(len(CARTELERA_QUESTS))},
               **{f'QuestNumber{i}': str(q) for i, q in enumerate(CARTELERA_QUESTS, 1)}),
    # Snake fluid (obj 2492) dropped only for quest 9, an empty section: give it to quest 4 ("Veneno mortal"), which asks for it.
    502: {'DropQuest1': '4-2492-1-1'},
}

QUESTS = {
    4: {'PosMap': '168'},
    190: {'Desc': '¿Eres nuevo por aquí? ¡Bah, eso no importa novato! El Dungeon Newbie, cuya entrada está en tu ciudad, está repleto de '
                  'molestas y peligrosas criaturas, ten cuidado ya que pueden lastimarte o incluso matarte. Eliminalas y te dare una recompensa.'},
    191: {'PosMap': '264'},
    192: {'PosMap': '167'},
    193: {'RequiredLevel': '6', 'RequiredNPCs': '1', 'RequiredNpc1': '965-1', 'RequiredOBJs': None, 'RequiredObj1': None,
          'Desc': 'Entre todos estos lobos, existe uno que es temido por todos, el gran Wolfang. Es el Líder de la Manada y poder eliminarlo '
                  'nos daría la ventaja para poder controlarlos. Acaba con él, enseñémosle a esta miserable manada quien es el líder.',
          'en_Desc': 'Among all these wolves, there is one that is feared by all, the great Wolfang. He is the Leader of the Pack and being '
                     'able to eliminate him would give us the advantage to control them. Finish him off, let\'s show this miserable pack who is the leader.'},
    194: {'Desc': 'Ha llegado la hora... ¡Enfréntate a los Wolfang y libera nuestro Dungeon!',
          'DescFinal': '¡Te estaré eternamente agradecido!'},
    40: {'RequiredNpc1': '514-15', 'PosMap': '12',
         'Desc': 'Necesito dirigirme a la ciudad del comercio, pero un grupo de Esqueletos destruyó el sendero y tomó el control del Bosque '
                 'Este de Ullathorpe. Si consigues eliminarlos y permitirme el traslado hacia Ullathorpe, ¡te daré una buena recompensa!',
         'en_Desc': 'I need to head to the trade city, but a group of Skeletons destroyed the path and took control of the East Forest of '
                    'Ullathorpe. If you can eliminate them and allow me to travel to Ullathorpe, I\'ll give you a handsome reward!'},
    41: {'RequiredNpc1': '935-25', 'PosMap': '167',
         'Desc': 'Las serpientes rojas han comenzado a aparecer en el Dungeon Newbie Sur, y su veneno es tan ardiente como su color. Son '
                 'rápidas, agresivas y están atacando a los aventureros desprevenidos. ¡Acaba con ellas antes de que el camino se vuelva intransitable!',
         'DescFinal': 'Los novatos pueden estar más tranquilos sabiendo que esta amenaza ha sido controlada, gracias aventurero.',
         'en_Desc': 'Red snakes have begun appearing in the South Newbie Dungeon, and their venom is as fiery as their color. They\'re fast, '
                    'aggressive, and attacking unwary adventurers. Kill them before the path becomes impassable!',
         'en_DescFinal': 'The newcomers can rest easier knowing that this threat has been controlled, thank you adventurer.'},
    42: {'RequiredNpc1': '500-16', 'PosMap': '37',
         'Desc': 'Por si las malditas serpientes fueran poco otra criatura ha aparecido en el Dungeon Newbie, y es de temerse de verdad. Una '
                 'intensa magia ha cambiado a los lobos de la caverna y los ha vuelto muy peligrosos. Ayudanos a controlar la amenaza y te daré un tesoro.',
         'en_Desc': 'As if the damned snakes were not enough, another creature has appeared in the Newbie Dungeon, and it is truly feared. '
                    'Intense magic has changed the cave wolves and made them very dangerous. Help us control the threat and I will give you a treasure.'},
}
CLIENT_QUESTS = [4, 40, 41, 42, 190, 191, 192, 193, 194]  # [QUESTn] of sp_localindex.dat rebuilt from the patched Quests.DAT
LINDOS_CARTELERA = (64, 52, 57, 1331)


def edit_section(lines, header_re, values, nl):
    """Sets key=value inside the first section whose header matches; None deletes the key; new keys go after the last key."""
    start = next((i for i, l in enumerate(lines) if re.match(header_re, l, re.I)), None)
    if start is None: raise SystemExit(f'section not found: {header_re}')
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('[')), len(lines))
    changes = []
    for key, val in values.items():
        idx = next((i for i in range(start + 1, end) if re.match(rf'{re.escape(key)}\s*=', lines[i], re.I)), None)
        if val is None:
            if idx is not None: changes.append(f'- {lines[idx].rstrip()}'); del lines[idx]; end -= 1
            continue
        new = f'{key}={val}{nl}'
        if idx is None:
            last = max((i for i in range(start + 1, end) if '=' in lines[i]), default=start)
            lines.insert(last + 1, new); end += 1; changes.append(f'+ {new.rstrip()}')
        elif lines[idx] != new:
            changes.append(f'~ {lines[idx].rstrip()}  ->  {new.rstrip()}'); lines[idx] = new
    return changes


def patch_ini(path, sections, enc='cp1252', check=False):
    raw = open(path, 'rb').read().decode(enc)
    nl = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.splitlines(keepends=True)
    out = []
    for header_re, values in sections:
        for c in edit_section(lines, header_re, values, nl): out.append(f'{header_re}: {c}')
    if out and not check: open(path, 'wb').write(''.join(lines).encode(enc))
    return out


def read_ini_section(path, header_re, enc='cp1252'):
    lines = open(path, 'rb').read().decode(enc).splitlines()
    start = next(i for i, l in enumerate(lines) if re.match(header_re, l, re.I))
    d = {}
    for l in lines[start + 1:]:
        if l.startswith('['): break
        if '=' in l and not l.lstrip().startswith("'"):
            k, v = l.split('=', 1); d.setdefault(k.strip().lower(), v.strip())
    return d


def patch_csm_npc(path, mx, x, y, npc, check=False):
    b = bytearray(open(path, 'rb').read())
    first = struct.unpack_from('<i', b, 0)[0]; five = first == 0x324c3557
    o = 8 if five else 4
    nl = 5 if five else 4
    layers = struct.unpack_from(f'<{nl}i', b, o); o += 4 * nl
    hdr = o
    ntrig, nluz, npart, nnpc, nobj, nte = struct.unpack_from('<6i', b, o); o += 24 + 8
    def text(o): n = struct.unpack_from('<H', b, o)[0]; return o + 2 + n
    o = text(o) + 1; o = text(o) + 9; o = text(text(text(o))) + 16; o = text(o) + 3
    nb = struct.unpack_from('<i', b, 4)[0] if five else first
    o += nb * 5 + sum(layers) * 8 + ntrig * 6 + npart * 8 + nluz * 9 + nobj * 8
    npcs = [struct.unpack_from('<hhh', b, o + 6 * i) for i in range(nnpc)]
    if (x, y, npc) in npcs: return []
    if any((nx, ny) == (x, y) for nx, ny, _ in npcs): raise SystemExit(f'{path}: tile {x},{y} already has an NPC')
    if not check:
        b[o + 6 * nnpc:o + 6 * nnpc] = struct.pack('<hhh', x, y, npc)
        struct.pack_into('<i', b, hdr + 12, nnpc + 1)
        open(path, 'wb').write(bytes(b))
    return [f'Mapa{mx}.csm: + NPC {npc} at ({x},{y}) (NPC count {nnpc} -> {nnpc + 1})']


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--dat', required=True); ap.add_argument('--maps'); ap.add_argument('--client-init')
    ap.add_argument('--check', action='store_true'); a = ap.parse_args()
    d = lambda f: os.path.join(a.dat, f)
    log = []
    log += patch_ini(d('Ciudades.Dat'), [(rf'^\[{s}\]', v) for s, v in CIUDADES.items()], check=a.check)
    log += patch_ini(d('Motd.ini'), [(rf'^\[{s}\]', v) for s, v in MOTD.items()], check=a.check)
    log += patch_ini(d('npcs.dat'), [(rf'^\[NPC{n}\]', v) for n, v in NPCS.items()], check=a.check)
    log += patch_ini(d('Quests.DAT'), [(rf'^\[QUEST{q}\]', v) for q, v in QUESTS.items()], check=a.check)
    if a.maps:
        m, x, y, n = LINDOS_CARTELERA
        log += patch_csm_npc(os.path.join(a.maps, f'Mapa{m}.csm'), m, x, y, n, check=a.check)
    if a.client_init:
        sections = []
        nd = read_ini_section(d('npcs.dat'), r'^\[NPC1331\]')
        sections.append((r'^\[NPC1331\]', {'BODY': nd['body'], 'DESC': nd['desc'], 'HEAD': nd['head'], 'NAME': nd['name']}))
        for q in CLIENT_QUESTS:
            qd = read_ini_section(d('Quests.DAT'), rf'^\[QUEST{q}\]')
            sections.append((rf'^\[QUEST{q}\]', {'DESC': qd.get('desc', ''), 'DESCFINAL': qd.get('descfinal', ''), 'NEXTQUEST': qd.get('nextquest', ''),
                                                 'NOMBRE': qd.get('nombre', ''), 'POSMAP': qd.get('posmap', '0') or '0',
                                                 'REPETIBLE': qd.get('repetible', '0') or '0', 'REQUIREDLEVEL': qd.get('requiredlevel', '0') or '0'}))
        log += patch_ini(os.path.join(a.client_init, 'sp_localindex.dat'), sections, enc='utf-8', check=a.check)
    print('\n'.join(log) if log else 'nothing to change (already applied)')


if __name__ == '__main__':
    sys.exit(main())
