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

- **The VM server** (`C:\ao\server\Codigo`) is `caac3133` (2026-11-19) plus our twinBASIC build patches: every HOO commit from
  2026-08-12 to the classic cap v5.6.76, then classic-branch PRs #5..#22. A rebuild at the pin is a manual twinBASIC step.
  Its HOO packets: S2C `RemortState` 203, `RemortResult` 204, `HooTargetedSpellCastResult` 205, `HooHouseDoorActionResult` 206;
  C2S `HooClientCapabilities` 312, `RequestRemort` 313, `HooTargetedSpellCast` 314, `HooHouseDoorAction` 315. Post-pin classic:
  `AutoCombatState` 207, `ToggleAutoCombat` 316. All are appended after the pinned ids, so no pinned id moved.
- **Recursos `1b50fd6`** (2026-10-10, 41 Dat files): 576 of 907 NPCs point at bodies absent from the classic `cuerpos.dat`
  (invisible shopkeepers) and 241 NPC spawns of the 2024 maps no longer exist. **`89615f3`** adds 2003 `OGG/` files and 8 `wav`.
- **ao-client main**: packet-counter family `targetedSpellCast` / sequenced id 314 (removed in this change).

## How it is enforced

`node tools/provenance/provenance.mjs --verify <Recursos dir>` (or `AO_ASSETS=... pnpm test`) hashes every file we consume (the client's
`tools/local-assets.mjs` allowlist plus the server's whole `Dat/`, 5,130 files) and compares it with `tools/provenance/recursos-pin.sha256`.
A file that differs, or that does not exist at the pin (`OGG/`, new `wav`, new `Dat` files), fails unless its exact hash is an
**active patch** in the lock. `tools/data-integrity/integrity.mjs` then checks every NPC body/head/weapon/shield/helmet, object graphic,
body and door partner, spell FX/NPC/object, quest NPC/object/spell/quest, crafting object and map NPC/object spawn; ids outside
`knownGaps` (the dangling references the pinned upstream already has) fail.

Without `AO_ASSETS` the real-asset tests are skipped and the run prints `*** SKIPPED: no assets ... did NOT run ***`. The synthetic
tests (hashing, patch allowlist, the invisible-NPC case) always run. Proof against real HOO data, never committed:
`AO_ASSETS=<pinned tree> AO_HOO_NPCS=<git show 1b50fd6:Dat/npcs.dat> pnpm vitest run tools/provenance`.

The coverage map (`docs/COVERAGE.md`) is computed against the pinned code (`tools/coverage/vb6-snapshot-pinned/`, from
`node tools/coverage/build-map.mjs --refresh-pinned`); post-pin packets are listed in their own section.

## A pinned tree

`~/Projects/ao-reference/Recursos-prehoo` (2026-11-21): an APFS clone of the Recursos checkout with every file restored to `2bfa51e`
(7,515 files: binaries checked against the pin's git blob ids, text files byte-compared with `git archive 2bfa51e`). No `.git`.
Point `AO_ASSETS` at it. Changing a consumed file means a new manifest (`--write`) or an active patch entry, reviewed like code.
