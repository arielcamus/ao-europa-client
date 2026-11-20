# Chat (feat/chat)

Source of truth: the classic VB6 client and server under `~/Projects/ao-reference/`
(`argentum-online-client-classic`, `argentum-online-server-classic`), PYMMO=0. Packet ids are enum
positions in `PacketId.bas` (same count on both sides; Talk = 75 and ConsoleMsg = 37 already matched
live traffic). Types: `s` = String8, `i16/i32` = fixed LE, `b` = byte, `bool` = byte 0/1.

## Packets

| Dir / id | Name | Fields | VB6 writer | VB6 reader |
| --- | --- | --- | --- | --- |
| S→C 3 | RemoveDialogs | none | `WriteRemoveAllDialogs` | `HandleRemoveDialogs` |
| S→C 4 | RemoveCharDialog | charIndex:i16 | `PrepareMessageRemoveCharDialog` | `HandleRemoveCharDialog` |
| S→C 35 | ChatOverHead | chat:s, charIndex:i16, color:i32, isSpell:bool, x:b, y:b, minTime:i16, maxTime:i16 | `PrepareMessageChatOverHead` | `HandleChatOverHead` |
| S→C 36 | LocaleChatOverHead | chatId:i16, params:s, then the ChatOverHead tail | `PrepareLocaleChatOverHead` | `HandleLocaleChatOverHead` |
| S→C 37 | ConsoleMsg (existing) | message:s, font:b, channel:b (optional) | `PrepareMessageConsoleMsg` | `HandleConsoleMessage` |
| S→C 38 | ConsoleFactionMessage | message:s, font:b, label:s | `PrepareFactionMessageConsole` | `HandleConsoleFactionMessage` |
| S→C 39 | GuildChat | status:b, message:s | `PrepareMessageGuildChat` | `HandleGuildChat` |
| S→C 128 | ConsoleCharText | message:s, color:i32, sourceName:s, sourceStatus:i16, privileges:i16 | `PrepareConsoleCharText` | `HandleConsoleCharText` |
| S→C 141 | LocaleMsg | messageId:i16, message:s, font:b, channel:b (optional) | `PrepareMessageLocaleMsg` | `HandleLocaleMsg` |
| C→S 45 | GroupMessage | message:s | `WriteGrupoMsg` | `HandleGrupoMsg` |
| C→S 59 | GuildMessage | message:s, counter:i32 | `WriteGuildMessage` | `HandleGuildMessage` |
| C→S 60 | GuildOnline | none | `WriteGuildOnline` | `HandleGuildOnline` |
| C→S 61 | CouncilMessage | message:s | `WriteCouncilMessage` | `HandleCouncilMessage` |
| C→S 62 | FactionMessage | message:s | `WriteFactionMessage` | `HandleFactionMessage` |
| C→S 75 | Talk (existing) | message:s, counter:i32 | `WriteTalk` | `HandleTalk` |
| C→S 76 | Yell | message:s (no counter) | `WriteYell` | `HandleYell` |
| C→S 77 | Whisper | name:s, message:s | `WriteWhisper` | `HandleWhisper` |
| C→S 207 | GlobalMessage | message:s | `WriteGlobalMessage` | `HandleGlobalMessage` |

Gotchas found in the sources:

- Colours on the wire are VB `RGB()` longs: byte 0 red, byte 1 green, byte 2 blue.
- The LocaleMsg message id is named `messageId` in the codec, because `id` is the packet discriminant.
- The server's Talk answer is a ChatOverHead, never a ConsoleMsg. The console line `[Name] text` is made
  by the client (`WriteChatOverHeadInConsole`, option `CopiarDialogoAConsola`, default 1), and not for NPCs.
- A whisper goes to the console of both players as ConsoleCharText (the colour is RGB 157,226,20), and as
  ChatOverHead to higher-privilege observers only.
- ConsoleMsg `channel` (e_TextChannel) is decoded and ignored: the VB6 client does not route by it yet.
- Server text can carry a `~r~g~b~bold~italic` suffix and `KEY*arg*arg` prefixes
  (`NPCNAME`, `O`, `HECINF`, `ProMSG`, `HecMSG`, `HecMSGU`, `HecMSGA`, `ID`; over the head `LOCMSG`, `NPCDESC`,
  `PMAG`, `QUESTFIN`, `NOCONSOLA`). Locale ids resolve through `init/SP_LocalMsg.dat` (`[SP_MSG]`, parameters
  separated by U+00AC) and `init/sp_localindex.dat`, read from the local resource mount, never bundled.

## Client behaviour (ModGameplayUI.HandleChatMsg, ProtocolCmdParse.ParseUserCommand, frmMain)

- Enter opens the box, Enter sends; Delete opens the guild box (`SendTxtCmsg`, `/CMSG`).
  Colours `SendTxt` #202020 on #808080, bold Tahoma; `SendTxtCmsg` background #400000. 160 characters, only 32..250.
- `-text` yells, `\name text` whispers, `/GRUPO`, `/CLUSTER`, `/CMSG`, `/BMSG`, `/FMSG`, `/GLOBAL`, `/ONLINECLAN`
  use their channel packet, anything else is Talk. The last channel is remembered and prefilled next time.
- Clicking `[Name]` in the console starts a whisper to that name (spaces become `+`).
- Bubble life: 3000 ms + 60 ms per character (spells: `maxTime`, default 3500), shown 34 px above the head offset.

## Deliberate differences from VB6

- `LOCMSG*id*args` over the head: the VB6 reader looks for the arguments inside the id field (always empty);
  the web client reads them from the third field.
- Bubbles are a DOM layer over the map, not the bitmap font. Fade-out is 500 ms.
- A Talk that is rate limited keeps the text in the box and says so (VB6 drops it silently).

## Out of scope

GM commands, the guild dialog overlay (`DialogosClanes`, Delete key toggle), the NPC dialogue poster
(`NPCDESC` text shows in the bubble only), `TextOverChar` / `TextOverTile` floating effects, `/RMSG`
(a GM command), console channel filtering.
