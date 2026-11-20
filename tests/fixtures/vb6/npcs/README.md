# npcs fixtures (real VB6 server)

Recorded 2026-11-20 with `node tools/npcs-record.mjs` against the classic VB6 server (127.0.0.1:7667),
account `npcs@local.test`, character `TNpcs`. One line per frame:
`{"t_ms","dir":"c2s"|"s2c","id","name","hex"}`, `hex` = frame body (packet id included, length prefix excluded).

| File | Sub-feature |
| --- | --- |
| `session-full.jsonl` | NPCs and other players created around the login position, CharacterChange/Remove of another player, LeftClick on an NPC (too far: LocaleMsg 8), self, empty tile (1114) and a player (1105) |
| `session-npc-dialog.jsonl` | ~35 s in the area: NPC CharacterMove slides, clicks on a distant NPC. NPCDESC (ChatOverHead) was not reached: the NPC stayed >3 tiles away. |
| `session-npcdesc.jsonl` | NPCDESC ChatOverHead from a close NPC (captured by the PR #8 reviewer); its x,y are the receiver's position |
