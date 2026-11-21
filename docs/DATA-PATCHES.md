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

## 5. FX 153-172 (meditation aura): no art in the pre-HOO data; client draws the classic FX 115-119 (proposal for a server data patch, NOT applied)
`Dat/Meditaciones.dat` (read by the server's `FileIO.LoadMeditations`, start-up only) makes the server send `MeditateToggle` fx = 153 for levels 1..12, 155 for 13..17, 157 for 18..24, 159 (25..28),
161 (29..32), 163 (33..36), 165 (37..39), 167 (40..42), 169 (43..44), 171 (45..46) and 120 from 47, with 154/156/.../172 for criminals. `init/FXs.ini` and `init/fxs.ind` have `NumFxs=150` (upstream too, last changed 2024-04),
so the pinned client has no animation for 151 and above and draws nothing. The classic meditation art is FX 115-120 (`Recursos.LoadComposedFx` maps them to the meditation animation; the server used them as `e_Meditaciones`
before Dec 2025: 1-14 -> 115, 15-24 -> 116, 25-35 -> 117, 36-44 -> 118, 45-46 -> 119, 47+ -> 120).

**Client (done):** `apps/web/src/meditation-fx.ts` draws an id missing from `FXs.ini` as the classic art of its tier, through the meditation animation path (+4, alpha 180). FX 115-119 are IsPNG=0 palette art, drawn additive
(the classic 0.13 look, so the character shows through); FX 120 keeps the pinned normal blend. The 10 server tiers do not line up with the classic ones at levels 13-14 (tier 13-17 mixes 115 and 116) and 33-35 (tier 33-36 mixes 117 and 118), so each tier takes the majority art (13-17 -> 116, 33-36 -> 117).

**Proposal (data only, nothing applied to the live server):** the file can make the server send 115-120 directly, with the same two tier ambiguities (the keys are the server's 10 tiers; the tier boundaries live in `Protocol.HandleMeditate`, not in the file). Replace in `C:\ao\Recursos\Dat\Meditaciones.dat`:
```
[FXsMEDITATIONSBYLEVEL]            [FXsMEDITATIONSCRIMINALBYLEVEL]  (same value on each criminal key)
MeditationLevel1to12=115           MeditationCriminalLevel1to12=115
MeditationLevel13to17=116          MeditationCriminalLevel13to17=116
MeditationLevel18to24=116          MeditationCriminalLevel18to24=116
MeditationLevel25to28=117          MeditationCriminalLevel25to28=117
MeditationLevel29to32=117          MeditationCriminalLevel29to32=117
MeditationLevel33to36=117          MeditationCriminalLevel33to36=117
MeditationLevel37to39=118          MeditationCriminalLevel37to39=118
MeditationLevel40to42=118          MeditationCriminalLevel40to42=118
MeditationLevel43to44=118          MeditationCriminalLevel43to44=118
MeditationLevel45to46=119          MeditationCriminalLevel45to46=119
MeditationLevelMax=120 (unchanged)
```
Restart the server to load it (`LoadMeditations` runs at start-up). The client then receives ids that `FXs.ini` has and draws them as sent, identical to the substitution above. Undo: put the previous file back (keep a `.bak`) and restart.
Exact classic tiers would need a code change (`HandleMeditate` ranges), which is not data.

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

## 8. Newbie Dungeon signposting, Makrom's quests on every Cartelera, broken newbie quests repaired (live 2026-11-21 18:47)
Ariel (2026-11-21 18:28) chose option (c) of the newbie-content report: Forgat stays hidden, levels 1-12 go through the Newbie
Dungeon (maps 168, 37, 167, 264; `restrict_mode` bit 1, `LimiteNewbie = 12`), with clear signposting. Data only, pre-HOO only
(nothing from Recursos `1b50fd6` or later; every replacement uses a creature, item or text already in the pinned data). Rates:
Ariel (19:15, then 19:20) set EXP x4, RECOLECCIÓN x2, ORO x1 (`DropMult` unchanged); applied in a second restart, see "Rates" below.

Applied with `python3 tools/data-patches/apply-newbie-patches.py --dat <Dat> --maps <Mapas> --client-init <init> --config <Configuracion.ini>` (idempotent; `--check`
prints the edits without writing). Live: `C:\ao\server-9ccd\Dat` (the server's `DatPath`) and `C:\ao\Recursos\Mapas` (its `MapPath`),
then one restart (in-game `/RMSG` 60 s warning, `/GRABAR`, `Stop-Process` of `server-9ccd-b.exe`,
`powershell -ExecutionPolicy Bypass -File C:\ao\start-server.ps1`; listening again after ~2 min). The same files were copied to
`~/Projects/ao-reference/Recursos-prehoo` so the live data and the browser client's `AO_ASSETS` stay byte-identical.

### What changed (line numbers are in the pre-patch file)

| File | Lines | Before | After | Why |
| --- | --- | --- | --- | --- |
| `Dat/Ciudades.Dat` `[Renacimiento]` | 146-148 | `X=48`, `Y=62`, `MAPA=517` | `X=58`, `Y=44`, `MAPA=1` | `QuitarNewbieObj` (InvUsuario.bas 196) warps EVERY character that reaches level 13 to this point, wherever it is. Map 517 "Alta Mar" is open sea: a GM landing on (48,62) could not take a single step in any direction. (1,58,44) is one tile from the Ullathorpe spawn, inside its 3x3 legal block (section 7). Not the spawn tile itself: `WarpUserChar` does no legal-position search, so a new character and a graduate would stack. **Since the -c server (third restart) nothing reads `[Renacimiento]`**: graduates on a newbie map go to their own home city, elsewhere they stay put (code change, SERVER-PREHOO-BUILD.md "Newbie graduation"). The line stays: harmless, and the -b rollback needs it on land |
| `Dat/Motd.ini` | 33 | `NumLines=10` | `NumLines=11` | one more line |
| | 43 | `Line9=* Rates de esta Temporada: EXP X4 - RECOLECCIÓN X2 - ORO X1~0~255~0~1~0` | the same text (between the two restarts it read "Rates del servidor: EXP X1 - RECOLECCIÓN X1 - ORO X1") | the line was false while the server ran at x1; it is true again now that `Configuracion.ini` matches it (Rates, below) |
| | 44 | `Line10=* ¡Esta Temporada finalizará el día 30 de Abril!` | `Line10=* ¿Eres nuevo? Hasta el nivel 12 entrena en el Dungeon Newbie: su entrada está en tu ciudad.` | stale season line replaced by the newbie pointer |
| | (new) 45 | - | `Line11=* Busca la Cartelera de tu ciudad y toma los encargos de Makrom. Al llegar a nivel 13 dejarás de ser Newbie: si estás en el Dungeon Newbie, volverás a tu ciudad.` | where the quests are, and what happens at 13 with the -c server. Between the first and third restarts it said "...y viajarás a Ullathorpe", true for the -b server |
| `Dat/npcs.dat` `[NPC1331]` Cartelera <Quest> | 18396, 18402-18408, + 6 keys | `Desc=Parece tener varios encargos para cumplir`, `NumQuest=4` (154, 163, 164, 165) | `Desc=Encargos para aventureros. Si eres nuevo por aquí, toma los encargos de Makrom y entrena en el Dungeon Newbie, su entrada está en esta misma ciudad.`, `NumQuest=10`: 190, 191, 192, 193, 194, 4, then 154, 163, 164, 165 (`en_desc` translated likewise) | Makrom's chain on the board of every city that has one (Ullathorpe 60,56; Nix 66,69; Banderbill 51,31; Arghal 56,34; also Arkhein and Morgrim) |
| `Dat/npcs.dat` `[NPC502]` Serpiente | 3193 | `DropQuest1=9-2492-1-1` | `DropQuest1=4-2492-1-1` | quest 4 ("Veneno mortal", L1: 10 snakes + 10 `Fluido de serpiente`) could never finish: the fluid drops only for a player holding quest 9, which is an empty section. The newbie report called quest 4 doable; it was not |
| `Mapas/Mapa64.csm` (Lindos) | NPC block | 10 NPCs | 11: `NPC 1331` at (52,57) | Lindos had no Cartelera. Same NPC definition and body (4124) as the other cities; (52,57) is 2 tiles NE of the Lindos spawn (64:50,59), not blocked, no trigger, exit, object or NPC, off the walk to the dungeon. Header `NumeroNPCs` 10 -> 11 and 6 bytes inserted before the tile-exit block; blocks, layers, objects and exits unchanged (checked by re-parsing) |
| `Dat/Quests.DAT` `[QUEST193]` El Gran lobo feroz | 4657-4670 | `RequiredLevel=2`, `RequiredOBJs=1`, `RequiredObj1=453-1 'Piel de Wolfang` | `RequiredLevel=6`, `RequiredNPCs=1`, `RequiredNpc1=965-1`, no object; Desc "Acaba con él y tráeme su piel" -> "Acaba con él" | obj 453 is an empty section pre-HOO and nothing drops it (only HOO defines it, so it is not copied). Killing the Wolfang (NPC 965, one per newbie map 37/167/264) is what the text asks. Level 6 instead of 2: the pre-HOO Wolfang has 250 HP and hits 20-25, two hits kill a level-2 character. Unblocks [194] |
| `[QUEST194]` Wolfang | 4688-4689 | English text in the Spanish fields | `Desc=Ha llegado la hora... ¡Enfréntate a los Wolfang y libera nuestro Dungeon!`, `DescFinal=¡Te estaré eternamente agradecido!` | the Spanish client showed English |
| `[QUEST41]` Colmillos de Fuego (Heather, L5) | 994-995, 999-1002, 1004-1005 | `RequiredNpc1=576-25`, `PosMap=35`, orange snakes near Nix | `RequiredNpc1=935-25`, `PosMap=167`, red snakes in the Dungeon Newbie Sur | NPC 576 is an empty `'Libre` slot pre-HOO, so nobody could finish it, and it heads a 6-quest chain (41 -> 42 -> 43 -> 14 -> 114 -> 117 -> 163). 935 "Serpiente Collet" (header comment "Serpiente Roja", 30 HP, poisonous) is the closest existing creature and the level-5 tier of the newbie dungeon (15 on map 167). Typo `contralada` fixed |
| `[QUEST42]` Un problema gigante (L8) | 1018, 1023, 1026, 1029 | `RequiredNpc1=611-16` (Murciélago Gigante, 750 HP, hits 70-80, only in two Drenaje maps), `PosMap=35` | `RequiredNpc1=500-16` (Lobo de Dungeon Newbie, 60 HP), `PosMap=37`, text: "los lobos de la caverna" | a level-8 quest whose target kills a level-8 character in two hits and lives far away. The newbie wolf is plentiful on maps 37, 264 and 167 |
| `[QUEST40]` Camino a Ullathorpe (L7) | 966, 971, 974, 980 | `RequiredNpc1=678-30` (Esqueleto agresor, 10,000 HP, hits 60-80), `PosMap=508` (open sea) | `RequiredNpc1=514-15` (Esqueleto, 350 HP, hits 12-15, 8 on map 12), `PosMap=12`, text: "Bosque Este de Ullathorpe" | the level-7 target was a 10,000 HP monster on a Jourmut map; 15 instead of 30 because map 12 holds 8 |
| `[QUEST190]` Primeros Pasos | 4571 | "Este lugar esta repleto..." | "El Dungeon Newbie, cuya entrada está en tu ciudad, está repleto..." | taken at a city board, "este lugar" pointed nowhere |
| `[QUEST4]`, `[QUEST191]`, `[QUEST192]` | 138, +4624, +4655 | `PosMap=44`, none, none | `PosMap=168`, `264`, `167` | the map the quest window points at: where the targets live |

English (`en_`) fields of 40, 41, 42 and 193 were rewritten the same way; the pt/fr/it fields were left as they were.

### Client text (local assets, not committed)
The NPC dialog (`NPCDESC*<n>`) and the quest window take their text from the client's `init/sp_localindex.dat`, not from the server.
The pinned client index is older than the pinned server Dat: its `[NPC1331]` is "Meren <Quest>, ¡Dragones al Sureste, cuidado!", and
`[QUEST40]`/`[QUEST41]` are "Camino a Penthar" and "¿Doble cabeza, doble veneno?". The script rewrites `[NPC1331]` (NAME, DESC, BODY 4124,
HEAD 0) and `[QUEST4]`, `[QUEST40..42]`, `[QUEST190..194]` (DESC, DESCFINAL, NEXTQUEST, NOMBRE, POSMAP, REPETIBLE, REQUIREDLEVEL) from the
patched server files, in `~/Projects/ao-reference/Recursos-prehoo/init/sp_localindex.dat` (sha256 `ae2de371...` -> `44ac1f43...`). The
play site reads it at page load, so a reload shows it; it was not restarted. Heather's client text already says "si ya has
completado las misiones del Newbie Dungeon, tengo un obsequio para ti", so `[NPC415]` is untouched. The rest of the index is still
out of sync with the server Dat (proposal: regenerate it from the pinned Dat, section 4).

### Hashes (sha256)
| File | Before | After |
| --- | --- | --- |
| `Dat/Ciudades.Dat` (VM only) | `8ced6ca346a8a46fe52314296b188e989936c50c597114a8e1982835f6ee7ca2` | `2d5d27147c0cf9c54838475e94618fca34dc97a95c543120d48cc487adadf3d0` |
| `Dat/Motd.ini` | `01b55ceedba73c015b03d631367233d9820e1c38915ca928c13ca4579fa4bc3a` | `55d5bac4c99b72fb813f521ff9b51a48b9daed5bfe2b7ae9385d74dadbd077a8` (first restart: `1b48b22a...`, X1 rates; second: `df7e3479...`, old Line11) |
| `Configuracion.ini` (VM only, server root) | `585b5994aacc369838e644ada77399aa0813bdb367a019503d9e48563172a200` | `1060ea77aa05d375000594a986ed6642fbbff59eeb72d892a07598a3dc66e13a` |
| `Dat/npcs.dat` | `68ad6d0810bca761e300ed70ac05d66658a4d086e60bc2a8e4d7672237156940` | `8fd35c84496578954f2906e614dc3b1970a22935f21f3036a05ea58168ba1e26` |
| `Dat/Quests.DAT` | `4e7881a0a993488cedb52a4b05af023c5abef94c2afca855c521ca5cf7a9a4a3` | `455c5753acf2ea0540da3dae36ed73d9dd8640e9a27971dd3f4b56166e0b87c4` |
| `Mapas/Mapa64.csm` | `3100a5cd270414f12eac0524943d993d08140aa8fe0d79726767fdcebe87bc0e` | `8186968a9c01c9e0dd656d9191ef0666976092e9b9150e02314cb66e9f78cf20` |
| `init/sp_localindex.dat` (Mac only) | `ae2de37104d003f108b4256fe9704ffec3966fc084059d0c9de03fe75a67ca74` | `44ac1f437b54ed8778bb18531dd966b66524116b596e324e6f33267586335ceb` |

The client-consumed ones are listed in `tools/provenance/sources.lock.json` `patches.active`.

### Verified live (2026-11-21, after the restart)
- Before the change: a GM `/TELEP YO 517 48 62` could not move in any of the 4 directions; `/TELEP YO 1 58 44` moved in all 4. (`/TELEP
  <other user>` is refused with Msg948 outside event maps for every GM: `If .flags.Privilegios And e_PlayerType.Consejero Or e_PlayerType.SemiDios`
  in `Protocol_GmCommands.bas` is always true. Server bug, not touched.)
- A fresh level-1 warrior created in each of the 5 start cities received the 11 MOTD lines (rates line and both newbie lines), walked to
  the Cartelera (Lindos: the new one at 52,57), got `NPCDESC*1331` and a quest list of 190 (available), 191, 192, 193, 194 (level-locked),
  4 (available), 154, 163, 164, 165; accepted 190 (Msg1264), and walked through the city's door into the Newbie Dungeon: Ullathorpe
  1:(74,22) -> 168, Nix 34:(59,78) -> 168, Banderbill 59:(60,42) -> 168, Lindos 64 -> 62:(63,41) -> 168, Arghal 151:(46,40) -> 264.
- Graduation with the -b server (first and second restarts): a level-1 test character standing in map 168 was set to level 12 (`/MOD <name> LEVEL 12`) and given experience
  (`/MOD <name> EXP 200000`): Msg671 "Has dejado de ser Newbie", then it stood at 1:(58,44) and walked in all 4 directions. With the
  -c server (third restart, 20:20) a graduate in the Newbie Dungeon lands in its own home city and one elsewhere stays put
  (SERVER-PREHOO-BUILD.md, "Newbie graduation").
- No server error log after the restart (`C:\ao\server-9ccd\Logs\Errores` empty).

### Rates (second restart, 2026-11-21 19:37)
`C:\ao\server-9ccd\Configuracion.ini` `[CONFIGURACIONES]`: `ExpMult=1` -> `4`, `RecoleccionMult=1` -> `2`; `OroMult=1` and `DropMult=1`
unchanged (lines 31-34 of the file). Read at start-up through `SvrConfig.GetValue`, so it needed a restart: same protocol (`/RMSG` 60 s,
`/GRABAR`, stop, start script); listening again after ~1.5 min, no error log. `Motd.ini` Line9 back to
`* Rates de esta Temporada: EXP X4 - RECOLECCIÓN X2 - ORO X1~0~255~0~1~0` (Windows-1252); no end-of-season line.

Where the multipliers act (9ccd code): `ExpMult` multiplies combat experience per point of damage (`SistemaCombate.GetExpForUser`:
damage x `GiveEXP` / `MaxHP` x `ExpMult`, so a full kill at a level with no penalty gives `GiveEXP` x `ExpMult`), quest `RewardEXP`
(`ModQuest`) and the skill-up bonus (5 x `ExpMult`). `RecoleccionMult` multiplies the amount of each successful chop
(`ModLumberjack.ChopWood`) and mine swing (`ModMining`), and the fishing bonus (`modFishing`); nothing else.

Verification (level-1/2 warrior in map 168, kills with no skill-up in the same window, experience read from `UpdateExp`):
- EXP x4 **confirmed**. Before (ExpMult 1): a Murciélago (`GiveEXP=18`) kill gave +18. After (ExpMult 4): Serpiente (22) +88, Rata (18)
  +72 (once +73, the fractional remainder `ExpCount` carries), Hormiga (11) +44: `GiveEXP` x 4 in every case. The skill-up bonus message
  (Msg140) reads 20 instead of 5. The MOTD a fresh character receives now carries the X4/X2/X1 line.
- RECOLECCIÓN x2: **set and read back** (`RecoleccionMult=2` in the file the server loads), **not observed live**. A level-1 Trabajador
  starts with no tool; with an Hacha de Leñador (obj 127) put in a test worker's empty slot through the DB and equipped, 3 minutes of
  `WorkLeftClick` on the tree at Ullathorpe (50,43) produced no chop and no message at RecoleccionMult 1, so there was no baseline to
  double (the axe was removed again; the GM-created one too). Cheapest check: one successful chop by a Trabajador, which gets exactly
  `GetExtractResourceForLevel(ELV) x RecoleccionMult` (no randomness) and shows it as the `+N` over the character.

### Undo
Rates only: `Copy-Item C:\ao\server-9ccd\Configuracion.ini.bak-20261121-newbie C:\ao\server-9ccd\Configuracion.ini -Force` and
`Copy-Item C:\ao\server-9ccd\Dat\Motd.ini.bak-20261121-rates C:\ao\server-9ccd\Dat\Motd.ini -Force` (the X1 text), restart.
Everything: server (VM), then restart as above (every file is read only at start-up):
```
$s='.bak-20261121-newbie'
foreach($f in 'Ciudades.Dat','Motd.ini','npcs.dat','Quests.DAT'){ Copy-Item "C:\ao\server-9ccd\Dat\$f$s" "C:\ao\server-9ccd\Dat\$f" -Force }
Copy-Item "C:\ao\server-9ccd\Configuracion.ini$s" C:\ao\server-9ccd\Configuracion.ini -Force
Copy-Item "C:\ao\Recursos\Mapas\Mapa64.csm$s" C:\ao\Recursos\Mapas\Mapa64.csm -Force
```
Database backup taken before the restart: `C:\ao\server-9ccd\Database.db.bak-20261121-newbie` (sqlite `.backup`; only needed if the
restart had damaged it, it did not). Mac: copy `~/Projects/ao-reference/Recursos-prehoo-backup-20261121-newbie/{Dat,init,Mapas}/*` back
over `~/Projects/ao-reference/Recursos-prehoo/`. Characters that already took a changed quest keep its progress slots; the server reads
the requirement list from `Quests.DAT` at start-up, so an undo re-breaks 41/42/193 for them.
