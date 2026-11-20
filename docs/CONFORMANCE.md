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
{"t_ms": 1532, "dir": "s2c", "id": 50, "name": "ObjectCreate", "hex": "24195e09010000000000"}
{"t_ms": 4210, "dir": "c2s", "id": 96, "name": "DoubleClick", "hex": "4823"}
```

| field | meaning |
| --- | --- |
| `t_ms` | integer milliseconds since the TCP connection was opened (monotonic, recorder clock) |
| `dir` | `c2s` client to server, `s2c` server to client |
| `id` | packet id, the int16 at the start of the frame body (`ServerPacketID` / `ClientPacketID` of `PacketId.bas`, PYMMO=0) |
| `name` | id name without the VB6 `e` prefix (`ObjectCreate`); `Unknown<id>` when not in the table. Informational, never compared |
| `hex` | lower-case hex of the packet **payload**: the frame body after the 2-byte id, no length prefix. Empty string for empty packets |

Rules:

- The length prefix is never stored; the recorder re-frames. `body = int16LE(id) + hex`.
- Credentials: record with a throw-away local account. `LoginAccount` (`c2s` 305) keeps its `hex` but test accounts must be
  `@local.test` with a password that is not reused anywhere. Never record a real account. Fixtures are committed, so a
  recording must not contain secrets.
- A fixture may be trimmed to a contiguous window only by removing whole leading/trailing packets, never edited inside.
- Time-varying packets (`UserOnline`, `PlayWave`, `FlashScreen`, `hora`, server uptime strings, random `RainToggle`) may stay in
  the file; comparers must ignore them via the shared noise list (below).

## Recording

```sh
# VB6 server must be listening on 127.0.0.1:7667 and the account must exist (tools/real-server/vb6-create-account.mjs).
AO_PORT=7667 AO_EMAIL=<feature>@local.test AO_PASSWORD=... AO_CHAR_ID=<id> AO_CHAR=<name> \
  node tools/conformance/vb6-record.mjs tools/conformance/scenario-<feature>.mjs tests/fixtures/vb6/<feature>/<scenario>.jsonl
```

`tools/conformance/vb6-record.mjs` connects, logs in (`LoginAccount`, `LoginExistingChar`), runs the scenario's
`export default async (rec) => { ... }` and writes the file. A scenario uses `rec.send(id, bodyBytes)`, `rec.wait(pred)`,
`rec.sleep(ms)` and `rec.records`. `tools/conformance/scenario-doors.mjs` is the reference scenario.
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

## Why payload-only hex

The id is already a field, the length is redundant and framing is covered by `packages/protocol/test/protocol.test.ts`; keeping only
the payload lets one fixture row be compared with whatever encoder a server uses.

## Fixtures

| file | what it records |
| --- | --- |
| `doors/open-door-castle-entry-refused.jsonl` | login as `Aotest`, `LeftClick` (x,y,counter) on the plain door (72,35): look only; on (71,35): the door toggles open (`BlockPosition`x4 + `ObjectCreate` 2333); walking onto the door tile is bounced by the server (castle-entry trigger 26: `AreaChanged` re-sync back to (72,36)); a `LeftClick` from too far only looks |

Server facts verified while recording (VB6 `HandleLeftClick`/`HandleWorldAction`/`HandleDoorAction`):
`LeftClick` is `x, y, counter:int32`; without the counter the packet is logged as edited and ignored. `DoubleClick` is read and ignored.
A door acts on a click at the tile whose (x+1,y), (x+1,y+1) or (x,y+1) neighbour holds it; a click exactly on the door tile only looks. The
reach is `Distance <= 2`. Keyed doors (`Llave=1`) answer with a locale message. Tile exits (TE) warp with `ChangeMap` + `CharacterCreate`(self) + `UserCharIndexInServer`.
