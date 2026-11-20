# Server data patches (Ullathorpe buildings)

Applied 2026-11-20 to `C:\ao\Recursos` in the VM and to `~/Projects/ao-reference/Recursos`. Re-apply to a fresh install with
`python3 tools/data-patches/apply-buildings-patches.py <Recursos dir>` (idempotent, makes `*.orig-buildings` backups, byte-identical to the
hand-applied obj.dat result, md5 `e4818263d8c0d6d0bdc61188d8550dbb`). Since the server fix (section 3) it only touches `obj.dat`; `--zero-castle-triggers` re-applies the old map patch. The server reads both
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

## 3. Castle-entry triggers on building interiors: fixed in the server, map patch SUPERSEDED
`GameLogic.DoTileEvents` treats map triggers 21..40 as `EMPEROR_CASTLE_ENTRY_n` and warped the walker back to `(x, y+1)` with locale message 2215 unless a
castle with that trigger existed, so every building interior marked 26, 27, 29, 31, 32, 33 in `mapa1.csm` (and many on other city maps) was closed
(recordings: `tests/fixtures/vb6/buildings/*-castle-trigger-bounce.jsonl`). Interim data patch: zero those triggers in mapa1.csm (408 tiles).
Final fix: vm-server 7b7ecbf, `ModCastle.CheckCastleEntryWhiteList` returns True when no founded castle owns the trigger. Verified live on Ciudad de Nix (map 34),
building x37-44,y42-47 with trigger 24, door (43,47): walking in is not bounced (`nix-building-castle-trigger-enters.jsonl`, no message 2215).
`mapa1.csm` was restored to the pristine file (md5 `d4390a09c36d1a5e5c2c4760fee5bdd8`) in both copies; the server keeps the zeroed map in memory until its next restart.

Placing a character for such a test: the server holds `Database.db` open, so do not replace the file. Copy `sqlite3.exe` (sqlite-tools-win-x64) to the VM and run
`sqlite3.exe C:\ao\server\Database.db ".read file.sql"` with `update user set pos_map=34,pos_x=43,pos_y=50 where id=2 and is_logged=0;`.
Undo: the same update with the original position (Aotesta: map 1, 58, 43). The CLI lives in `C:\ao\sqlite-cli` on the VM.

Backups of the interim patch: `mapa1.csm.orig-before-castle-triggers` (the pristine file) and `mapa1.csm.orig-before-castle-triggers-2`. Undo of the whole document: copy each `*.orig-*` backup over its file and restart.
