# VB6 conformance fixtures

The VB6 server (twinBASIC build of ao-org `argentum-online-server-classic`) is the **reference**. A recording of a real
session against it is a golden fixture: the new server must answer the same client packets with the same server packets.

## Location and naming

`tests/fixtures/vb6/<feature>/<scenario>.jsonl` where `<feature>` is one of `doors`, `chat`, `combat`, `spells`, `items`,
`npcs` (or a new short lowercase word) and `<scenario>` is a kebab-case description (`open-door-castle-entry-refused`,
`say-and-shout`, `melee-kill-and-resurrect`). One file is one connected session, from the first server packet to disconnect.

## Format

JSON Lines, UTF-8, one object per packet, in wire order of observation (a stable sort by `t_ms`; ties keep arrival order):

```json
{"t_ms": 1532, "dir": "s2c", "id": 50, "name": "ObjectCreate", "hex": "320024195e09010000000000"}
{"t_ms": 4210, "dir": "c2s", "id": 96, "name": "DoubleClick", "hex": "60004823"}
```

| field | meaning |
| --- | --- |
| `t_ms` | integer milliseconds since the TCP connection was opened (monotonic, recorder clock) |
| `dir` | `c2s` client to server, `s2c` server to client |
| `id` | packet id, the int16 at the start of the frame body (`ServerPacketID` / `ClientPacketID` of `PacketId.bas`, PYMMO=0) |
| `name` | id name without the VB6 `e` prefix (`ObjectCreate`); `Unknown<id>` when not in the table. Informational, never compared |
| `hex` | lower-case hex of the **full frame body**: the 2-byte little-endian packet id followed by the payload, no length prefix. An empty packet is just the id (`1400`) |

Rules:

- The length prefix is never stored; the recorder re-frames (`uint16LE(len(hex)/2) + body`). `hex` already starts with the id, so `hex` is exactly what `decodeServerPacket` / `decodeClientPacket` take.
- Credentials: record with a throw-away local account (`@local.test`, a password used nowhere else). **The recorder redacts credential packets:
  `LoginAccount` (305) and `CreateAccount` (304) are stored with an empty payload (`hex` is only the id, e.g. `3101`).** The recorder requires
  `AO_EMAIL`, `AO_PASSWORD`, `AO_CHAR_ID`, `AO_CHAR` explicitly and has no defaults. A fixture still contains the character name and its data.
- A fixture may be trimmed to a contiguous window only by removing whole leading/trailing packets, never edited inside.
- Time-varying packets (`UserOnline`, `PlayWave`, `FlashScreen`, `hora`, server uptime strings, random `RainToggle`) may stay in
  the file; comparers must ignore them via the shared noise list (below).

## Recording

```sh
# VB6 server must be listening on 127.0.0.1:7667 and the account must exist (tools/real-server/vb6-create-account.mjs).
AO_PORT=7667 AO_EMAIL=<feature>@local.test AO_PASSWORD=... AO_CHAR_ID=<id> AO_CHAR=<name> [AO_ASSETS=<Recursos>] \
  node tools/conformance/vb6-record.mjs tools/conformance/scenario-<feature>.mjs tests/fixtures/vb6/<feature>/<scenario>.jsonl
```

`tools/conformance/vb6-record.mjs` connects, logs in (`LoginAccount`, `LoginExistingChar`), runs the scenario's
`export default async (rec) => { ... }` and writes the file. A scenario uses `rec.send(id, bodyBytes)`, `rec.wait(pred)`,
`rec.sleep(ms)` and `rec.records`; `tools/conformance/helpers.mjs` has `makeWalker(rec)` (path finding over the CSM from `AO_ASSETS`, `goto`, `step`, `click` with the VB6 counters). `scenario-doors.mjs` and `scenario-walkto.mjs` are the reference scenarios.
`tools/conformance/server-packet-names.json` maps server ids to names (generated from `PacketId.bas`; names are for humans only).

## Using a fixture as a test

1. **Codec conformance (every feature):** for each row, `decode(body)` then `encode(...)` must reproduce `hex` byte for byte
   (see `packages/protocol/test/doors.test.ts`). Packets the codecs do not know yet are skipped, not failed.
2. **Server conformance (new server):** replay every `c2s` row, in order and with the recorded spacing scaled down, against the new
   server on a fresh copy of the same character; the `s2c` rows must appear in the same relative order. Compare ids and payload
   bytes; ignore the noise list and any field documented as random (hit rolls, drop rolls, timestamps), and say which in the test.
3. **Client conformance:** feed the `s2c` rows to the client `Session` and assert the state after each scenario step.

Noise ids to ignore when diffing (`name`): `UserOnline`(112), `PlayWave`(55), `FlashScreen`(129), `hora`(117), `RainToggle`(59),
`NieveToggle`(122), `AntiCheatStartSession`(197). Add to this list in the PR that finds another.

## Why the id stays in `hex`

Every feature's fixtures were recorded this way and decode with each other's codecs, and `hex` is then exactly the body the
decoders take. The id field repeats it for grepping; the length prefix is redundant and framing is covered by
`packages/protocol/test/protocol.test.ts`. `packages/protocol/test/fixtures-roundtrip.test.ts` decodes and re-encodes every row of
every file under `tests/fixtures/vb6/**` and fails when a known packet does not reproduce its bytes.

## Fixtures

| file | what it records |
| --- | --- |
| `doors/open-door-castle-entry-refused.jsonl` | login as `Aotesta`; `LeftClick` (x,y,counter) on the plain door (72,35) while the player stands on (72,36): look only; `LeftClick` on (71,35): the door toggles (`BlockPosition`x4 + `ObjectCreate`); walking onto the door tile is bounced by the server (castle-entry trigger 26, `AreaChanged` resync); a click from too far only looks |
| `buildings/bank-doors-closed.jsonl` | walking onto the Finanzas doorway (77,56)->(77,55): rejected (`PosUpdate` unchanged); the doors are objects 1424/1426 that were missing from `Obj.dat` |
| `buildings/carpentry-castle-trigger-bounce.jsonl` | Carpintería (door obj 2333 open at (65,79), `Llave=0`): stepping north into the doorway is accepted then undone by `GameLogic.DoTileEvents` (trigger 32 = EMPEROR_CASTLE_ENTRY_12, no castle exists): `AreaChanged` resync + `LocaleMsg` 2215, `PosUpdate` back to (65,80) |
| `buildings/bank-castle-trigger-bounce.jsonl` | Finanzas west door (77,55): `LeftClick` opens 1424 -> 1423 (`BlockPosition`x4 + `ObjectCreate`); stepping north is bounced the same way (trigger 29 = EMPEROR_CASTLE_ENTRY_9), `LocaleMsg` 2215. The east door (79,55) is shown as obj 1425 in the login `ObjectCreate` burst |
| `buildings/nix-building-castle-trigger-enters.jsonl` | after the server fix: Ciudad de Nix (map 34) building with trigger 24, door (43,47) opened by `LeftClick`, walking north (43,48)->(43,45) is accepted, no `LocaleMsg` 2215. The character was placed through the server DB (docs/DATA-PATCHES.md) |
| `buildings/church-patron-tile.jsonl` | walking into the Templo interior (trigger 20, ONLY_PATREON_TILE): `LocaleMsg` and `PosUpdate` unchanged |
| `bank/far-from-banker.jsonl` | `BankStart` with no target (LocaleMsg), `LeftClick` on the banker Krix (77,47) from (77,56), `BankStart` 9 tiles away (limit 6: refused), `BankDepositGold`/`BankExtractGold` of 100 with no gold (the banker answers with `LocaleChatOverHead`), `RequestAccountState`, `BankEnd` while not trading (ignored) |
| `bank/deposit-move-extract.jsonl` | `BankDeposit` slot 3 to the first free vault slot and to an explicit slot, `BovedaMoveItem` (move and swap), `BankExtractItem` back, an empty slot, a newbie item refused. Each deposit answers `ChangeInventorySlot` + `ChangeBankSlot`; the distance limit for deposit is 10 |
| `trade/<scenario>-initiator.jsonl`, `-responder.jsonl` | two characters (Tbank, TItems), one file per side: `offer-and-accept` (invitation = `ShowPregunta` 1594, `ResponderPregunta`, `UserCommerceInit` after 24 `ChangeInventorySlot`, item and gold offers refused with locale 1140/1141/1138, trade chat both ways, `UserCommerceOk` twice, `UserCommerceEnd`), `reject`, `invitation-declined`, `cancel` (`UserCommerceEnd`), `give-back` |

Server facts verified while recording (VB6 `HandleLeftClick` / `HandleWorldAction` / `HandleDoorAction` / `LegalWalk`):

- `LeftClick` is `x, y, counter:int32`; without the counter the packet is logged as edited and ignored. `DoubleClick` is read and ignored.
- `HandleLeftClick` skips the world action when ANY character (the player included) stands on `(x,y)` or `(x,y+1)` and when a non-interactable NPC does.
  Otherwise an object on `(x,y)` is used directly (a door toggles); only if `(x,y)` has no object does it try `(x+1,y)`, `(x+1,y+1)`, `(x,y+1)` in that order.
  Reach is Euclidean `Distance <= 2`. A `Llave=1` door answers with a locale message; a `Subtipo=1` door also toggles `(x-3,y+1)`.
- Walking: `LegalWalk` refuses the move when the TARGET tile's `Blocked` has bit `2^(heading-1)` (N=1,E=2,S=4,W=8), a `FLAG_AGUA` tile (0x20) on foot, an NPC/user on it, a Patreon-only tile (trigger 20) for non-patrons, and castle-entry triggers for non-members.
- Tile exits (TE) warp with `ChangeMap` + `CharacterCreate`(self) + `UserCharIndexInServer`.
- Packet counters are per family (`PacketNames`), per connection, started at 1 (`apps/web/src/packet-counters.ts`).
