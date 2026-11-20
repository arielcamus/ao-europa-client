# M1 classic wire contract

Target: ao-org VB6 classic, `PYMMO=0`, `DIRECT_PLAY=0`. Both `DEBUGGING=0` and
`DEBUGGING=1` Connected frames are supported. This is source-derived compatibility;
there is no compiled VB6 server available here for live interoperability testing.

Read-only references used on 2026-11-20:

| Reference | Revision |
| --- | --- |
| argentum-online-server-classic | `caac31333f7cefdbe2b7771cf309e555b33a563e` |
| argentum-online-client-classic | `b648c1a9b14903884393a7194e9faa0bc275633b` |
| Aurora.Network | `0e949440095a3e062479d614d111eff1ac53c2bb` |

Paths below are relative to those checkouts under `~/Projects/ao-reference`.
All implemented field layouts were checked against both the writing and reading
VB6 procedures. Both PacketId.bas enumerations agree for this subset; enum order
is authoritative, not outdated numeric comments. Include `#If PYMMO = 0` entries.

## Envelope and primitives

`uint16LE(body.length) | int16LE(packetId) | fields`: length includes ID but excludes
the length itself. One message per frame. Aurora `Code/Foundation/Private/Network/Detail/Channel.cpp`
`Send`, `DoRead`, `WhenRead`, `DoProcess` establish the envelope. Server
`Codigo/modNetwork.bas:87` and client `CODIGO/modNetwork.bas:101` hand one Writer
to Aurora; `modSendData`/client `send` clear that Writer after sending. Nagle is off
in Aurora's `DoConfiguration` and in our TCP applications.

`Code/Foundation/Public/Network/Writer.hpp`, `Reader.hpp`,
`Code/Proxy/Public/Network/COM_Writer.cpp`, `COM_Reader.cpp`, and
`Code/Proxy/Public/Core/Proxy.hpp` establish:

- `Int16` / `Int32`: signed, fixed-width, little endian on VB6/x86.
- VB6 `Int8`: **unsigned byte**, despite the name. Proxy.hpp defines `vbInt8` as
  `unsigned __int8`; the C++ signed intermediate preserves the byte bits.
- Bool: one byte, 0 or 1 (`VBIsTrue` converts VB's -1 to C++ true).
- `WriteInt(vbInt32)`: seven-bit continuation varint, **no ZigZag**. Positive range
  0..2147483647. The actual signed template emits only `value & 127` for negatives:
  -1 → `7f`, -128 → `00`, -129 → `7f`. Writer preserves that lossy behavior;
  callers must use fixed Int16/Int32 when negative values must round trip.
- `String8`: UTF-8 conversion, varint **byte** length, then bytes. Empty strings
  and embedded NUL are valid. A leading U+FEFF is string content, so the decoder
  uses `ignoreBOM: true` to preserve it. Lengths use the unsigned specialization.
- `Real32`: little endian IEEE-754 float (CharacterCreate.speeding).
- `COM_Writer.cpp:232` SAFEARRAY: varint dimension count; for each raw `rgsabound`
  entry, unsigned varint lower bound then unsigned varint element count; finally
  raw data of product(counts) × element size. Element size/type is **not** sent.
  `COM_Reader.cpp:245` reverses bounds when calling SafeArrayCreate. Our public
  `SafeArrayInt8.bounds` keeps **wire order**; it does not emulate COM allocation.
  Signed negative lower bounds are cast to uint32 before encoding.

The TypeScript Reader deliberately rejects truncation, varints beyond 32 bits,
invalid UTF-8, noncanonical bool bytes, and trailing fields, instead of emulating
Aurora's unchecked reads on malformed input. These checks do not change valid
writer output. Generic SAFEARRAY support here is byte elements only.

## Paired packet layouts

Types: `b` = VB Byte, `i16/i32` = fixed signed LE, `v` = COM WriteInt,
`s` = String8, `f32` = Real32. All sequences below exclude the packet ID.

| Direction / ID | Name and field order | Writer source | Reader source |
| --- | --- | --- | --- |
| S→C 1 | Connected: empty, or SAFEARRAY `01 01 0a 01 02 03 04 05 06 07 08 09 0a` | server Protocol_Writes:77 PrepareConnected | client Protocol:497 HandleConnected |
| C→S 305 | LoginAccount: email:s, password:s | client Protocol_Writes:252 | server Protocol:1403 |
| S→C 199 | AccountCharacterList: count:v, then records below | server Protocol_Writes:45 | client Protocol:6253 |
| C→S 73 | LoginExistingChar: charId:i32, name:s | client Protocol_Writes:272 | server Protocol:1444 |
| S→C 2 | Logged: newUser:bool | server Protocol_Writes:99 | client Protocol:515 |
| S→C 30 | ChangeMap: map:i16, resourceMap:i16 | server Protocol_Writes:684 | client Protocol:1385 |
| S→C 31 | PosUpdate: x:b, y:b | server Protocol_Writes:701 | client Protocol:1409 |
| S→C 42 | CharacterCreate: full sequence below | server Protocol_Writes:4175 PrepareMessageCharacterCreate | client Protocol:2181 |
| S→C 44 | CharacterMove: charIndex:i16, x:b, y:b | server Protocol_Writes:4337 | client Protocol:2401 |
| S→C 47 | UserCharIndexInServer: charIndex:i16 | server Protocol_Writes:983 | client Protocol:2158 |
| C→S 78 | Walk: heading:b, counter:i32 | client Protocol_Writes:397 | server Protocol:2061 |
| C→S 79 | RequestPositionUpdate: empty | client Protocol_Writes:416 | server Protocol:2182 |
| S→C 158 | Intervals: sixteen i32 values below | server Protocol_Writes:1512 | client Protocol:1193 |
| S→C 186 | PosUpdateUserChar: x:b, y:b, charIndex:i16 | server Protocol_Writes:718 | client Protocol:1433 |
| S→C 187 | PosUpdateChar: charIndex:i16, x:b, y:b | server Protocol_Writes:736 | client Protocol:1462 |
| S→C 7 | Disconnect: fullLogout:bool | server Protocol_Writes:282 | client Protocol:655 |
| S→C 73 | ErrorMsg: message:s | server Protocol_Writes:4405 | client Protocol:3801 |

Account record: id:v, name:s, body:v, head:v, characterClass:v, map:v, x:v,
y:v, level:v, status:v, helmet:v, shield:v, weapon:v, backpack:v. The client
clears clanName locally; **no clan string is sent**. The server uses up to ten
account characters; decoder consumes all count-delimited records within the frame.

CharacterCreate: charIndex:i16, body:i16, head:i16, heading:b, x:b, y:b,
weapon:i16, shield:i16, helmet:i16, cart:i16, backpack:i16, fx:i16, fxLoops:i16,
name:s, status:b, privileges:b, particleFx:b, headAura:s, weaponAura:s,
bodyAura:s, damageAura:s, resistanceAura:s, otherAura:s, shieldAura:s,
speeding:f32, npc:b, appear:b, groupIndex:i16, clanIndex:i16, clanLevel:b,
minHp:i32, maxHp:i32, minMana:i32, maxMana:i32, symbol:b, flags:b, userType:b,
team:b, flag:b, npcNumber:i16, clanAlignment:b. Flags bit 0 = idle, bit 1 = sailing.

Intervals: hit, bow, magic, extractWork, buildWork, **walk**, dropItem, useItemKey,
useItemClick, hitMagic, magicHit, hitUseItem, hide, talk, leftClick, meditate.
Headings (`client CODIGO/Declares.bas:679`): North=1, East=2, South=3, West=4.
Walk counter starts at 1 and increases by one for each sent walk; it is not wall time.

## Placement, movement and unknown packets

The server login path (`Codigo/Modulo_UsUaRiOs.bas:496,624,669,670,727`) sends
Intervals, ChangeMap, CharacterCreate, UserCharIndexInServer, then Logged, with
many other frames interspersed. Cache CharacterCreate by charIndex and select
the self position when UserCharIndexInServer arrives. Account-list coordinates
alone are not authoritative placement. A new map invalidates cached positions.

Successful Walk is broadcast to **other** clients (`Modulo_UsUaRiOs.bas:1332`);
the mover normally gets no ack. Failed movement sends PosUpdate (`Protocol.bas:2138`).
RequestPositionUpdate always elicits PosUpdate. The stand-in follows this behavior.
All four cardinal movement headings are represented; there are no map assets here.

Any unknown ID in a **complete frame** has a known payload size from its envelope.
Decode it as `{ unknown: true, id, payload }`, log and skip that frame. Do not search
for an ID inside its payload. Known malformed frames stop with the ID in the error.
Incomplete frames stop at EOF/deadline; when enough bytes exist, the error includes
their ID. Frames smaller than the ID itself stop with `packet id unavailable`.
This does not claim to interpret unknown gameplay effects.

## Golden-byte provenance

`packages/protocol/test/goldens.json` is frozen output from the independent
`tools/protocol-oracle.cpp`. It uses the exact C++ varint loop, explicit x86 LE
primitive writes, and the field orders above. Tests compare encoder output AND
decoder results to those bytes, including every CharacterCreate field. Tests
do not regenerate expectations and do not require C++ or the reference clones.

To reproduce and compare (without overwriting expectations):

```sh
c++ -std=c++20 -Wall -Wextra -Werror tools/protocol-oracle.cpp -o /private/tmp/ao-protocol-oracle
/private/tmp/ao-protocol-oracle > /private/tmp/ao-goldens.json
diff -u packages/protocol/test/goldens.json /private/tmp/ao-goldens.json
```

All implemented layouts were verified on both ends. Still unverified: runtime
behavior of a compiled VB6 server and any packet outside this explicit subset.
