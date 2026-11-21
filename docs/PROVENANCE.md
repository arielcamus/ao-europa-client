# Provenance: pre-HOO code, data and assets only

**Rule (Ariel, 2026-11-21): no HOO-era code, logic, content or assets.** HOO is Heroes of Old, AO20's next-generation client
(`ao-org/hoo-dependencies`, created 2026-08-25; the `hoo-*` branches of `argentum-online-client-classic`). Its assets are not
public and its data does not match the classic graphics. Everything we build against is pinned to the last upstream commit
before HOO work landed. The lock is `tools/provenance/sources.lock.json`; the test is `tools/provenance/test/provenance.test.ts`.

## Pins

| Upstream | Pinned commit | Date | Why this one |
| --- | --- | --- | --- |
| argentum-online-server-classic | `9ccd7fad` (v5.6.64-49) | 2026-08-10 | parent of `0b9217ba` "Expand server area interest for HOO clients" (2026-08-12), the first HOO commit; v5.6.65 is the first release with HOO code |
| argentum-online-client-classic | `619e69d` | 2026-08-10 | parent of `547ca10`, the client half of that change (first HOO-named commit: `a70940b`, 2026-08-21) |
| Recursos | `2bfa51e` | 2026-08-01 | last commit before HOO work; Dat/init/Graficos/Mapas are identical at `552d4ed`, the parent of `1b50fd6` |

Suspect, kept inside the pin: `999649ad` (server) / `6b8939f` (client), 2026-08-05, PickUp and Drop carry a target tile
(nearby-item pickup). Not named HOO. Our `PickUp` codec `{x, y, slot}` uses that format. Moving the pins to before 2026-08-05
(server `174c73e4`, client `f15d2e2`) is Ariel's call.

## What is post-pin today

- **The VM server** on 7667 has been the pin since 2026-11-21 11:40: `9ccd7fad` plus our build patches, two upstream bug fixes,
  the post-pin backport `07009f8a` (home city choice, 2026-08-13, not HOO) and the pre-`35a94b15` graduation rule
  ([SERVER-PREHOO-BUILD.md](SERVER-PREHOO-BUILD.md)). The previous `caac3133` build (HOO code: S2C 203-206, C2S 312-315) is left
  untouched in `C:\ao\server` and not used. HOO packet ids were appended after the pinned ones, so no pinned id moved.
- **Recursos `1b50fd6`** (2026-10-10, 41 Dat files): 576 of 907 NPCs point at bodies absent from the classic `cuerpos.dat`
  (invisible shopkeepers) and 241 NPC spawns of the 2024 maps no longer exist. **`89615f3`** adds 2003 `OGG/` files and 8 `wav`.
- **ao-client main**: packet-counter family `targetedSpellCast` / sequenced id 314 (removed in this change).

## How it is enforced

`node tools/provenance/provenance.mjs --verify <Recursos dir>` (or `AO_ASSETS=... pnpm test`) hashes every file we consume (the client's
`tools/local-assets.mjs` allowlist plus the server's whole `Dat/`, 5,134 files) and compares it with `tools/provenance/recursos-pin.sha256`.
A file that differs, or that does not exist at the pin (`OGG/`, new `wav`, new `Dat` files), fails unless its exact hash is the output of
an **active patch** in the lock. `--verify-pin` accepts only the pinned bytes; `--verify-patched` requires every active patch.
`tools/data-integrity/integrity.mjs` then checks every NPC body/head/weapon/shield/helmet, object graphic, body and door partner, spell
FX/NPC/object, quest NPC/object/spell/quest, crafting object and map NPC/object spawn; ids outside `knownGaps` (the dangling references
the pinned upstream already has) fail.

Without `AO_ASSETS` the real-asset tests are skipped and the run prints `*** SKIPPED: no assets ... did NOT run ***`. The synthetic
tests (hashing, the three modes, the invisible-NPC case) and the lock self-check (every patch starts from the pinned hash, names a
script of the recipe, no HOO-era source) always run.

## Patches are recipes

Each `patches.active` entry is `{ path, base, sha256, script, doc, reason }`: `base` is the pinned hash, `sha256` the output of
`patches.recipe` (the `tools/data-patches/*.py` scripts, in order) run on the pinned file. Today (2026-11-22):

| File | Script | DATA-PATCHES | Who reads it |
| --- | --- | --- | --- |
| `Dat/Ciudades.Dat` | `apply-home-city-patches.py` (6, 7), then `apply-newbie-patches.py` (8) | [6](DATA-PATCHES.md#6-forgat-home-city-pointed-at-open-sea-new-characters-stuck-on-map-517), 7, 8 | server only |
| `Dat/Motd.ini`, `Dat/npcs.dat`, `Dat/Quests.DAT`, `Mapas/Mapa64.csm` | `apply-newbie-patches.py` | 8 | server (npcs.dat and the map also the client) |
| `init/sp_localindex.dat` | `apply-newbie-patches.py --client-init` | 8 | client |
| `interface/es_mapa2.bmp`, `en_mapa2.bmp` | `apply-worldmap-picture.py` (input: the 2024 `043cdf20` picture) | 9 | client |

`Configuracion.ini` (rates) is in `patches.outOfTree`: the VM server root, not part of Recursos, not hashed.

`node tools/data-patches/build-patched.mjs --pin <untouched tree> --out <new dir> [--inputs <dir with the 043cdf20 pictures>]` checks
the pin with `--verify-pin`, clones it (APFS copy on write, no disk cost), replays the recipe and checks every output hash and
`--verify-patched`. `AO_ASSETS_PIN=<untouched tree> pnpm vitest run tools/provenance` replays it on the patched files only. A new patch
is a script plus a lock entry, reviewed like code; the pin itself never changes.

The coverage map (`docs/COVERAGE.md`) is computed against the pinned code (`tools/coverage/vb6-snapshot-pinned/`, from
`node tools/coverage/build-map.mjs --refresh-pinned`); post-pin packets are listed in their own section.

## The trees on this Mac (2026-11-22)

| Tree | What it is | Check |
| --- | --- | --- |
| `~/Projects/ao-reference/Recursos-prehoo` | the pin with the section 8 and 9 patches applied in place by hand; what the play site serves (`play.sh` `AO_ASSETS`) | `--verify` |
| `~/Projects/ao-reference/Recursos-prehoo-pin` | the untouched pin: an APFS clone of the above with the 7 patched files restored from `Recursos-prehoo-backup-20261121-newbie` and the `.orig-worldmap` copies | `--verify-pin` |
| `~/Projects/ao-reference/Recursos-prehoo-patched` | built by `build-patched.mjs` from `-pin` | `--verify-patched` |

All three are APFS clones of the Recursos checkout restored to `2bfa51e` (7,515 files: binaries checked against the pin's git blob ids,
text files byte-compared with `git archive 2bfa51e`). No `.git`. `-patched` is byte-identical to `Recursos-prehoo` on all 5,134 consumed
files except `Dat/Ciudades.Dat`, which the build patches like the VM server's copy (sections 6 to 8) and the client never reads.

**Proposed switch (issue #88 item 2, not done):** point the play site at the built copy (`play.sh`: `AO_ASSETS=$HOME/Projects/ao-reference/Recursos-prehoo-patched`)
at a moment Ariel picks, since it needs a play-server restart; then `Recursos-prehoo` can be retired or reset to the pin, and every
future data patch lands as a script plus a lock entry and a rebuild, never as a hand edit of a shared tree.
