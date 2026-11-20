# Server data patches (Ullathorpe buildings)

Applied 2026-11-20 to `C:\ao\Recursos` in the VM and to `~/Projects/ao-reference/Recursos`. Re-apply to a fresh install with
`python3 tools/data-patches/apply-buildings-patches.py <Recursos dir>` (idempotent, makes `*.orig-buildings` backups, byte-identical to the
hand-applied result: obj.dat md5 `e4818263d8c0d6d0bdc61188d8550dbb`, mapa1.csm md5 `847d3ae82cf46cd8420829209130d840`). The server reads both
files only at start-up: restart it.

## 1. Object 1425 was empty (bank east door shows a gap when opened)
`Dat/obj.dat` had an empty `[OBJ1425]`, the open variant of door 1426 (map 1 spawns it at (79,55)). Rebuilt from the 1423/1424 pair and the
client's `init/localindex.dat` (`OBJ1425: GRHINDEX=26106`): `Puerta abierta`, `ObjType=6`, `IndexAbierta=1425`, `IndexCerrada=1426`,
`IndexCerradaLlave=1426`, `Llave=0`, `Cerrada=0`, plus en/pt/fr/it names. The client loads `Dat/Obj.dat` at start-up (`classic-ui.ts`, `renderer.ts`),
so a page reload shows the open sprite (graphic 26106 = `Graficos/15160.png`). Backup: `Obj.dat.orig-before-1425`.

## 2. Other empty or absent door objects restored from `obj - copia.dat`
Restored: 241, 242, 244, 245, 248, 249, 1235, 3598, 3599, 3600 (map doors on maps 62, 63, 171, 273, 112, 399, 774, 782 and their open/locked partners).
Backup: `Obj.dat.orig-before-copia-restore`. Still empty or absent, and NOT in `obj - copia.dat`: 1404, 1406, 1412, 1414, 1420, 1422, 1428, 1430, 1447, 1449, 1450, 1645
(referenced by maps 320, 500, 111, 112, 354, 100, 34, 78). Dangling: doors 3392 and 3393 point at 15403/15404, which exist nowhere.

## 3. Castle-entry triggers on building interiors (Carpintería, Finanzas and four more cannot be entered)
`GameLogic.DoTileEvents` treats map triggers 21..40 as `EMPEROR_CASTLE_ENTRY_n` and warps the walker back to `(x, y+1)` with locale message 2215 unless a
castle with that trigger exists. `Mapas/mapa1.csm` marks building interiors with 26, 27, 29, 31, 32, 33, so with no castle founded nobody can enter
(recordings: `tests/fixtures/vb6/buildings/*-castle-trigger-bounce.jsonl`). Patch: set those trigger values to 0 in place (file size unchanged,
408 tiles: 26 tailor, 27 alchemist, 29 bank, 31 house with door (62,66), 32 carpentry, 33 miner/smith). Backups: `mapa1.csm.orig-before-castle-triggers`
(29, 32) and `mapa1.csm.orig-before-castle-triggers-2` (the rest).

Not patched (proposal): the same triggers sit on city maps 4, 34 (Nix), 58-61, 65, 66 (Banderbill), 62, 64 (Lindos), 111, 112, 151, 156, 195, 196 (Arghal, Arkhein),
271, 354, 560, 561, 569, 590-592, 751-754, 776 and more. A server-side alternative that fixes all maps at once: only enforce the whitelist on tiles whose
trigger belongs to a founded castle.

Undo: copy each `*.orig-*` backup over its file and restart.
