# Server rebuilt at the pre-HOO commit (9ccd7fad)

Decision (Ariel, 2026-11-21 10:20): the base becomes the original VB6 server rebuilt at the last commit before HOO work
(`argentum-online-server-classic` `9ccd7fad`, 2026-08-10, the pin in `tools/provenance/sources.lock.json`), with the pre-HOO data
(Recursos `2bfa51e`). Post-pin content that can be drawn comes back later as documented patches. This page covers the prep;
the twinBASIC compile and the swap are manual steps.

**Status 2026-11-21: prepared, not built, not swapped.** Everything sits in `C:\ao\server-9ccd` on the VM. The exact GUI and swap
commands are in `C:\ao\server-9ccd\BUILD-STEPS.txt` (summarised below). The live server (`C:\ao\server`, caac3133, port 7667) was
not touched.

## Next step

Open `C:\ao\server-9ccd\Server.VBP` in twinBASIC and build it to `C:\ao\server-9ccd\server-9ccd.exe` (section "Build"), then run it
on port 7697 next to the live server and log in.

## What is in `C:\ao\server-9ccd`

| Item | Source |
| --- | --- |
| Server source and binaries | upstream at `9ccd7fad` + our patches ([docs/patches/2026-11-21-server-9ccd7fad-build.patch](patches/2026-11-21-server-9ccd7fad-build.patch), also `PATCHES-9ccd-build.patch` in the dir). The DLLs/OCXs are byte-identical to caac3133's, so nothing needs registering. |
| `Dat\` | Recursos `2bfa51e` `Dat/`, 58 files, every sha256 matches `tools/provenance/recursos-pin.sha256` (PR #54). Copied from `~/Projects/ao-reference/Recursos-prehoo/Dat`. |
| Maps | `MapPath=..\Recursos\Mapas\`. The VM's `C:\ao\Recursos\Mapas` matches the pinned manifest on all 843 files (plus two `mapa1.csm.orig-*` backups). The server reads no `init/` file; `init/` matters only to the client (`Recursos-prehoo/init`). |
| `Server.ini` | the live file (same `[Admines]`, `Admin2=Aotest|aotest@local.test`) with `StartPort=7697` and `DatPath=.\Dat\`. |
| `Configuracion.ini`, `feature_toggle.ini`, `intervalos.ini` | the 9ccd7fad versions. The live ones are exactly caac3133's `Example.*` files (no local edits), and caac adds HOO toggles (`hoo-adjacent-characters-v1`, `hoo-remort-v1`, ...). |
| `Database.db` | `.backup` of the live DB taken 2026-11-21 ~10:45, with spell 352 cleared (see DB). For the 7697 test only; the swap takes a fresh copy. |

On the Mac the patched tree is a detached worktree, `~/Projects/ao-reference/runtime/server-classic-9ccd` (`git diff` there is
the patch). Applying the patch to a pristine `9ccd7fad` checkout was checked with `git apply --check`.

## Patches

The live `C:\ao\server\Codigo` was diffed against upstream caac3133: it differs in exactly 21 files plus `clsProgressBar.cls`,
`Server.VBP` and one ScriptsDB file, and replaying the committed `scripts/vm/patches/*` (vm-server branch) in order on caac3133
reproduces the live Codigo byte for byte. Each was then carried to 9ccd7fad (`git apply`, else a three-way merge, conflicts by hand):

| # | Patch | On 9ccd7fad |
| --- | --- | --- |
| 1 | `twinbasic-compile`: bare `Return` → `Exit Function` (Modulo_UsUaRiOs), `PacketCount`/`Invasion` parameter renames (TCP, modNetwork, DisconnectDiagnostics, Protocol_Writes) | clean |
| 2 | `progressbar-replacement`: `clsProgressBar.cls` instead of the unlicensed comctl32 ProgressBar in frmCargando, FrmStat, frmDbControl; comctl32 line out of Server.VBP | clean (these files are identical at both commits) |
| 3 | `inimanager-swap`: member-wise `SwapMainNodes` in clsIniManager | clean (identical file) |
| 4 | `characterpersistence-dbgstep`: 151 `dbgStep` markers | **not carried**: debugging instrumentation only. Regenerate if a load error has to be located again. |
| 5 | `recordset-field-coercion`: `CLng`/`CStr`/`CByte` around ADO fields used as subscripts, typed args, ParamArray | ModCastle, ModGlobalQuests, clsClan, modDatabase merged clean. CharacterPersistence re-applied by hand: 2 conflicts where 9ccd has the older bank/pets code (`With .BancoInvent.Object(CLng(RS!Number))`, pets without the range check caac added). One extra coercion that only exists at 9ccd: `.ObjIndex = IIf(CLng(RS!item_id) <= UBound(ObjData), CLng(RS!item_id), 0)` (bank and inventory). |
| 6 | `neutralise-asserts-busytimeout`: unconditional `Debug.Assert False` commented, `PRAGMA busy_timeout = 5000` | clean except: FileIO (one of the two asserts lives in `ValidateHomeCostTiers`, which does not exist at 9ccd), ModUnderworld (2 conflicts: 9ccd has `Exit Sub` where caac has `TraceError`; kept 9ccd's code, assert commented). No unconditional assert is left outside UnitTesting and `ScenarioNavalBoarding.cls:904` (also left on live). |
| 7 | Server.VBP: `MSINET.OCX` line removed, `DIRECT_PLAY = 0` added to `CondComp` | clean (three-way merge) |
| 8 | ScriptsDB `20260724-01-change first castle coordinate val.sql`: leading `--` comment removed (`RunScriptInFile` strips CR/LF, so the comment swallowed the UPDATE) | same file at 9ccd; only matters for a fresh DB |
| 9 | **Upstream bug fix**, `castle-whitelist-only-when-founded`: `ModCastle.CheckCastleEntryWhiteList` returns True when no founded castle owns the trigger. Triggers 21..40 are also on ordinary building interiors, so without a founded castle nobody could enter those buildings (DATA-PATCHES.md section 3). | clean |
| 10 | **Upstream bug fix**, new: `Protocol.HandleLoginNewChar` (the `#ElseIf PYMMO = 0` version) | see below |

### Upstream bug fix: HandleLoginNewChar used the connection id as a user index

The dispatcher calls `HandleLoginNewChar(ConnectionID)`, but the `PYMMO = 0` version was declared
`Private Sub HandleLoginNewChar(ByVal UserIndex As Integer)` and used it as a `UserList` index. Whenever a connection id differs
from its user slot, it read and wrote someone else's slot: character creation sometimes got no answer, and `CloseSocket` could kick
a logged-in player in that slot. **9ccd7fad has the bug** (Protocol.bas line 1424), and so does caac3133 (line 1845), i.e. the live
server. The fix mirrors `HandleLoginExistingChar`:

```vb
Private Sub HandleLoginNewChar(ByVal ConnectionID As Long)
        On Error GoTo ErrHandler
        Dim UserIndex As Integer
        UserIndex = Mapping(ConnectionID).UserRef.ArrayIndex
        If UserIndex < 1 Then
            Call KickConnection(ConnectionID)
            Exit Sub
        End If
        ' rest of the body unchanged
```

Other handlers the dispatcher calls with `ConnectionID` (9ccd7fad): `HandleLoginExistingChar`, `HandleCreateAccount`,
`HandleLoginAccount`, `HandleDeleteCharacter`. All four take `ByVal ConnectionID As Long` and map it (`MapConnectionToUser` or
`Mapping(...).UserRef.ArrayIndex`), so no other mix-up. Two observations, not changed: the `PYMMO = 0` `HandleLoginExistingChar`
has no `UserIndex < 1` guard (an unmapped connection would touch `UserList(0)`), and `HandleDeleteCharacter` is an empty stub
that does not read its payload.

### Static checks done on the merged tree (no compiler)

- No bare `Return` and no `GoSub` anywhere.
- Every RS!/Result!/RS2! use on a line that exists only at 9ccd was read; none is a subscript, typed argument or ParamArray
  argument without a coercion.
- Not checkable without the compiler: new twinBASIC diagnostics in code that only exists at 9ccd. Most of 9ccd's code is a
  subset of caac's (caac adds `modAdjacentTopology`, `modAutoCombat`, `modNpcCrossMapPursuit` and the `Unit_*` tests for them).

## Starting kit at 9ccd7fad

Hard-coded, no data file: `TCP.RellenarInventario`, called from `ConnectNewUser` (`TCP.bas:524`) and `GameLogic.bas:1515`.
`EquipamientoInicial.dat` / `CargarEquipamientoInicial` / `LoadEquipSet` do not exist at 9ccd, so the 13 `TCP.LoadEquipSet`
errors and the empty starting inventory seen on the throwaway `server-prehoo` (HOO-era exe + pinned data) go away.

Everyone: 500 Poción de Vida (4335), 35 Poción Violeta (4334), 4 Boleto de viaje a Jourmut (3791), 100 Manzana Roja (3684),
50 Botella de Agua (3685), a beginner armour (3500) or tunic (3502, mage/druid/bard) equipped. By class: blue potions 4336
(850 mage/druid, 650 bard/cleric, 450 paladin/assassin/bandit), yellow 4337 and green 4338 potions, beginner weapons, shield,
helmet, ring, bow and arrows, gun and bullets, flute or lute. Spells: mage/cleric/druid/bard 1 (Dardo Mágico) + 7;
paladin/bandit/assassin 291 (Onda Mágica) + 12 (Curar heridas leves). All 25 objects and 4 spells exist in the pinned Dat.

## Data the 9ccd code reads that the pin lacks

Upstream committed some files to Recursos only in `1b50fd6` (October) although the August code already reads them:

| File / section | Effect at 9ccd with the pin |
| --- | --- |
| `Balance.dat [ElementalMatrixForNpcs]` | `ES.LoadBalance` logs an error at its last step (everything before it is loaded). No pinned NPC or object has `ElementalTags`. |
| `Clanes.dat` sections | `ES.LoadGuildsConfig` may log an error (seen on the throwaway test). |
| `BlockedWordsDescription.txt` | `TxtDimension` returns 0, empty list. |
| `BlackSmithElementalRunes.dat` | 0 runes; the rune list of the blacksmith form may error when opened. |
| `UnderworldMapPool.dat` | `FileExist` check, feature off. |
| `AreasStats.ini` | read as 0, created on first write. |

## Database

- **Schema**: `base_db_definition.sql` is identical at both commits, and the 51 ScriptsDB files of 9ccd are byte-identical to
  their caac counterparts. caac adds 5 migrations: `20260823-01 add user remort count` (`ALTER TABLE user ADD COLUMN remort_count
  INTEGER NOT NULL DEFAULT 0`), `20260928-01` (gives spell 9 to class 6), `20261111-01/02` (alchemy objects out of inventories
  and banks), `20261111-03` (moves users off removed maps). So the live DB = the 9ccd schema + `user.remort_count`.
- **Forward (live DB under 9ccd)**: nothing to migrate. `LoadDBMigrations` runs a file only when its date is greater than the
  last recorded one; the live table ends at `20261111-03`, later than every 9ccd file, so nothing runs. 9ccd's `INSERT INTO user`
  lists its columns, so `remort_count` takes its default 0 (all 21 characters have 0 today).
- **Data mismatch**: spell 352 ("Orbe de Luz", from caac's `EquipamientoInicial.dat` kit) is in slot 3 of 7 test characters
  (user ids 4, 15, 16, 18, 19, 20, 21); the pinned `Hechizos.dat` has 293 spells, and `WriteChangeSpellSlot` indexes
  `Hechizos(352)` at login. Swap step: `update spell set spell_id = 0 where spell_id = 352;` (done on the test copy). The 23
  object ids in inventories and banks all exist at the pin; only 3791 has a different name ("Boleto de viaje a Jourmut").
- **Backward (back to caac)**: the schema does not change under 9ccd, so caac reads the DB as is. The cleared spell comes back with
  `update spell set spell_id = 352 where number = 3 and spell_id = 0 and user_id in (4,15,16,18,19,20,21);`. Characters created
  under 9ccd keep the 9ccd kit.

## Build (twinBASIC GUI)

1. File → Open Project → `C:\ao\server-9ccd\Server.VBP`; in New Project Options **untick Option Explicit ON**; Continue.
2. Save as `C:\ao\server-9ccd\Argentum20Server-9ccd.twinproj`.
3. win32 configuration. Project Settings: Conditional Compilation Args `PYMMO=0`, `DIRECT_PLAY=0`, `UNIT_TEST=0`
   (also `DEBUGGING=1`, `UNLOCK_CPU=1`, `BATTLESERVER=0`); **Build Stack Reserve Size = 67108864**; **Build Output Path =
   `C:\ao\server-9ccd\server-9ccd.exe`** (the server counts running processes by exe name and stops on a "mas de 1 instancia"
   dialog if a second `server.exe` starts).
4. File → Build. If the stack setting did not apply: `C:\ao\patch-exe-stack.ps1 -Path C:\ao\server-9ccd\server-9ccd.exe`.

## Test on 7697, swap, rollback

Exact commands in `BUILD-STEPS.txt` sections B to D. In short:

- **Test**: separate interactive scheduled task `AOServer9ccd` running `server-9ccd.exe`; tunnel `scripts/vm-ssh.sh -N -L
  7697:127.0.0.1:7697` (QEMU forwards only 22 and 7667); log in as Aotest, create a character and check the kit; event log
  (`Argentum20`) shows no `LoadEquipSet`.
- **Swap** (needs Ariel off the server): `.backup` the live DB; stop `AOClassicServer`; take a fresh `.backup` into
  `server-9ccd`, clear spell 352; set `StartPort=7667`; copy `server-9ccd.exe` to `server.exe`; rename `C:\ao\server` →
  `server-caac-<TS>` and `C:\ao\server-9ccd` → `C:\ao\server`; `start-server.ps1` (it gives up at 30 s, keep polling 7667).
  The client should then read the pinned data (`AO_ASSETS=~/Projects/ao-reference/Recursos-prehoo`).
- **Rollback**: stop, `.backup` the DB, rename the two dirs back, copy in either the post-9ccd backup (keeps progress) or the
  pre-swap backup, restart.

## Leftovers on the VM

`C:\ao\server-prehoo` (throwaway, HOO-era exe) and `C:\ao\prehoo-dat.tgz` from the earlier test are untouched; remove with
`Remove-Item -Recurse C:\ao\server-prehoo` once the 9ccd server runs. Undo of this prep: `Remove-Item -Recurse C:\ao\server-9ccd`
(the live server never referenced it).
