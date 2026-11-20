# Argentum Online: should we rebuild the SERVER for a Spain server? (2026-11-20)

**Answer.** Not now, and not as a big-bang: launch on the existing VB6 server (ao-org "classic", AGPL-3.0) behind the new client, and start a **strangler rewrite in C#/.NET (Go is the close second) once a test-world on VB6 produces golden captures**, flipping sessions over when differential tests pass. Rewrite the server **later but deliberately**, because "easy ongoing development" is the one goal where VB6 genuinely loses (Windows + VB6 IDE + opaque native DLLs), and the rewrite is affordable in our economy (~80-320 agent hours, ESTIMATED), but its real gates are a runnable baseline and real players, not code.
**AOForever's approach (see `outputs/2026-11-19-aoforever-web-client.md`, not redone here)** teaches the same thing from the other side: they kept a VB6-lineage server and put a new client plus a gateway in front. A GPL-2.0 snapshot of their 2024 server exists and is a possible donor, not a better base (below).

## Smallest next step
Get the ao-org classic server running once, isolated, on a Windows VM (or Wine attempt) with `PYMMO=0`, and record a login + walk + chat + one fight through a transparent TCP proxy that dumps frames (uint16 LE length + int16 packet ID). Those captures are simultaneously (a) the proof that the client plan works (as in the 19 Nov client doc), (b) the golden files for any future rewrite, and (c) the decision data for this doc. **Build:** ~2-4 h agent time for proxy + dumper + frame decoder. **Wait:** a Windows box and the exact build flags (Ariel). If the server will not run at all, that, not code quality, is the real answer to "rebuild now".

## Server findings

All paths relative to the shallow clones of `ao-org/argentum-online-server-classic` (`S/`). Codex wrote the static assessment (read-only, nothing executed, full text kept in the session scratchpad `codex-server-final.md`); I re-checked the claims marked "orchestrator".

### What it is today
- **VB6, Windows-only, single thread, shared global arrays** for users, NPCs, maps, spells. 195 `.bas/.cls/.frm` files, **~111.8k lines**; biggest: `Protocol.bas` 8,600, `Protocol_Writes.bas` 4,803, `modHechizos.bas` 4,316, `InvUsuario.bas` 4,268, `Protocol_GmCommands.bas` 4,063. VERIFIED (Codex; orchestrator re-counted: 195 files, 111,823 lines, `Protocol.bas` 8,600).
- **Networking:** Aurora.Network (C++/Asio TCP, Apache-2.0) called from VB6 via COM; Winsock only for the client's auth channel. VERIFIED (Codex, `S/Codigo/modNetwork.bas:38-94`).
- **Loop:** cooperative poll loop plus form timers (1 s / 10 s / 60 s), NPC AI on its own 150 ms scheduler. Not a fixed tick. VERIFIED (Codex, `General.bas:695-731`, `frmMain.frm`, `intervalos.ini`).
- **Persistence: SQLite via ADODB/ODBC** (`Empty_db.db`, `base_db_definition.sql`, `ScriptsDB` migrations), with some legacy `.chr` file access left (auction offline delivery). Game definitions stay as DAT/INI. VERIFIED (orchestrator: `modDatabase.bas:43` `DRIVER={SQLite3 ODBC Driver}`). A real database is a big advantage for a rewrite: state can be migrated and compared.
- **Build profile:** the checked-in `Server.VBP:217` compiles with `PYMMO = 0`; the documented official build command uses `PYMMO=1` (encrypted token login, separate auth service). **A rewrite must pin one profile first.** VERIFIED (orchestrator + Codex `S/Agents.md:12-24`). For a Spain server we want `PYMMO=0` (no private official auth).

### Protocol: extractable, not documented
- Plain length-prefixed binary: `uint16 LE length` then `int16 packet ID`; `WriteInt` is a 7-bit varint, strings are UTF-8 with a varint byte count, arrays are SAFEARRAY-shaped. VERIFIED (Codex; orchestrator confirmed framing in the earlier client doc).
- **207 server-to-client and 316 client-to-server IDs** (PYMMO=0), implicit VB enums in `PacketId.bas` (conditional entries shift IDs). Count VERIFIED by Codex (static evaluation), not re-counted by me. Schema extraction is "moderate" for the byte format; a private ProtocolGenerator is referenced but not public.
- **No encryption on gameplay traffic**, no client hash enforced; anti-cheat callbacks only log (`S/Codigo/AntiCheat.bas:125-139`, VERIFIED by orchestrator). `AOACServer.dll` is opaque and unexamined: ESTIMATED risk, test live.
- **No wire golden files exist** (`Fixtures/` is SQL only). They must be captured (next step above).

### Hard parts (all ESTIMATED as work items, source facts VERIFIED by Codex)
- VB `Integer`/`Long` widths and intended wrap-around, `Single` vs `Double` rounding in the **speed-hack check** (orchestrator read `Protocol.bas:2094-2108`: `CLng(PacketTimerThreshold / .Char.speeding)` vs elapsed ticks, then `WritePosUpdate`), `Fix(Rnd * range)` with `Randomize Time` reseeds, UTF-8 vs BSTR strings, wrap-safe tick math, and the GM/admin command surface (4k lines).
- Client-side prediction means timing and position corrections must match closely, or movement rubber-bands.
- Maps are `.csm` (4- and 5-layer, signed) and `.dat` IDs must be preserved exactly.

### Stack recommendation
| Stack | Verdict (ESTIMATED) |
|---|---|
| **C#/.NET (recommended)** | Explicit int widths (`short`, `int`, `unchecked`), good TCP/async, P/Invoke if we must keep a native anti-cheat DLL, easiest to hand to Codex and to hire for. |
| **Go** | Close second: simple, portable, great for the gateway/proxy. Weaker on VB numeric emulation and shared mutable world (one goroutine owns state). |
| Rust | Parser/tooling strength, most friction translating the global-array world. |
| TypeScript/Node | Good for the gateway, tools and a shared TS protocol library with the web client; full simulation needs deliberate integer/float emulation. |
| Elixir | Great supervision, biggest redesign for this mutable simulation. |
Reason for C# over Go: this is a translation of 100k lines of integer-sensitive, mutable-state code, where numeric type fidelity beats goroutine elegance. Split decision if the web client is TypeScript: **gateway/protocol library in TS or Go, game simulation in C#**, one protocol spec generated into both.

### Strangler vs big-bang
**Strangler, but per SESSION/WORLD, not per feature.** Combat, inventory and movement share one mutable world, so routing "combat to the new server, inventory to the old" splits state (Codex, `Declares.bas:3761-3770`). Plan: (1) freeze a baseline (exe, DLLs, flags, DB); (2) transparent proxy captures goldens; (3) new server behind the same gateway, first for an empty test world; (4) differential harness: same DB snapshot, scripted actions, injected clock/RNG, compare bytes and state; (5) flip worlds when parity holds. Big-bang public cutover: avoid, since persistence and random/timing outcomes cannot be validated from captures alone.

### Effort: Build vs Wait (ESTIMATED; Codex model at 10-25 min per PR, not measured throughput)
| Build (agent wall-clock) | Wait (named gate, holder) |
|---|---|
| Spec, codec, proxy, harness: 25-45 PRs, **4-19 h** | Baseline: runnable Windows install, exact flags/DLLs (Ariel) |
| Login/map/move/chat MVP: 25-50 PRs, **4-21 h** | Real-client login and AOAC behaviour (opaque DLL) |
| Combat, items, spells, NPCs, economy, quests, guilds: 160-300 PRs, **27-125 h** | Player sessions for PvP, latency, trading: **1-2 weeks** of real use |
| Persistence, GM tooling, parity fixes: 90-180 PRs, **15-75 h** | GM walkthrough, restart/rollback, load, **48-72 h soak** |
| **Total ~80-320 agent hours** (300-575 PRs + 30-80 h analysis) | Asset permissions (Noland) and native-DLL redistribution: independent gates |
My own calibration: the low end is likelier for protocol/MVP (inspectable, test-driven), the high end for combat/economy parity, where the oracle is a running VB6 server. Overall verdict: **doable in our economy, not "easy"**; the cost is concentrated in behavioural parity, which is exactly the part players notice.

### Is a rewrite worth it for a Spain server?
- **For launch: no.** The goal is players and community; a 111k-line server that already works costs zero build hours. A Spain server needs localisation (strings, maps names, rules), config, events and moderation, all of which are DAT/INI/VB edits.
- **For easy ongoing dev: yes, eventually.** Pain points are structural: VB6 IDE on Windows, a single-threaded world, opaque COM/DLL dependencies, 4-8k-line packet files, no wire spec or tests. A typed, tested server is where agents (Codex) are most productive. But do it behind goldens, never by reading code and guessing.
- **Falsifier of "later":** if the Windows baseline will not run reproducibly in a day, or the community wants fast content changes that the VB6 toolchain blocks, move the rewrite earlier (start with the proxy/harness, which is useful either way).

### The AOForever GPL-2.0 server as a base (new input)
Checked in a fresh shallow clone of `Comunidad-Winter/AOForever.cc` (VERIFIED, `gh` + local):
- Licence file GPL-2.0; last push **2024-07-05**; tagged "Versión 1.0 estable"; `AOForever_Cliente` + `AOForever_Servidor` (VB6 `.VBP`). Server **~91k lines in 220+ files**, including stale duplicates ("Copia en conflicto de Santiago Ladeuix 2016-11-03" copies of `Protocol.bas`, `General.bas`).
- **Lineage:** AO 0.13-style `wskapiAO.bas` Winsock, `clsByteQueue`; no Aurora.Network, no SQL (grep for ADODB/SQLite/MySQL: none); characters are `.chr` ini-style files. So persistence is **harder to migrate and compare** than ao-org's SQLite.
- **Headers contradict the licence file:** `Protocol.bas` carries the Affero GPL **v1 or later** header (Maraxus) while the repo says GPL-2.0. ESTIMATED: ambiguous mix, ask a lawyer before shipping a derivative; AOForever's **live** server (market, retos, 2026 changes, AES framing) is closed, so this snapshot is two years behind what players actually see.
- Its packet IDs differ from ao-org's (earlier doc VERIFIED), so the choice of server fixes the choice of client protocol.
**Recommendation:** base on ao-org classic (current, SQLite, AGPL-3.0, matches the client plan); treat AOForever as a **donor** for ideas and gameplay diffs (premium/market/retos), not as the codebase. Pick AOForever's snapshot instead only if you want the simplest 0.13 plain protocol so existing MIT web clients (dakara-client family) work unchanged, at the cost of an old, file-based server. ESTIMATED.

### Licence (summary)
- Server and client code: **AGPL-3.0-or-later** (headers); a derived/translated public server must offer source to remote users, keep notices, mark changes. A clean-room reimplementation from captured behaviour is not automatically derivative (legal point, ESTIMATED, not legal advice); a line-by-line translation is.
- Assets: **CC BY-NC-ND 4.0** (Noland Studios): non-commercial, no adapted artwork; format conversion allowed; commercial use needs permission. Free Spain server is fine, monetisation needs a conversation.
- Do not reuse `ao20-shared-types` (proprietary) or redistribute CryptoSys DLLs; Aurora.Network is Apache-2.0.

## Sources
- Codex static assessment of `ao-org/argentum-online-server-classic`, `-client-classic`, `Aurora.Network`, `ao20-CryptoClient`, `ao20-shared-types`, `Recursos`: scratchpad `codex-server-final.md` (all line citations above come from it; 190k tokens, read-only).
- Orchestrator spot-checks (VERIFIED): `S/Server.VBP:217` (`PYMMO = 0`), line/file counts, `S/Codigo/AntiCheat.bas:125-139`, `S/Codigo/modDatabase.bas:43`, `S/Codigo/Protocol.bas:2094-2108`, `PacketId.bas` enum entries.
- `outputs/2026-11-19-argentum-online-client-port-assessment.md` and `outputs/2026-11-19-aoforever-web-client.md` (not redone).
- `github.com/Comunidad-Winter/AOForever.cc` (GPL-2.0 file, push date via `gh`, clone inspected).
- Not checked: running any server or DLL, `AOACServer.dll` internals, AOForever's live (closed) server, Noland's actual commercial-licence terms.
