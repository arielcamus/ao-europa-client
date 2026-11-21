# crafting fixtures (real VB6 server recordings)

Logins are redacted (`LoginAccount` is the bare id). Two kinds of session:

**Level-1 character `Aotest`** (no gold, tool or skill; recorded with `tools/real-server/crafting-record.mjs`): requests and refusals.

| file | what it proves |
| --- | --- |
| `login.jsonl` | the shared login window |
| `station-not-open.jsonl` | AddItemCrafting, RemoveItemCrafting, AddCatalyst, RemoveCatalyst, MoveCraftItem, CraftItem, CloseCrafting, FlagTrabajar, RepeatMacro with no station open: no crafting packet comes back |
| `complete-action-none.jsonl` | CompletarAccion with nothing pending: LocaleMsg 750 |
| `build-refused.jsonl` | refused CraftBlacksmith/Alquimista/Sastre; CraftCarpenter answered by MacroTrabajoToggle on then off |
| `anvil-no-hammer.jsonl` | LeftClick on the anvil, no hammer: LocaleMsg 1071 |
| `automated-action-refused.jsonl` | StartAutomatedAction with no tool/deposit/forge/water |

**Equipped review character** (from the PR #29 independent review): the success paths.

| file | what it proves |
| --- | --- |
| `smith-alchemy-tailor-build.jsonl` | anvil click: BlacksmithWeapons (33) / Armors (37) / ExtraObjects (4) then ShowBlacksmithForm; successful CraftBlacksmith 165/365/366/367 with the materials messages; AlquimistaObj (7) + ShowAlquimiaForm, SastreObj (33) + ShowSastreForm; CraftAlquimista / CraftSastre |
| `smith-refused-carpenter-build.jsonl` | refused smith builds (MacroTrabajoToggle off), CarpenterObjects (Byte count 31) + ShowCarpenterForm, CraftCarpenter x2 (on, then off) |
| `carpenter-craft-walk-north.jsonl`, `carpenter-craft-walk-south.jsonl` | CraftCarpenter x30; walking north leaves the server macro on, walking south ends it (MacroTrabajoToggle off) |
| `mine-extraction.jsonl`, `mine-extraction-then-walk.jsonl` | pickaxe: WorkRequestTarget 19, StartAutomatedAction, ParticleFX per extraction. FlagTrabajar alone did not stop the extraction effects |
| `chop-extraction.jsonl` | axe: StartAutomatedAction (38,71,17) |
| `smelt-extraction.jsonl` | WorkRequestTarget 26 then StartAutomatedAction at the forge |

Still hand-built goldens (`packages/protocol/test/crafting.test.ts`, VB6 writer field order): OpenCrafting, CraftingItem/Catalyst/Result (the shipped NPC data has no NPC with `Craftea`), PelearConPezEspecial, FinalizarPescaEspecial, RomperCania (it deletes a slot), and list edge cases.
