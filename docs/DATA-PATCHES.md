# Pre-HOO data pin (2026-11-21)

**Rule (Ariel): nothing made for the HOO client** (Heroes of Old, AO20's next-generation client; its assets are not public).
HOO work starts 2026-08-12 (server `0b9217ba`, client `547ca10`). The only Recursos Dat commit after that is `1b50fd6`
(2026-10-10, "Update DAT", 41 files), and it is the cause of the invisible shopkeepers: with it, 576 of 907 NPCs point at bodies
that the classic `init/cuerpos.dat` (last changed 2024-04-05) does not have, and the server logs 241 "NPC no existe" for spawns of
the 2024 maps (the NPC ids were renumbered). Its `obj.dat` is also where every door gap of sections 1 and 2 came from.

**The pin: `Dat/` at Recursos `2bfa51e` (2026-08-01)**, identical to `552d4ed`, the parent of `1b50fd6`: the 41 files at their
previous version, and the 17 files `1b50fd6` added removed (`EquipamientoInicial.dat`, `BlackSmithElementalRunes.dat`,
`UnderworldMapPool.dat`, `Collectiblecards.dat`, `BlockedWordsDescription.txt`, `obj - copia.dat`, `audios_generados*`, ...).
A copy is at `~/Projects/ao-reference/Recursos-prehoo/Dat` (the whole tree restored to `2bfa51e`, verified file by file).

What the pin gives:
- Every NPC body and head on the 2024 maps exists; 0 dangling NPC spawns (was 241). Ullathorpe sastre (Rethor, Amarie, Celyne),
  carpintería (Halving) and herrería (Khor, Onur) render (checked on a throwaway server, see below).
- **Sections 1 and 2 become unnecessary**: the pinned `obj.dat` has OBJ241, 242, 244, 245, 248, 249, 1235, 3598-3600, 1423-1426 with
  a non-empty OBJ1425, and also 1404, 1406, 1412, 1414, 1420, 1422, 1428, 1430, 1447, 1449, 1450 (only 1645 is absent, as before).
- Section 4 must be regenerated from the pinned Dat if quest text is wanted (the pin has 353 quests; the snapshot localindex has 255).

What it loses: the content added in October 2026 (375 NPC ids, 1,176 objects, 72 spells, 77 quests that only `1b50fd6` defines).
Pinned upstream gaps that remain: map objects 566, 567, 568, 570, 757, 759 (collectible cards), 20, 727, 1645 on 171 tiles; 4 NPC bodies
(NPCs 103, 425, 1271, 1294); `Quests.DAT` (from `640bea1`, 2026-05) names 42 NPCs, 107 objects and 10 spells the pinned
`npcs.dat`/`obj.dat` do not have, so those quests cannot be completed.

**Test on a throwaway copy (2026-11-21):** `C:\ao\server-prehoo` (copy of `C:\ao\server`, `server.exe` renamed
`server-prehoo.exe` because the server asks "more than 1 instance" when two `server.exe` run, `DatPath=.\Dat\`, `StartPort=7697`,
DB copied with `.backup`). It loaded and listened, no map errors, login and character creation worked. **It also logged 15 errors,
all from post-pin server code reading files the pre-HOO data does not have:** `TCP.LoadEquipSet` x13 (`EquipamientoInicial.dat`
is absent, so **new characters start with an empty inventory and no spells**), `ES.LoadBalance` (no `[ElementalMatrixForNpcs]`;
unused, no pinned NPC or object has `ElementalTags`) and `ES.LoadGuildsConfig` (clan levels config, `Clanes.dat` predates it).
Existing characters keep their items: 22 of the 23 object ids in the DB inventories have the same name in both sets
(3791 becomes "Boleto de viaje a Jourmut"); spell 352 "Orbe de Luz" does not exist at the pin.

**Status: NOT applied to the live server.** The code that expects the October files is itself post-pin (`caac3133`), so the clean
fix is a server rebuilt at the pre-HOO commit `9ccd7fad` (a manual twinBASIC step). Applying the data alone trades the invisible
NPCs for the empty starting kit.

To apply (when decided): stop `server.exe` (`taskkill /IM server.exe /F`), `Rename-Item C:\ao\Recursos\Dat Dat.bak-prehoo-<time>`,
copy the pinned `Dat` to `C:\ao\Recursos\Dat` (the server reads `DatPath=..\Recursos\Dat\`), start `C:/ao/start-server.ps1`
(~150 s). Mirror on this Mac: point `AO_ASSETS` at `~/Projects/ao-reference/Recursos-prehoo` (the client reads `Dat/Obj.dat`,
`Hechizos.dat`, `npcs.dat`, `zonas.dat` from there). Undo: stop the server, put `Dat.bak-prehoo-<time>` back, restart.
The throwaway copy is removed with `Remove-Item -Recurse C:\ao\server-prehoo`.

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

# combat-items (wave 3) test data on the shared VB6 server DB, applied 2026-11-21

Backup first: `.backup C:\ao\Database-before-combat-items.db` (VM). Reach the CLI over SSH (`ssh -i ~/Projects/ao-reference/runtime/ao-vm/id_ed25519 -p 2222 aobuilder@127.0.0.1 C:\ao\sqlite-cli\sqlite3.exe C:\ao\server\Database.db "<sql>"`). Every UPDATE waits for `user.is_logged = 0`.

- **Paralysed login** (`Aotesta`, user 2): `update user set is_paralyzed = 1 where id = 2;` then login. The server clears it itself (saved 0 on logout). Undo: `update user set is_paralyzed = 0 where id = 2;`.
- **Dead at the priest** (`Aotesta`): `update user set is_dead = 1, min_hp = 0, pos_map = 1, pos_x = 78, pos_y = 63 where id = 2;`. Undo (done): `update user set pos_map = 1, pos_x = 57, pos_y = 43 where id = 2;` (the revival restored `is_dead = 0, min_hp = 20`).
- **Spell scroll** (`TSpells`, user 4): `update inventory_item set amount = 1 where user_id = 4 and number = 13;` (object 2764, `UseItem` exits at amount 0). The use teaches spell 11 into spell slot 4 and empties slot 13. Undo (done): `update spell set spell_id = 0 where user_id = 4 and number = 4; update inventory_item set item_id = 2764, amount = 0 where user_id = 4 and number = 13;`.
- **GM spawns**: `/ACC` (CreateNPC, no respawn) near `Aotest`. 🔴 `/RMATA` without respawn (`KillNPCNoRespawn`) kills the *selected* NPC, native ones included: a cleanup loop removed 3 native snakes on map 2 and the priest Juan XXI (map 1, 78,66) until the next server start. They were replaced with `/RACC` (spawn with respawn) at nearly the same tiles (snakes at 48,40, 48,64 and 39,70 / 37,70 on map 2; the priest at 77,66). The recorder now only kills NPCs its own run spawned.
- Admin NPC safety: NPCs ignore GMs (`AI_NPC.EsObjetivoValido`, `MODULO_NPCs.CanAttackUser`) unless `/IGNORADO` (packet 204) toggled `AdminPerseguible`; even then a spawned snake did not attack `Aotest`. Real NPC attacks on a player come from the earlier `combat-spells-2` recordings (`NPCHitUser`, `NPCKillUser`).
- **Blind, dumb, stun cannot be reproduced with the current data**: no spell has `Ceguera=`/`Estupidez=`, no object has `Estupidiza` or a ranged-stun `Subtipo`/`Porcentaje` weapon (`SistemaCombate.UserDañoEspecial` is the only `WriteStunStart`/`WriteDumb` path for players besides spells). They stay injected in tests.

# Server data patches on the pre-HOO 9ccd server (`C:\ao\server-9ccd`)

## 6. Forgat home city pointed at open sea (new characters stuck on map 517)
Applied 2026-11-21 11:44 to the live 9ccd server's `C:\ao\server-9ccd\Dat\Ciudades.Dat` (the pinned file from Recursos `2bfa51e`). The
pinned server forces every new character's home to Forgat (`TCP.ConnectNewUser`, `.Hogar = cForgat`, TCP.bas:494), and the pinned
`[Forgat]` section put the spawn (`MAPA/X/Y` 517:48,65) and resurrection (`MapaResu/ResuX/ResuY` 517:65,69) on map 517 "Alta Mar": all
10000 tiles are water, no land, so the server refuses every step. A stale entry: the city is maps 750-759 ("Puerto de Forgat",
"Ciudad de Forgat"); map 751 is the only one with zone CIUDAD and its 20 NPCs (bank, priestess, shops).

Patch (only these six keys of `[Forgat]`; file length unchanged, 2357 bytes):

| Key | Pinned | Patched |
| --- | --- | --- |
| `MAPA`, `X`, `Y` | 517, 48, 65 | 751, 60, 57 (central square) |
| `MapaResu`, `ResuX`, `ResuY` | 517, 65, 69 | 751, 65, 70 (two tiles south of Xanthe, Sacerdotisa de Forgat, at 65,68) |

`MAPAVIAJE/ViajeX/ViajeY` (517:48,65) and `Mapas=517,518,153` are left as pinned: no obvious dock to point the boat arrival at.
Tile check (pinned `Mapa751.csm`, `parseMap` plus the server's `General.HayAgua` graphic ranges, NPC and tile-exit sections read as
in `FileIO.CargarMapaFormatoCSM`): both tiles and their 3x3 neighbourhoods are not blocked, not water, trigger 0, no tile exit, no NPC,
and both sit in the same 4461-tile walkable region. sha256 pinned `a0bdd6a9d9e0f83e1756c588d70e7b60a9f784702c8423086564d68169dc3103`,
patched `3da1206955c040bff1613f70ea8657a46759b9e04bffd3aaf2a506d858d27e56` (allowlisted in `tools/provenance/sources.lock.json`
`patches.active`). Only the VM copy is patched; the client does not read `Ciudades.Dat`.

Characters created before the patch keep their saved position on map 517. Move one with the server stopped, or while it is logged out:
`update user set pos_map=751,pos_x=60,pos_y=57 where name='<name>' and is_logged=0;`.

Undo: stop the server, `Copy-Item C:\ao\server-9ccd\Dat\Ciudades.Dat.bak-forgat-20261121-1144 C:\ao\server-9ccd\Dat\Ciudades.Dat`,
start `C:/ao/start-server.ps1` (the server reads `Ciudades.Dat` only at start-up; load ~5 min).

## 7. Lindos home city pointed at open sea too (prepared 2026-11-21 for the home-city build, not live yet)
Ariel (2026-11-21 15:34): hide Forgat, let new characters choose their starting city. The server backport that honours the choice
(see [SERVER-PREHOO-BUILD.md](SERVER-PREHOO-BUILD.md), "Home city choice") accepts Ullathorpe, Nix, Banderbill, Lindos and Arghal, so
each of their `Ciudades.Dat` spawn and resurrection tiles was checked the same way as section 6 (pinned `MapaN.csm`, the server's water
rule from `FileIO.CargarMapaFormatoCSM`: `General.HayAgua` on layer 1, cleared by a layer-2 graphic, set again by triggers 8, 11, 16, 18;
then `GameLogic.LegalPos` for a walker: walk box x 12..89 / y 10..91, no map NPC, no water, not blocked on all four sides):

| City | Spawn (`MAPA:X,Y`) | Resurrection (`MapaResu:ResuX,ResuY`) | Result |
| --- | --- | --- | --- |
| Ullathorpe | 1:57,44, 3x3 all legal, 5150-tile region | 1:77,66 (trigger 20) | land |
| Nix | 34:40,87, 3x3 all legal, 5125 tiles | 34:25,55 (trigger 29) | land |
| Banderbill | 59:47,41, 7/9 legal, 4250 tiles | 319:49,24 (Iglesia de Banderbill) | land |
| Arghal | 151:61,43, 8/9 legal, 4928 tiles | 151:52,58 (trigger 22) | land |
| **Lindos** | **408:63,39, map "Mar del Norte", water, 0/9 legal** | **409:52,47, "Mar del Norte", water** | **at sea** |

Lindos is a stale entry like Forgat: the city is maps 62 and 64 ("Ciudad de Lindos", zone CIUDAD) and 63 ("Bahia de Lindos"); map 64
has the Sacerdote (51,41), the bank and the Gobernadora. Patch (six keys of `[Lindos]`; the file shrinks by 2 bytes, 2357 to 2355):

| Key | Pinned | Patched |
| --- | --- | --- |
| `MAPA`, `X`, `Y` | 408, 63, 39 | 64, 50, 59 (the open square in front of the Templo; the tile and its 3x3 are legal, `Blocked` 0, trigger 0, no exit) |
| `MapaResu`, `ResuX`, `ResuY` | 409, 52, 47 | 64, 51, 44 (inside the Templo, three tiles south of the Sacerdote, trigger 22; same 2160-tile region as the spawn) |

`MAPAVIAJE/ViajeX/ViajeY`, `NecesitaNave=1` and `Mapas=408,409,297` stay as pinned. The section 6 Forgat patch is kept (characters
already in Forgat keep their home; Forgat is only hidden from creation). sha256: base (section 6 file)
`3da1206955c040bff1613f70ea8657a46759b9e04bffd3aaf2a506d858d27e56`, patched `8ced6ca346a8a46fe52314296b188e989936c50c597114a8e1982835f6ee7ca2`.

Where it is: only `C:\ao\server-9ccd-b\Dat\Ciudades.Dat` (the side-by-side build directory). The live `C:\ao\server-9ccd\Dat` is
untouched until the swap; the swap copies this file over the live one (backup first). Checked live on 7697 on 2026-11-21: a new
character with home 4 appeared at 64:50,59 and walked (6/6 steps), also through the browser client. Undo after the swap: copy the
backup `Ciudades.Dat.bak-homecity-<TS>` back and restart (the server reads `Ciudades.Dat` only at start-up).
