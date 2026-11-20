# crafting fixtures (VB6 server, level-1 character `Aotest`)

Recorded with `tools/real-server/crafting-record.mjs`. The character has no gold, no tool and no skill points, so these hold
the requests and the server's **refusals**. The success replies (BlacksmithWeapons/Armors/ExtraObjects, CarpenterObjects,
AlquimistaObj, SastreObj, the Show*Form packets, OpenCrafting and CraftingItem/Catalyst/Result) could not be recorded and are
covered by hand-built goldens in `packages/protocol/test/crafting.test.ts` (VB6 writer field order).

| file | what it proves |
| --- | --- |
| `login.jsonl` | the shared login window |
| `station-not-open.jsonl` | AddItemCrafting, RemoveItemCrafting, AddCatalyst, RemoveCatalyst, MoveCraftItem, CraftItem, CloseCrafting, FlagTrabajar, RepeatMacro with no station open: no crafting packet comes back (the rest is other players' noise) |
| `complete-action-none.jsonl` | CompletarAccion with nothing pending: LocaleMsg 750 |
| `build-refused.jsonl` | CraftBlacksmith/CraftAlquimista/CraftSastre refused (LocaleMsg, and for the smith `MacroTrabajoToggle(off)`); CraftCarpenter answered by `MacroTrabajoToggle(on)` and, once the server finds no tool, `MacroTrabajoToggle(off)` |
| `anvil-no-hammer.jsonl` | LeftClick on the anvil at (34,65) from two tiles away: LocaleMsg 1071 (no hammer equipped) |
| `automated-action-refused.jsonl` | StartAutomatedAction for chop, mine, smelt and fish with no tool, no deposit, no forge and no water: silence, except LocaleMsg 607 for the forge |

Not recordable at level 1: any successful build, any extraction (needs an axe, pickaxe or rod plus the skill), the special-fish
fight (`PelearConPezEspecial`, `FinalizarPescaEspecial`, `RomperCania`, which would delete an inventory slot), the NPC crafting
station (the shipped NPC data has no NPC with `Craftea`).
