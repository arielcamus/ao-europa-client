#!/usr/bin/env python3
"""Home cities on land: Forgat and Lindos spawn/resurrection (docs/DATA-PATCHES.md sections 6 and 7). AGPL-3.0-or-later.

The pinned Dat/Ciudades.Dat (Recursos 2bfa51e) puts the [Forgat] and [Lindos] spawn and resurrection tiles on open sea (maps 517,
408, 409). Only these twelve keys change; MAPAVIAJE/ViajeX/ViajeY, NecesitaNave and Mapas stay as pinned. Idempotent: every edit
SETS a key. Pre-HOO data only.

  apply-home-city-patches.py --dat <server Dat dir> [--check]

Section 6 (live since 2026-11-21 11:44) then section 7 (live with the home-city build); section 8 (apply-newbie-patches.py) edits
[Renacimiento] of the same file afterwards.
"""
import argparse, importlib.util, os, sys

sys.dont_write_bytecode = True  # loading the sibling script must not leave a __pycache__ in the repo

_spec = importlib.util.spec_from_file_location('newbie', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'apply-newbie-patches.py'))
_newbie = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_newbie)

CIUDADES = [
    # section 6: map 751 "Ciudad de Forgat", central square; resurrection two tiles south of Xanthe (65,68). Was 517:48,65 / 517:65,69.
    ('Forgat', {'MAPA': '751', 'X': '60', 'Y': '57', 'MapaResu': '751', 'ResuX': '65', 'ResuY': '70'}),
    # section 7: map 64 "Ciudad de Lindos", the square in front of the Templo; resurrection inside it. Was 408:63,39 / 409:52,47.
    ('Lindos', {'MAPA': '64', 'X': '50', 'Y': '59', 'MapaResu': '64', 'ResuX': '51', 'ResuY': '44'}),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--dat', required=True); ap.add_argument('--check', action='store_true'); a = ap.parse_args()
    log = _newbie.patch_ini(os.path.join(a.dat, 'Ciudades.Dat'), [(rf'^\[{s}\]', v) for s, v in CIUDADES], check=a.check)
    print('\n'.join(log) if log else 'nothing to change (already applied)')


if __name__ == '__main__':
    sys.exit(main())
