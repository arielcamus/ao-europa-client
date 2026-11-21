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

# Client data patches (local assets only, never committed)

## 4. `init/*_localindex.dat` regenerated from the server Dat (quest text for quests 256..427)
The snapshot's `init/sp_localindex.dat` had `NUMQUESTS=255` and `[QUEST1..255]`, while the server's `Dat/Quests.DAT` has 427, so every newer quest (for example Makrom's 407,
"Una nueva aventura") showed as "Misión N" with no description in the quest forms. Regenerated 2026-11-21 in `~/Projects/ao-reference/Recursos` with the project's own tool:
`python3 tools/generar_localindex.py` (reads `Dat/{obj,npcs,quests,hechizos}.dat`, `init/NameMapa.dat` and the per-language `LocalMsg.dat`/`sugerencias.ini`, writes
`init/{sp,en,pt,fr,it}_localindex.dat`). Result: `NUMQUESTS=427` in `sp_localindex.dat`; `pt_`, `fr_` and `it_localindex.dat` are new files (the tool creates all five languages).
Because it rebuilds from the current `Dat/obj.dat`, the object patches of section 1 and 2 are included. Backup of the previous files (and of `FXs.ini` / `fxs.ind`) in
`~/Projects/ao-reference/Recursos-backup-20261121/`; undo = copy them back over `init/`. The client mount only serves `sp_localindex.dat`; the page reads it at start-up, so reload.

## 5. FX 153 (meditation aura) cannot be restored
The server sends the meditation effect as `MeditateToggle` fx = 153 for levels 1..12 (155 for 13..17, 157 for 18..24, 154/156/... for criminals; `FileIO.bas` defaults and
`Dat/Meditaciones.dat`). `init/FXs.ini` and `init/fxs.ind` have `NumFxs=150` in every copy on this Mac (the Recursos tree, `argentum-server*/resources/raw`, `argentum-elixir`), so FX 151 and above
have no animation definition anywhere and the aura is not drawn (the client renders nothing for an unknown FX, like the VB6 client). `generar_localindex.py` does not produce FXs.ini, and inventing
an `Animacion=` for 153 would be made-up data, so it is left alone. A complete `FXs.ini` from a full client install would fix it.

# wp04 (items-2) test data on the shared VB6 server DB (`C:\ao\server\Database.db`), applied 2026-11-21

One logged-out test character, TItems (user id 6, account 6, `items@local.test`). Backup taken first with the CLI (`.backup C:\ao\Database-before-items2.db`).
The server holds the file open and saves a character on logout, so every UPDATE below waits for `user.is_logged = 0`.

- **Key ring needs a patron account.** `LoadCharacterFromDB` only loads `house_key` for `IsPatreon` users and `EnviarLlaves` sends `UpdateUserKey` at login (before `Logged`).
  `update account set is_active_patron = 6057393 where id = 6;` (`patron_tier_aventurero`), `insert into house_key(key_obj, account_id) values (54, 6), (65, 6);`
  (objects 54 and 65 are "Llave casa Ullathorpe Nro: 01/02", clave 2 and 4; door "Puerta 1" 53, clave 2, is at map 1 (60,23), locked).
  Side effect: the tier unlocks more inventory rows for that account (slot 30 accepted a move; 42 is still refused).
  Undo: `update account set is_active_patron = 0 where id = 6; delete from house_key where account_id = 6 and key_obj in (54, 65);`
- **Position.** `update user set pos_map=1, pos_x=42, pos_y=53 where id=6 and is_logged=0;` (Cartelera "papiro" at map 1 (43,52); (59,24) for the door scene). Original: map 1, (77,49).
- **Slot 16 = 20 apples** (object 1) for the delete scenario: `update inventory_item set item_id=1, amount=20, is_equipped=0 where user_id=6 and number=16;`. Undo: `item_id=0, amount=0`.
- The recorder's "same slot" scenario (Moveitem 4 -> 4) empties slot 4 on the real server (it merges the stack into itself); restore with
  `update inventory_item set item_id=3684, amount=95 where user_id=6 and number=4;`. Slots 1, 17, 30, 42 were restored to 4335 x500 / empty / empty / empty.
