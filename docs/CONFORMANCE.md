# VB6 conformance fixtures

**No HOO-era assets or data.** (Ariel, 2026-11-21.) HOO is Heroes of Old, AO20's next-generation client. Code, data and assets come only from the pre-HOO pins in `docs/DATA-PATCHES.md` ("Pre-HOO data pin"): no Dat, map, graphic or sound newer than Recursos `2bfa51e`, and no HOO packet (`Hoo*`, `Remort*`) in a fixture or codec.

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
| `movement/walk-into-creature-no-turn.jsonl`, `movement/walk-into-creature-turn.jsonl` | login as `Aotest` (GM), `/ACC 501` spawns a chicken next to us, tool unequipped (slot 17; re-equipped at the end). `no-turn`: a `Walk` into the chicken is refused (`PosUpdate`) and the following `Attack` swings at the old heading (`CharSwing` ShowText false). `turn`: `ChangeHeading` (what VB6 `MoveTo` sends for a blocked step) then `Attack`: `CharSwing` ShowText true (target found). Scenario `tools/conformance/scenario-walk-into-creature.mjs` (`AO_STEP=walk-only|turn`) |
| `buildings/bank-doors-closed.jsonl` | walking onto the Finanzas doorway (77,56)->(77,55): rejected (`PosUpdate` unchanged); the doors are objects 1424/1426 that were missing from `Obj.dat` |
| `buildings/carpentry-castle-trigger-bounce.jsonl` | Carpintería (door obj 2333 open at (65,79), `Llave=0`): stepping north into the doorway is accepted then undone by `GameLogic.DoTileEvents` (trigger 32 = EMPEROR_CASTLE_ENTRY_12, no castle exists): `AreaChanged` resync + `LocaleMsg` 2215, `PosUpdate` back to (65,80) |
| `buildings/bank-castle-trigger-bounce.jsonl` | Finanzas west door (77,55): `LeftClick` opens 1424 -> 1423 (`BlockPosition`x4 + `ObjectCreate`); stepping north is bounced the same way (trigger 29 = EMPEROR_CASTLE_ENTRY_9), `LocaleMsg` 2215. The east door (79,55) is shown as obj 1425 in the login `ObjectCreate` burst |
| `buildings/nix-building-castle-trigger-enters.jsonl` | after the server fix: Ciudad de Nix (map 34) building with trigger 24, door (43,47) opened by `LeftClick`, walking north (43,48)->(43,45) is accepted, no `LocaleMsg` 2215. The character was placed through the server DB (docs/DATA-PATCHES.md) |
| `buildings/church-patron-tile.jsonl` | walking into the Templo interior (trigger 20, ONLY_PATREON_TILE): `LocaleMsg` and `PosUpdate` unchanged |
| `bank/far-from-banker.jsonl` | `BankStart` with no target (LocaleMsg), `LeftClick` on the banker Krix (77,47) from (77,56), `BankStart` 9 tiles away (limit 6: refused), `BankDepositGold`/`BankExtractGold` of 100 with no gold (the banker answers with `LocaleChatOverHead`), `RequestAccountState`, `BankEnd` while not trading (ignored) |
| `bank/goliath-and-vault.jsonl` | inside the bank hall (77,51) after the map patch: `LeftClick` on Krix -> `Goliath`, gold deposit/withdraw refusals, `BankStart` -> 42 `ChangeBankSlot` + `BankInit`, deposit 2, `BovedaMoveItem`, extract, `BankEnd` -> `BankEnd` |
| `bank/deposit-move-extract.jsonl` | `BankDeposit` slot 3 to the first free vault slot and to an explicit slot, `BovedaMoveItem` (move and swap), `BankExtractItem` back, an empty slot, a newbie item refused. Each deposit answers `ChangeInventorySlot` + `ChangeBankSlot`; the distance limit for deposit is 10 |
| `trade/<scenario>-initiator.jsonl`, `-responder.jsonl` | two characters (Tbank, TItems), one file per side: `offer-and-accept` (invitation = `ShowPregunta` 1594, `ResponderPregunta`, `UserCommerceInit` after 24 `ChangeInventorySlot`, item and gold offers refused with locale 1140/1141/1138, trade chat both ways, `UserCommerceOk` twice, `UserCommerceEnd`), `reject`, `invitation-declined`, `cancel` (`UserCommerceEnd`), `give-back` |
| `skills/stats-skills-rest-requests.jsonl` | login as `Aotesta` (level 1 warrior; the server pushes `SendSkills` + `LevelUp` 10 at login), then `RequestSkills` -> `SendSkills`, `RequestAtributes` + `RequestMiniStats` -> `Atributes` + `MiniStats`, `RequestStats` (/EST) -> `LocaleMsg`/`ConsoleMsg` lines, `Rest` without a campfire -> `LocaleMsg` 755, `Meditate` (a warrior has no mana: no reply), `TrainList` without a target -> `LocaleMsg` 757 |
| `skills/spend-skill-point.jsonl` | `ModifySkills` with +1 point on skill 24 (Domar): no reply, `RequestSkills` reads it back (skill 24 = 1). Spent for good on `Aotesta` (10 -> 9 free points). Scenario `tools/conformance/scenario-skills.mjs` (`AO_SKILLS_STEP=read|spend`) |
| `core-session/quit-then-cancel-exit.jsonl` | login as `Npcschat`, `Quit` (39) then `CancelarExit` (247) in the same instant (`tools/conformance/scenario-cancel-exit.mjs`): this server's closing counter is 0, so `Quit` answers the countdown `LocaleMsg`, `ParticleFX`, `CreateFX` and `Disconnect` within 8 ms and the cancel is accepted silently (no `LocaleMsg` 578, `Counters.Saliendo` is already false). Esc during a live countdown therefore cannot be shown against this server |
| `quests/empty-quest-log.jsonl` | `QuestListRequest` (260) of a level-1 character: `QuestListSend` with count 0; `QuestDetailsRequest` for an empty slot is ignored (no reply) |
| `quests/npc-offer-unavailable.jsonl` | `LeftClick` on Seraphia (NPC 11, map 1 77,32): `NpcQuestListSend` with quest 2 (level 6, class Trabajador) in state 3 (cannot do it) |
| `quests/npc-accept-log-abandon.jsonl` | Makrom (NPC 407, 54,56): `NpcQuestListSend` of six quests (407 available, the rest state 3), `QuestAccept` 1 -> `LocaleMsg` 1264 + `UpdateNPCSimbolo` 4, `QuestListRequest` -> `QuestListSend` [407], `QuestDetailsRequest` -> `QuestDetails` (kill counters 0), `QuestAbandon` -> `LocaleMsg` 2115 + empty `QuestListSend`. Recorded with `AO_QUEST_STEP=makrom` of `tools/conformance/scenario-quests.mjs` |
| `quests/obj-quest-item.jsonl` | `UseItem` on Obj 3305 "Nota de Rescate" (ObjType 51, QuestId 123) by a level-16 Trabajador: `ObjQuestListSend` (S174) with quest 123 (RequiredLevel 16, five required objects, RewardGLD 1450, RewardEXP 15750 x ExpMult 4 = 63000). Recorded with `AO_ONLY=quest` of `tools/real-server/crafting-quest-record.mjs` |
| `combat-spells-2/bow-shoot-snake.jsonl` | map 2 (Bosque sur de UI), character TSpells (class Paladin via the server DB, see the PR): equip the bow then the arrows (arrows first is refused, locale 2145), use the bow: `WorkRequestTarget` skill 12 (Proyectiles), `WorkLeftClick` at the snake, then the snake (NPC 502) kills the archer: `NPCKillUser`, `UpdateHP` 0, death `CharacterChange`, inventory dropped |
| `combat-spells-2/cast-dart-snake.jsonl` | Dardo Mágico (spell slot 2) at a snake: `CastSpell`, `WorkRequestTarget` skill 1, `WorkLeftClick`, `ParticleFXWithDestino`, `UpdateMana`, `UpdateExp` |
| `combat-spells-2/hide-key.jsonl` | the O key (`Work` skill 7, Ocultarse): safe map 1 answers with locale 708, map 2 hides the character: `SetInvisible` (charIndex, true, x, y) to the player |
| `combat-spells-2/safe-toggles.jsonl` | `SeguroClan` (263) and `SeguroResu` (268) twice each, `PartySafeToggle` twice: `ClanSeguro` (157), `SeguroResu` (162), `PartySafeOff` (23), `PartySafeOn` (22) |
| `combat-spells-2/snake-poison-antidote.jsonl` | a snake bites, the antidote (Poción Violeta, slot 2) is drunk: locale 682 + `UpdateUserStats` + `ChangeInventorySlot`; the snake then kills the character (`NPCKillUser`) |
| `gm/non-gm-commands-refused.jsonl` | login as `Aotest` (a normal player: `Privilegios` false) and send 15 GM commands (`/ONLINE`, `/PANELGM`, user list, `/CC`, `/MOTDCAMBIA`, `/DONDE`, `/CI 38 5`, `/MOD ORO`, `/ACC 501`, `/REVIVIR`, `/TELEP`, `/INVISIBLE` x2, `/RMATA`, `/SUM`, `/INFORMACION`): the server answers `LocaleMsg` ("Comando deshabilitado para tu cargo") and does nothing. |
| `gm/admin-commands.jsonl` | the same login after the server reloaded Server.ini (`Admin2=Aotest|aotest@local.test`): `Privilegios` true; `/ONLINE` (UserOnline + locale), `/PANELGM` (ShowSOSForm, ShowGMPanelForm), user list (UserNameList), `/CC` (SpawnListt), `/MOTDCAMBIA` (ShowMOTDEditionForm), `/DONDE`, `/CI 38 5` (locale + inventory slot), `/MOD ORO 1000` (UpdateGold), `/ACC 501` (CharacterCreate of the NPC), `/REVIVIR`, `/TELEP` (resync), `/INVISIBLE` x2, `/RMATA`, `/SUM`, `/INFORMACION`. Recorded with `tools/conformance/scenario-gm.mjs`. Side effects on Aotest were reverted in the DB |
| `combat-items/paralysed-login-expiry.jsonl` | character `Aotesta` with `user.is_paralyzed=1` set in the DB: `ParalizeOK` (97) arrives during the login, BEFORE `Logged`, and again ~20 s later when the paralysis expires (the packet is a toggle). Recorded with `tools/real-server/combat-items-record.mjs paralysed-login` |
| `combat-items/learn-spell-scroll.jsonl` | `TSpells`, scroll in slot 13 (amount set to 1 in the DB): `UseItem` -> `ChangeSpellSlot` (slot 4, spell 11) + `ChangeInventorySlot` (slot emptied) |
| `combat-items/priest-revive-click.jsonl` | `Aotesta` dead in the DB next to the priest Juan XXI (map 1, 77,66): the `LeftClick` on the priest already revives (`LocaleMsg` 585 `¡Has sido resucitado!`, `UpdateHP` 20, `UpdateMana`, `CharacterChange` to the living body, `ParticleFX`, `PlayWave`); the `/RESUCITAR` sent afterwards is ignored. Recorded with `priest-revive` |
| `followups/gm-make-dumb.jsonl` | pre-HOO server 9ccd7fad, `Aotest` (Admin): `/ESTUPIDO Aotest` (MakeDumb 161) -> `Dumb` (75), `/NOESTUPIDO Aotest` (MakeDumbNoMore 162) -> `DumbNoMore` (86): the only real source of Dumb with the pinned data (HandleMakeDumb). Recorded with `tools/conformance/scenario-followups.mjs` (`AO_FU_STEP=dumb`) |
| `followups/trainer-list.jsonl` | pre-HOO: `/ACC 649` spawns an Entrenador next to `Aotest` (map 1, 51,43), `LeftClick` one tile above it selects it (LookatTile tries y+1 first), `TrainList` (46) -> `TrainerCreatureList` (88) Murcielago, Lobo, Serpiente, Escorpion, Goblin; `/RMATA` removes it (`CharacterRemove`). `AO_FU_STEP=trainer` |
| `followups/pirata-viajar-form.jsonl` | pre-HOO: `/ACC 301` (Apostador, NpcType 10 = Pirata), one step west so no user stands on or below the NPC tile, `LeftClick` on the NPC tile -> `ViajarForm` (147) with 0 destinations and Interface 0 (TransportCity* is only loaded for NpcType 26 Transporter, none in the pinned npcs.dat); `/RMATA` removes it. A `ShowMessageBox` 1761 in it is another session trying the same character. `AO_FU_STEP=travel` |
| `guild/guild-flow-leader.jsonl`, `guild/guild-flow-applicant.jsonl` | two simultaneous sessions (leader `Wintest`, applicant `Windowsapp`, GM `Aotest` for `/MOD LEVEL`, `/MOD SKILLS Liderazgo`, `/DAR` of the four foundation gems, not recorded). Leader: `QuieroFundarClan` -> `ShowFundarClanForm`, `CreateNewGuild` (WinGuild, neutral) -> tag update, gems consumed, `GuildLeaderInfo`; applicant: lowercase `GuildRequestDetails` `winguild` resolves (`GuildDetails` answers the upper-cased name: `modGuilds.GuildIndex` upper-cases both sides), `GuildRequestMembership` `WINGUILD` -> locale 1155; leader gets `GuildChat` Msg2039, the panel lists the applicant (the request list ends with a NUL), `GuildMemberInfo` -> `CharacterInfo` (name upper-cased, level, race, class, previous petitions), `GuildRequestJoinerInfo` -> `ShowUserRequest` (99, not `OfferDetails`), `GuildRejectNewMember` -> the applicant gets `ConsoleMsg` "2036 : <reason>"; a second application and `GuildAcceptNewMember` without 500 gold -> locale 2163 (accept costs the leader 500 gold). A level-1 applicant is refused: "Los newbies no tienen derecho a entrar a un clan." Recorded with `tools/real-server/record-guild-flow.mjs` (phase one) |
| `guild/guild-accept-leader.jsonl`, `guild/guild-accept-applicant.jsonl` | phase two (`AO_PHASE=accept`): the leader gets 1000 gold (`/MOD ORO`), accepts the pending applicant: `UpdateGold` 500, `UpdateTagAndStatus` with the clan, locale 1809, `GuildLeaderInfo` with two members; the applicant's `RequestGuildLeaderInfo` is answered with `eguildNews` (the member view of frmGuildNews: news, allied guilds, members, level, exp), `GuildRequestDetails` shows 2 members; the leader's `GuildKickMember` -> `GuildChat` Msg2038, tag back to no clan, locale 1810. Undo: applicant level back to 1 with `/MOD LEVEL 1`, leader gold 0. The leader and WinGuild stay as throw-away test data |

Server facts verified while recording (VB6 `HandleLeftClick` / `HandleWorldAction` / `HandleDoorAction` / `LegalWalk`):

- `LeftClick` is `x, y, counter:int32`; without the counter the packet is logged as edited and ignored. `DoubleClick` is read and ignored.
- `HandleLeftClick` skips the world action when ANY character (the player included) stands on `(x,y)` or `(x,y+1)` and when a non-interactable NPC does.
  Otherwise an object on `(x,y)` is used directly (a door toggles); only if `(x,y)` has no object does it try `(x+1,y)`, `(x+1,y+1)`, `(x,y+1)` in that order.
  Reach is Euclidean `Distance <= 2`. A `Llave=1` door answers with a locale message; a `Subtipo=1` door also toggles `(x-3,y+1)`.
- Walking: `LegalWalk` refuses the move when the TARGET tile's `Blocked` has bit `2^(heading-1)` (N=1,E=2,S=4,W=8), a `FLAG_AGUA` tile (0x20) on foot, an NPC/user on it, a Patreon-only tile (trigger 20) for non-patrons, and castle-entry triggers for non-members.
- Tile exits (TE) warp with `ChangeMap` + `CharacterCreate`(self) + `UserCharIndexInServer`.
- Packet counters are per family (`PacketNames`), per connection, started at 1 (`apps/web/src/packet-counters.ts`).
| `extras/live-events-commands.jsonl` | `Aotest` as GM: fifteen packets of `packets/extras.ts` sent in a row (`EventoInfo`, `SubastaInfo`, `MapPriceEntrance`, `Participar` -1, `OfertaInicial`, `Casarse`, `Duel`, `AcceptDuel`, `CancelDuel`, `QuitDuel`, `AntiMacroMessage`, `LobbyCommand` list, `CuentaRegresiva`, `EventoFaccionario`, `FinEvento`): the server answers with `LocaleMsg` / `ConsoleMsg` and never disconnects. Recorded with `tools/extras-record.mjs` |
| `extras/live-lobby.jsonl` | `StartEvent` (lobby, levels 1..47, 4 players) makes a lobby (`LocaleMsg` 463 with the settings), `LobbyCommand` open, `Participar` -1, `LobbyCommand` list answers `0) Aotest`, `CancelarEvento` closes it. The server did not send `ReportLobbyList` (198) in this flow, so that codec rests on the VB6 writer and the golden in `packages/protocol/test/extras-goldens.json` |
| `audio/force-midi-map.jsonl` | **pre-HOO 9ccd server.** `Aotest` (Admin) on map 1: `ForceMIDIToMap` (152) midi 5 map 0 -> `PlayMIDI` file 5, loops -1 (the `PrepareMessagePlayMidi` default); midi 0 -> `PlayMIDI` file 4 (the map's `music_numberLow`). The server sends 54 only from this GM command and `/FORCEMIDIALL`; both clients ignore it. Recorded with `tools/conformance/scenario-force-midi.mjs` |
| `audio/invisible-walker-steps.jsonl` | **pre-HOO 9ccd server**, the WATCHER side (`Ambwatcher`, account `ambience2@local.test`) of two non-GM sessions on map 1: `Ambwalker` (`ambience@local.test`) drinks an invisibility potion (OBJ1096, put in its slot 16 by a DB UPDATE, reverted) -> `SetInvisible`, then walks: beyond Manhattan 3 tiles the watcher gets `PlayWaveStep` (188: Grh of the tile, Euclidean `Distance` rounded, `Sgn` dx, the alternating step), within 3 tiles `PosUpdateChar`. 17 steps. Recorded with `tools/conformance/record-invisible-steps.mjs` |
| `spells/dardo-magico-kills-creature.jsonl` | **pre-HOO 9ccd server**, browser client (`Sonmago`, level 1 mage, account `spellsound@local.test`) on map 1: casts Dardo Mágico (spell 1, `WAV=16`, `ParticleViaje=186`, `FXgrh=15`) at a Gallo (15 HP) the GM spawned with `/ACC 501` and kills it. The pinned `CastOnNpc` sends one `ParticleFXWithDestino` with the NPC as BOTH emitter and receptor (wave 16, fx 1) and no `PlayWave`; the NPC's `CharacterRemove` follows in the same TCP batch. Recorded with `tools/spell-sound-live/spell-sound.live.ts` |
| `spells/dardo-magico-training-dummy.jsonl` | same character: three Dardo Mágico casts at the Ullathorpe training dummy (NPC 602, 1,000,000 HP, char 9 at 59,32) from 59,40: three `ParticleFXWithDestino` (dummy as emitter and receptor, wave 16), no `PlayWave` 16. Same tool (`AO_TARGET=9 AO_WALK=U6,R2`) |
