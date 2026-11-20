# Argentum Online: modern CLIENT against the current VB6 server

**Verdict.** Feasible without touching the server: the wire protocol is a plain, unencrypted, length-prefixed binary stream and the server does not enforce the anti-cheat or any client hash in the classic profile. A login-and-walk prototype is days of agent time; a faithful, playable replacement is a large rewrite (102k VB6 lines), mostly UI and render detail, not protocol.
**Recommendation.** Godot 4 (GDScript), native first, with a standalone protocol library; web (TypeScript + Pixi + WebSocket bridge) is the runner-up if browser delivery matters most. Client replacement is the easier direction than replacing the server.

Date: 2026-11-19. Method: Codex ran read-only over shallow clones (client-classic, server-classic, Aurora.Network, ao20-CryptoClient, ao20-shared-types, ao-unity and four community ports); I then spot-checked the key claims myself. Nothing was built or run. Codex's full answer is appended below as "Codex assessment" so every citation is kept; this top part is the orchestrator's summary and corrections.

## Smallest next step
Write a headless TypeScript or GDScript bot that opens TCP to a local test server and does: Aurora frame (uint16 LE length + int16 LE packet ID), `LoginAccount` (305), `LoginExistingChar` (73), then walk (78). Run it against an isolated server on Windows. If the bot stays connected past 30 s and moves, the whole migration premise is proven. Cost: Build ~1-2 h agent time, Wait: someone with a Windows box (or a Wine attempt) and the exact server build.

## Spot-check results (orchestrator)
All VERIFIED by me directly in the clones:
1. **Framing.** Aurora.Network `Channel.cpp:21` `k_Header = 2`, written at `:139` as UInt16 length then body. Client networking is Aurora.Network COM (`CODIGO/modNetwork.bas:19-80`), not the Winsock control. I had expected Winsock from the brief; Winsock only appears in the separate external-auth socket (PYMMO=1).
2. **No encryption on gameplay traffic in the classic profile.** `AO20CryptoSysWrapper.Encrypt/Decrypt` has no callers in the client gameplay path; AES-128-CFB is used only for the PYMMO=1 account service. Both projects compile with `PYMMO = 0` (`Argentum20.vbp:236`, `Server.VBP:217`).
3. **Login in PYMMO=0.** `Protocol_Writes.bas:272-283`: `Int16 id(73), Int32 char_id, String8 name`. No version bytes, no hash. The PYMMO=1 variant (`:174-194`) sends an encrypted session token plus 3 version bytes, so it needs the official auth service. **Caveat Codex only half-stated: the live official Argentum 20 servers run PYMMO=1 (private), these public repos are the classic profile, so "the CURRENT server" is only reproducible with the public classic build.**
4. **Anti-cheat does not kick.** `Server/Codigo/AntiCheat.bas:125-139` and `:206-212`: unregistered users and EAC remove-requests only call `LogSecurity`. Client `ValidateResources` returns True unconditionally (`ModValidateResources.bas:3-5`). Note `Example.feature_toggle.ini:43-44` ships `anti-cheat value=1`, so the server will send EAC packets, which the new client can ignore. Caveat: `AOACServer.dll` is an opaque binary and was not examined; test in practice.
5. **Licence.** `ao-org/Recursos/license.txt`: "Argentum Online Assets (c) by Noland Studios is licensed under CC BY-NC-ND 4.0"; Noland-made resources cannot be used in commercial projects without a commercial licence; third-party resources need their own licences. Code: AGPL-3.0 (headers say or-later).
Corrections to Codex: none of substance. My additions are items 1 and 3 (Winsock vs Aurora; classic vs live-official profile). Codex's 316 client / 207 server packet count and varint/SafeArray details I did not re-count (ESTIMATED by me, VERIFIED by Codex).

## Hardest part
Not the protocol. It is (a) matching the five-layer render order, roof fade, lights, additive blending and the exact walk/animation feel (client-side prediction with server position corrections), and (b) the sheer UI surface (64 forms, 34.7k lines) plus asset formats that no community port supports at the current version (5-layer `.csm` maps, 32-bit GRH refs, `cuerpos.dat` templates). Existing ports (Godot, LWJGL3, web, libGDX) target the old 0.13 protocol and old formats: useful donors, not drop-ins. Ariel's `argentum-world` project is a Node server plus Three.js client; its asset pipeline is not compatible with this client set either (not checked in depth).

## Effort
| Build (agent wall-clock, Codex writing) | Wait (gate, holder) |
|---|---|
| Protocol lib + headless bot: ~3-15 h (Codex), my estimate 2-6 h given the protocol is inspectable | Exact server build, flags, DLLs, isolated Windows box (Ariel / server maintainers) |
| Asset loaders + fixtures: ~3-10 h | Pinned asset release; permission for redistribution (Noland Studios) |
| World renderer, characters, prediction, audio: ~4-19 h | Veteran player judging feel (Ariel or a tester) |
| Core playable UI/gameplay: ~6-25 h | Scope choice for beta (Ariel) |
| Total playable beta: Codex 19-83 h, ESTIMATED; I would plan ~25-40 h of agent time | Calendar driven by gates, not by build |
Full parity adds 20-100 h more (Codex). Browser bridge adds 2-8 h.

**Client vs server port.** Client replacement is easier for a production-compatible result: the server is the authority with all rules, database and timing, and an old VB6 client has no tolerance for deviation; a new client only has to speak the protocol and render. A new-server prototype with no graphics is quicker to get something running but full behavioural parity is far larger. (Check against the sibling assessment in `2026-11-19-argentum-online-port-assessment.md`.)

## Licence, short
- Reusing or translating the VB6 client code makes the result AGPL-3.0-or-later: ship source to users, keep notices. A web client served to browsers is distribution too.
- A clean-room client that only speaks the protocol is not automatically derivative (legal point, ESTIMATED, not legal advice).
- Original graphics, sound, music: CC BY-NC-ND. Unmodified, non-commercial redistribution with attribution is allowed; commercial use or adapted artwork needs Noland Studios permission. Technical format conversion is distinguished from adaptation. That means free hobby client: fine; monetised or art-changed: ask first.
- Do not reuse `ao20-shared-types` (proprietary licence). Godot and web community clients are MIT; Aurora.Network is Apache-2.0.

## Browser path
Browser (WSS binary) to a websockify-style bridge to raw TCP to the VB6 server. Preserve Aurora frames inside the stream, keep a byte accumulator, disable Nagle on the proxy hop. Downside: server sees the proxy IP (per-IP character creation limit of 15, `clsAntiMassClon.cls:41`); a bridge already exists in the ArgentumOnline-Mobile repo.

---

# Codex assessment (full, unedited)

**ESTIMATED:** A replacement client is feasible without changing the VB6 server, but full visual and gameplay parity is a substantial rewrite. I recommend Godot 4 with a separately tested protocol layer. (`argentum-online-client-classic/CODIGO/Protocol_Writes.bas:174`; `ArgentumOnlineGodot/engine/autoload/game_assets.gd:133`)  
**VERIFIED:** The inspected server code does **not disconnect clients for missing EAC registration**: both the registration timeout and removal callback only log. That removes a major source-level blocker, subject to checking the deployed binaries. (`argentum-online-server-classic/Codigo/AntiCheat.bas:125`; `argentum-online-server-classic/Codigo/AntiCheat.bas:206`)

## a) Client architecture today

This was a read-only static assessment. No repository code, executable, build, converter, or test was run. **VERIFIED** means observed in source, configuration, licence text, or static counts. **ESTIMATED** identifies recommendations, feasibility judgments, and work estimates.

For compact file:line citations, these prefixes expand to the following directories:

```text
C = argentum-online-client-classic/CODIGO
S = argentum-online-server-classic/Codigo
N = Aurora.Network/Code
G = ArgentumOnlineGodot/engine/autoload
J = argentum-online-lwjgl3/src/main/java/org/aoclient
W = ao-web-client
M = ArgentumOnline-Mobile/core/src/org/gszone/jfenix13
```

**VERIFIED:** The client README identifies client **5.6.64** and paired server **5.6.76**, with pinned commits. However, the server project’s version fields still say **5.6.75**. The stored project settings select `PYMMO=0` and `DEBUGGING=1`; the client also selects `Compresion=0`, `ENABLE_ANTICHEAT=0`, and `ENABLE_BASS=1`. These settings are the assessed source profile, not proof of a deployed executable’s settings. (`argentum-online-client-classic/README.md:3`; `argentum-online-client-classic/README.md:5`; `argentum-online-server-classic/Server.VBP:210`; `argentum-online-server-classic/Server.VBP:217`; `argentum-online-client-classic/Argentum20.vbp:236`)

| Area | Finding |
|---|---|
| Program structure | **VERIFIED:** VB6 forms, standard modules, and classes share substantial global state. The main loop renders, checks input, pumps Windows events, polls networking, and updates anti-cheat. This is a tightly integrated desktop client. (`C/engine.bas:2056`; `C/engine.bas:2072`; `C/engine.bas:2130`) |
| Rendering API | **VERIFIED:** The active renderer uses **DirectX 8, Direct3D8, and D3DX8**. DX7 is not the API instantiated by this renderer. (`C/clsRenderer.cls:30`; `C/clsRenderer.cls:71`) |
| Tile engine | **VERIFIED:** Tiles are 32×32 pixels. The current map model has **five layers**: ground; two walkable overlay passes; characters, objects, and layer 4; then particles/projectiles and layer 5 roofs. Large objects and layer 4 receive a second pass within each row. (`C/TileEngine.bas:416`; `C/Declares.bas:701`; `C/TileEngine_RenderScreen.bas:46`; `C/TileEngine_RenderScreen.bas:166`; `C/TileEngine_RenderScreen.bas:229`; `C/TileEngine_RenderScreen.bas:276`; `C/TileEngine_RenderScreen.bas:377`; `C/TileEngine_RenderScreen.bas:408`) |
| Sound | **VERIFIED:** The audio abstraction supports BASS OGG playback, legacy DirectMusic MIDI, and DirectSound WAV fallback. SFX resolution prefers OGG while retaining WAV handling. (`C/clsAudioEngine.cls:200`; `C/clsAudioEngine.cls:466`; `C/clsAudioEngine.cls:503`; `C/clsAudioEngine.cls:545`) |
| Input | **VERIFIED:** Movement polls key state through a pressed-key queue, respects window/input focus, and invokes directional movement. Forms separately handle inventory and spell mouse interactions. (`C/General.bas:622`; `C/General.bas:650`; `C/frmMain.frm:2355`; `C/frmMain.frm:2417`) |
| Networking | **VERIFIED:** Gameplay uses the Aurora.Network COM client in the `DIRECT_PLAY=0` branch. It explicitly flushes/polls and dispatches received messages to `Protocol`. Winsock remains relevant to the separate external-auth socket; DirectPlay is an alternative conditional implementation. (`C/modNetwork.bas:19`; `C/modNetwork.bas:52`; `C/modNetwork.bas:80`; `C/modNetwork.bas:142`; `C/modNetwork.bas:150`; `C/frmConnect.frm:34`) |
| Resources | **VERIFIED:** Startup loads graphics indices, animation templates, character parts, effects, particles, and localized gameplay metadata. Textures come from numbered PNGs or custom compressed archives. Maps are loaded from local files. (`C/Recursos.bas:276`; `C/Recursos.bas:883`; `C/Recursos.bas:1239`; `C/clsTexManager.cls:293`) |

**VERIFIED, static count:** The `.vbp` references **204 source files: 103 modules, 37 classes, and 64 forms**, totaling **102,270 physical lines**. Counts include comments, blank lines, form designer declarations, conditional branches, and final unterminated lines. They exclude unreferenced source files and binary assets, so they are not executable SLOC. The area assignments below are a reporting classification. (`argentum-online-client-classic/Argentum20.vbp:12`; `argentum-online-client-classic/Argentum20.vbp:88`; `argentum-online-client-classic/Argentum20.vbp:177`)

| Area | Files | Physical lines | Source anchors |
|---|---:|---:|---|
| **VERIFIED:** Forms | 64 | 34,687 | `argentum-online-client-classic/Argentum20.vbp:12`; `C/frmMain.frm:1` |
| **VERIFIED:** Protocol, transport, command parsing | 9 | 15,592 | `C/Protocol.bas:1`; `C/Protocol_Writes.bas:1`; `C/ProtocolCmdParse.bas:1` |
| **VERIFIED:** Renderer, tile engine, lighting, particles, fonts | 19 | 13,421 | `argentum-online-client-classic/Argentum20.vbp:88`; `C/engine.bas:1` |
| **VERIFIED:** Resource loading and compression | 2 | 3,634 | `C/Recursos.bas:1`; `C/modCompression.bas:1` |
| **VERIFIED:** Audio | 4 | 3,133 | `argentum-online-client-classic/Argentum20.vbp:144`; `argentum-online-client-classic/Argentum20.vbp:175` |
| **VERIFIED:** Login, authentication, crypto, integrity helpers | 9 | 6,098 | `C/ModAuth.bas:1`; `C/basCryptoSys.bas:1`; `C/AntiCheat.bas:1` |
| **VERIFIED:** Tests and test harness | 34 | 7,708 | `argentum-online-client-classic/Argentum20.vbp:177` |
| **VERIFIED:** Other state, UI support, input, utilities | 63 | 17,997 | `C/General.bas:1`; `C/modBindKeys.bas:1`; `C/ModGameplayUI.bas:1` |
| **VERIFIED:** Total | **204** | **102,270** | `argentum-online-client-classic/Argentum20.vbp:12` |

## b) What the new client must reproduce

### Transport and serialization

**VERIFIED:** The gameplay wire format is:

```text
uint16 little-endian payload length
    int16 little-endian packet ID
    packet-specific fields
```

The length excludes its own two bytes. Aurora reads a header and then that many body bytes. Its implementation writes native integer representations, which are little-endian on the VB6 Windows target. (`N/Foundation/Private/Network/Detail/Channel.cpp:125`; `N/Foundation/Private/Network/Detail/Channel.cpp:218`; `N/Foundation/Public/Network/Writer.hpp:85`; `S/Protocol.bas:198`)

**VERIFIED:** There is one dispatched AO message per Aurora frame. Unknown/unhandled IDs and trailing bytes after a handler cause disconnection. Concatenating two AO messages inside one Aurora payload is therefore incompatible. (`S/Protocol.bas:950`; `S/Protocol.bas:959`)

| Primitive | Required behavior |
|---|---|
| Fixed integers | **VERIFIED:** Distinguish `WriteInt8`, `WriteInt16`, and `WriteInt32`, including signed interpretation where the receiving field requires it. (`N/Foundation/Public/Network/Writer.hpp:120`; `N/Foundation/Public/Network/Writer.hpp:132`; `N/Foundation/Public/Network/Writer.hpp:144`) |
| `WriteInt` | **VERIFIED:** This is a variable-length, seven-bit integer encoding, not a fixed 32-bit integer. The writer is not ZigZag encoding; negative values require exact compatibility fixtures rather than assuming a standard signed-varint format. (`N/Foundation/Public/Network/Writer.hpp:109`; `N/Proxy/Public/Network/COM_Writer.cpp:103`) |
| Booleans | **VERIFIED:** COM converts the VB boolean to Aurora’s one-byte boolean. Do not serialize VB6’s in-memory two-byte `True=-1` representation. (`N/Proxy/Public/Network/COM_Writer.cpp:94`; `N/Foundation/Public/Core/Common.hpp:29`) |
| Strings | **VERIFIED:** `String8` is **UTF-8**, prefixed by a varint byte length. `String16` has a varint count followed by 16-bit units. The current Aurora `String8` path is not the CP1252 implementation found in an older port. (`N/Proxy/Public/Core/Proxy.hpp:81`; `N/Foundation/Public/Network/Writer.hpp:180`; `J/network/protocol/Protocol.java:547`) |
| Floating point | **VERIFIED:** Separate 32-bit and 64-bit real writers exist. Field widths must follow the actual packet writer/reader. (`N/Foundation/Public/Network/Writer.hpp:168`) |
| Arrays | **VERIFIED:** SafeArray serialization includes dimensions, lower bounds, and element counts before raw elements. It is not simply a length-prefixed byte blob. (`N/Proxy/Public/Network/COM_Writer.cpp:232`) |

**VERIFIED:** Under `PYMMO=0`, the enums contain **316 non-sentinel client message IDs** and **207 non-sentinel server message IDs**. Their order defines their numeric values. Conditional account entries change subsequent IDs under `PYMMO=1`. Enum membership does not guarantee that every entry has an implemented handler. (`S/PacketId.bas:20`; `S/PacketId.bas:222`; `S/PacketId.bas:237`; `S/PacketId.bas:545`; `S/Protocol.bas:950`)

| Direction | Important IDs, verified for `PYMMO=0` |
|---|---|
| Client → server | **VERIFIED:** Existing character **73**, new character **74**, walk **78**, attack **80**, anti-cheat message **302**, create account **304**, login account **305**, capabilities **312**. (`S/PacketId.bas:312`; `S/PacketId.bas:317`; `S/PacketId.bas:543`; `S/PacketId.bas:546`; `S/PacketId.bas:555`) |
| Server → client | **VERIFIED:** Connected **1**, logged **2**, position correction **31**, intervals **158**, anti-cheat message **196**, anti-cheat start **197**, account character list **199**. (`S/PacketId.bas:22`; `S/PacketId.bas:52`; `S/PacketId.bas:181`; `S/PacketId.bas:219`; `S/PacketId.bas:223`) |

**ESTIMATED:** Freeze the complete enum and derive a field schema from both sides’ handlers and writers. Implement all messages needed by the supported player workflows, plus safe decoding of incoming messages for deferred features. Modern optional capabilities should remain unadvertised until implemented; the server explicitly checks their negotiated version and mask. (`C/Protocol_Writes.bas:174`; `S/Protocol.bas:1231`; `S/Protocol.bas:1251`)

### Login, versions, encryption, and executable checks

**VERIFIED:** For the stored **`PYMMO=0` profile**, the handshake is:

1. Server sends `Connected`. With `DEBUGGING=1`, it includes a SafeArray containing bytes 1 through 10.
2. Client sends `LoginAccount`: ID 305, email `String8`, password `String8`.
3. Server checks the account database and sends the character list.
4. Client sends `LoginExistingChar`: ID 73, character ID `Int32`, character name `String8`.
5. Server connects the character and sends world state.

The login payload has **no version bytes or executable hash** in this profile. The account handler compares the supplied password field directly in its database query. (`S/modNetwork.bas:188`; `S/Protocol_Writes.bas:77`; `C/Protocol.bas:497`; `C/Protocol_Writes.bas:252`; `S/Protocol.bas:1403`; `C/Protocol_Writes.bas:272`; `S/Protocol.bas:1444`)

**VERIFIED:** New-character creation differs too: `PYMMO=0` sends the name and five `WriteInt` fields for race, gender, class, head, and home. It must not use the older port’s byte/short layout. (`C/Protocol_Writes.bas:296`)

**VERIFIED:** For **`PYMMO=1`**, authentication is a separate protocol through Winsock. An open-session request begins `00 AA 00 04`; account login uses opcode `DE AD` and big-endian two-byte lengths. Credential fields use AES-128-CFB, no padding, with the wrapper setting IV equal to the key and returning Base64. This framing is distinct from Aurora gameplay framing. (`C/ModAuth.bas:132`; `C/ModAuth.bas:165`; `C/ModAuth.bas:175`; `C/AO20CryptoSysWrapper.bas:19`)

**VERIFIED:** That path has an executable-dependent key: it hashes `Argentum.exe` using SHA-256, selects/reorders characters from the hash, converts the resulting string to hex, and uses it to decrypt the auth session token. The call is conditional on `PYMMO=1`. (`C/ModAuth.bas:1295`; `C/basCryptoSys.bas:84`; `C/Recursos.bas:2439`; `C/ModAuth.bas:878`)

**VERIFIED:** The `PYMMO=1` existing-character world login sends the encrypted token, character ID, and three version bytes. The server requires an 88-character token, decrypts it using its private key, checks the decrypted value against its token database, and checks that the encrypted token matches the database record. Failures disconnect. The version string is read and logged, but there is no version comparison in that handler. (`C/Protocol_Writes.bas:186`; `S/Protocol.bas:1494`; `S/Protocol.bas:1513`; `S/Protocol.bas:1528`; `S/Protocol.bas:1553`; `S/Protocol.bas:1577`; `S/Protocol.bas:1649`)

**ESTIMATED:** A modern implementation can reproduce the documented crypto operations without shipping `diCryptoSys.dll`, but compatibility with an external auth service requires an approved credential/token flow and key agreement. The supplied game-server handler does not establish what that external service will accept from a new executable. This is a conditional gate for `PYMMO=1`, not an EAC requirement. (`C/basCryptoSys.bas:176`; `C/AO20CryptoSysWrapper.bas:19`; `C/ModAuth.bas:878`; `S/Protocol.bas:1553`)

### Can it work without original anti-cheat/EAC?

**VERIFIED:** **Yes at the inspected VB6 enforcement layer.** The behavior is:

| Condition | Actual source behavior |
|---|---|
| Client anti-cheat disabled | **VERIFIED:** Initialization, message handling, updating, and session start become no-ops. The stored client build already selects this mode. (`C/AntiCheat.bas:33`; `C/AntiCheat.bas:68`; `argentum-online-client-classic/Argentum20.vbp:236`) |
| Server anti-cheat enabled | **VERIFIED:** Server registers a pending user and sends the anti-cheat start message. (`S/AntiCheat.bas:92`; `S/AntiCheat.bas:112`) |
| Client never registers | **VERIFIED:** The pending-registration query uses **30,000 ms**. For a returned non-admin user it writes a security log. Despite the function name `KickUnregisteredPlayers`, it does not kick. (`S/AntiCheat.bas:125`) |
| Anti-cheat requests removal | **VERIFIED:** `ClientActionRequired` also only logs the removal request. It does not call a close, kick, or ban function. (`S/AntiCheat.bas:206`) |
| Resource checksum | **VERIFIED:** `ValidateResources` returns `True` unconditionally. `GetCrc32` is declared by the client wrapper, but declaration alone does not establish an enforced server validation. (`C/ModValidateResources.bas:3`; `C/AntiCheat.bas:31`) |

**ESTIMATED:** The replacement can initially consume anti-cheat packets without implementing the original AOAC/EAC client. Before claiming live compatibility, run an ordinary non-admin account past the registration timeout using the exact server executable and DLLs. The opaque `AOACServer.dll` and deployed settings were not executed or behaviorally verified here. (`S/AntiCheat.bas:68`; `S/AntiCheat.bas:125`; `S/AntiCheat.bas:206`)

### Timing and authority

- **VERIFIED:** Action “timestamps” include monotonically increasing counters. Walk sends heading `Int8` plus counter `Int32`. Reusing or decreasing a checked counter closes the connection. The warning says “automatically banned,” but this function closes the socket without persisting a ban. (`C/Protocol_Writes.bas:397`; `S/Protocol.bas:2593`)
- **VERIFIED:** The server supplies **16 interval values**. Included configuration values are walk **210 ms**, attack **1,165 ms**, spell **1,230 ms**, item-click **276 ms**, item-key **380 ms**, and attack/spell transitions **800 ms**. The client adjusts walking for its speed multiplier. (`S/Protocol_Writes.bas:1512`; `argentum-online-server-classic/intervalos.ini:27`; `C/Protocol_Writes.bas:98`)
- **VERIFIED:** The generic rate checker measures server-side elapsed time and logs repeated violations. Its disconnect calls are commented out, and the function ultimately sets its result to `True`. This differs from the separate sequence check. (`S/Protocol.bas:2610`)
- **VERIFIED:** Movement has a separate accumulated speed check that can reject a step and send a position correction. However, the included policy sets walk and sailing thresholds to **zero**, so this configuration does not provide a positive minimum interval through that calculation. (`S/Protocol.bas:2093`; `argentum-online-server-classic/PacketRatePolicy.ini:23`)
- **VERIFIED:** Combat has independent server-enforced cooldowns and stamina checks. Client rate limiting is not the sole protection for attacks. (`S/modNuevoTimer.bas:76`; `S/SistemaCombate.bas:958`)
- **VERIFIED:** More than 100 packets in the five-second accounting window triggers overflow handling. Pre-login connections are kicked; logged-in users are kicked only when the relevant feature flag is enabled, but the overflowing packet is not processed. (`S/Protocol.bas:205`; `S/Protocol.bas:243`)
- **VERIFIED:** The client predicts movement immediately after sending it. The server checks movement legality and restrictions, owns the accepted position, and sends corrections. Therefore, movement prediction and reconciliation both matter. (`C/General.bas:557`; `C/General.bas:577`; `S/Modulo_UsUaRiOs.bas:1273`; `S/Modulo_UsUaRiOs.bas:2800`; `S/Protocol.bas:2136`)

## c) Resource formats and community parsers

| Resource | Current format and required coverage |
|---|---|
| Graphics index | **VERIFIED:** Startup currently calls the text **`LoadGrhIni`** path. A binary `graficos.ind` reader also exists: 32-bit version/count/index, 16-bit frame count, 32-bit frame references, 32-bit floating speed; static records contain file number and 16-bit rectangle fields. (`C/Recursos.bas:284`; `C/Recursos.bas:2027`; `C/Recursos.bas:1942`; `C/TileEngine.bas:93`) |
| Heads and helmets | **VERIFIED:** Binary `.ind` files use a header containing `String*255` and two `Long`s, then a 16-bit count. Current directional head references are **four 32-bit Longs**. (`C/GameIni.bas:20`; `C/Recursos.bas:1628`; `C/Declares.bas:1171`) |
| Bodies | **VERIFIED:** Current loading uses **`cuerpos.dat` INI data**, with offsets, idle bodies, and either explicit directional GRHs or `Std` templates from `moldes.ini`. Template loading generates additional GRHs and derives animation speed. (`C/Recursos.bas:1573`; `C/Recursos.bas:1728`; `C/Recursos.bas:1755`; `C/Recursos.bas:1766`) |
| Weapons and shields | **VERIFIED:** `armas.dat` and `escudos.dat` likewise support directional definitions and template-based animation construction. Supporting only the old four-direction entries is incomplete. (`C/Recursos.bas:2172`; `C/Recursos.bas:2340`) |
| Maps | **VERIFIED:** Current `.csm` loading recognizes signature `0x324C3557`, five layer counts, map size/metadata, and sparse records for blocks, graphics, triggers, lights, particles, and objects. Legacy four-layer CSM files insert an empty layer 3 and shift old layers 3/4 to 4/5. This is distinct from the older per-tile `.map` format. (`C/Recursos.bas:110`; `C/Recursos.bas:123`; `C/Recursos.bas:175`; `C/Recursos.bas:601`; `C/Recursos.bas:883`; `C/Recursos.bas:903`) |
| Archives | **VERIFIED:** The compressed resource path uses a custom directory/header format, password-based XOR, AES-128-CFB, then zlib decompression. It is not the ZIP-based `.ao` packaging used by LWJGL. The stored client profile instead selects loose resources. (`C/modCompression.bas:69`; `C/modCompression.bas:110`; `C/modCompression.bas:725`; `C/modCompression.bas:768`; `J/scripts/Compressor.java:159`; `argentum-online-client-classic/Argentum20.vbp:236`) |
| Effects and particles | **VERIFIED:** Coverage includes FX indices, offsets, PNG flags, composed effects, and binary particle definitions. (`C/Declares.bas:1181`; `C/Recursos.bas:1088`; `C/Recursos.bas:1840`; `C/Recursos.bas:1893`) |
| Fonts and interface | **VERIFIED:** There are GRH-based fonts, private TTF loading for Cardo/Alegreya Sans AO, and interface image loading. Replacing the game renderer alone does not replace these UI resources. (`C/Fonts.bas:20`; `C/Recursos.bas:2414`; `C/Recursos.bas:2466`; `C/General.bas:1260`) |
| Local gameplay metadata | **VERIFIED:** Localized `*_localindex.dat` is parsed as INI data and supplies object, NPC, spell, quest, message, graphic, and cooldown metadata. It is needed for a useful client even though the server retains gameplay authority. (`C/Recursos.bas:1239`; `C/Recursos.bas:1262`; `C/Recursos.bas:1281`; `C/Recursos.bas:1304`) |

**ESTIMATED:** Use the current VB6 loaders as the format specification, then validate against the exact release assets. VB6 binary `Get` structures, variable-length strings, array bounds, and file offsets need fixtures; a native-language struct memory dump is not a reliable substitute. (`C/Recursos.bas:182`; `C/Recursos.bas:885`; `C/modCompression.bas:784`)

| Reference project | What exists and how compatible it is |
|---|---|
| **ArgentumOnlineGodot, GDScript** | **VERIFIED:** Loaders cover GRHs, weapons, shields, bodies, heads, helmets, fonts, and old maps. GRH animation references are 32-bit, but heads/bodies use older 16-bit references, bodies come from `personajes.ind`, and maps use four-layer `.map`. Login sends a one-byte ID and version 0.13.0; walking has no current counter. **ESTIMATED:** Useful renderer/parser reference, substantial adaptation required. (`G/game_assets.gd:27`; `G/game_assets.gd:50`; `G/game_assets.gd:133`; `G/game_assets.gd:208`; `G/game_assets.gd:250`; `G/game_protocol.gd:25`; `G/game_protocol.gd:54`) |
| **argentum-online-lwjgl3, Java** | **VERIFIED:** Broad old-format loaders cover graphics, character parts, equipment, maps, and FX, packaged in ZIP `.ao` files. Map metadata remains explicitly unfinished; maps and character-part references use the older layouts. Login uses one-byte IDs, CP1252 strings, and version 0.13.0. **ESTIMATED:** Valuable implementation reference, not a current-server client. (`J/engine/utils/GameData.java:76`; `J/engine/utils/GameData.java:160`; `J/engine/utils/GameData.java:235`; `J/engine/utils/GameData.java:329`; `J/engine/utils/GameData.java:345`; `J/scripts/Compressor.java:159`; `J/network/protocol/Protocol.java:544`) |
| **ao-web-client, JavaScript and Python** | **VERIFIED:** Pixi runtime loads JSON indices, numbered PNGs, and JSON maps. Offline Python tools translate older indices/maps; the map converter uses 16-bit GRHs and discards triggers other than 1 and 4. Its protocol has one-byte IDs, including login 0 and walk 6. **ESTIMATED:** Good browser/UI reference, but both converters and networking need replacement or substantial revision. (`W/client/js/assets/assetmanager.js:1`; `W/client/js/assets/assetmanager.js:84`; `W/client/js/assets/assetmanager.js:125`; `W/tools/mapeo/scripts/conversor_mapas.py:34`; `W/tools/mapeo/scripts/conversor_mapas.py:65`; `W/client/js/network/protocol.js:4`; `W/client/js/network/protocol.js:138`) |
| **ArgentumOnline-Mobile, Java/libGDX** | **VERIFIED:** Has resource loaders, but animated GRH references are 16-bit and speed is divided by 45. Its map format begins with a name and different counts/coordinate widths. Login again sends one-byte IDs and version 0.13.0. **ESTIMATED:** Partial donor for mobile presentation, incompatible with current resources/protocol as written. (`M/containers/Grhs.java:31`; `M/containers/Grhs.java:70`; `M/objects/Map.java:54`; `M/connection/ClientPackages.java:308`) |
| **ao-unity, C#** | **VERIFIED:** The inspected game-specific `Player` is a small Mirror `NetworkBehaviour` with empty lifecycle methods and movement logging. It does not provide an AO resource or wire parser. **ESTIMATED:** Treat it as a starting scaffold, not a completed port. (`ao-unity/Assets/Scripts/Player.cs:7`) |
| **ao20-shared-types, TypeScript** | **VERIFIED:** Exports account, market, payment, house, and related API types. These exports are not the VB6 gameplay packet codec. (`ao20-shared-types/index.d.ts:1`) |
| **Aurora.Network, C++** | **VERIFIED:** Provides the most directly relevant transport, primitive serialization, and COM conversion implementation. It does not define the game’s resource formats or all AO packet layouts. (`N/Foundation/Private/Network/Detail/Channel.cpp:125`; `N/Foundation/Public/Network/Writer.hpp:109`; `S/PacketId.bas:20`) |
| **ao20-CryptoClient, VB6** | **VERIFIED:** Demonstrates the external auth session request and encrypted account login. It is an auth sample, not a modern gameplay/resource port. (`ao20-CryptoClient/README.md:1`; `ao20-CryptoClient/ModConnection.bas:15`; `ao20-CryptoClient/ModConnection.bas:49`) |

**ESTIMATED:** None of these inspected alternatives is a drop-in client for this baseline. Completeness percentages would be misleading without executing them and defining a feature checklist; the concrete incompatibilities above already rule out direct compatibility. (`G/game_protocol.gd:25`; `J/network/protocol/Protocol.java:544`; `W/client/js/network/protocol.js:138`; `M/connection/ClientPackages.java:308`)

## d) Candidate stacks and recommendation

| Stack | Assessment |
|---|---|
| **Web TypeScript, Pixi, browser UI** | **ESTIMATED:** Strongest choice if installation-free browser delivery is the main objective. The existing web project provides useful presentation patterns, but current protocol/resource support still needs new work. Requires a WebSocket-to-TCP bridge. (`W/client/js/assets/assetmanager.js:7`; `W/client/js/network/gameclient.js:27`; `S/Protocol.bas:198`) |
| **Godot 4, GDScript** | **ESTIMATED:** Best overall choice for a native replacement with a possible browser build later. Use a custom byte codec and explicit rendering passes, with the community port as a reference. Native TCP is available through `StreamPeerTCP`; browser export requires a WebSocket transport. (`G/game_assets.gd:133`; `C/TileEngine_RenderScreen.bas:46`; [Godot TCP documentation](https://docs.godotengine.org/en/stable/classes/class_streampeertcp.html); [Godot web limitations](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html#networking)) |
| **Unity, C#** | **ESTIMATED:** Technically suitable, especially for a team already using Unity. The supplied Unity project contributes little current AO compatibility, so adopting it would still mean implementing the codec, asset pipeline, rendering rules, and UI. (`ao-unity/Assets/Scripts/Player.cs:7`; `C/Recursos.bas:276`; `S/Protocol.bas:198`) |
| **C#/MonoGame** | **ESTIMATED:** Strong native alternative for explicit sprite batching and a reusable, testable C# protocol library. Expect more custom UI work. Its current documentation lists desktop/mobile support and web as forthcoming, so I would not select it for browser-first delivery. (`C/clsBatch.cls:1`; `C/ModGameplayUI.bas:1`; [MonoGame supported platforms](https://docs.monogame.net/articles/getting_started/)) |
| **Rust, for example macroquad** | **ESTIMATED:** Suitable for a compact native client and reusable codec, but adds integration work without an inspected AO Rust implementation to reuse. Macroquad documents 2D batching and desktop/HTML5 targets. Browser networking still needs the same bridge. (`N/Foundation/Public/Network/Writer.hpp:109`; `C/TileEngine_RenderScreen.bas:46`; [macroquad documentation](https://docs.rs/macroquad/latest/macroquad/)) |

**ESTIMATED:** Choose **Godot 4 with GDScript**, initially native. Keep the codec and world-state model independent of scene nodes; implement AO’s rendering order explicitly rather than relying entirely on automatic Y-sorting. If browser export matters, GDScript avoids the current Godot 4 C# web-export restriction. (`C/TileEngine_RenderScreen.bas:229`; `C/TileEngine_RenderScreen.bas:276`; `G/game_assets.gd:133`; [Godot web export documentation](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html))

**ESTIMATED, proposed browser topology:**

```text
Browser client
    ⇅ binary WSS carrying the Aurora byte stream
WebSocket/TCP bridge near the game server
    ⇅ one raw TCP connection per browser session
Unmodified VB6 server
```

**VERIFIED:** A bridge implementation is already included in the Mobile repository: it creates a TCP connection for each WebSocket client and forwards bytes in both directions. Current websockify documents the same basic role. (`ArgentumOnline-Mobile/util/websockify/node_modules/node-websockify/websockify.js:19`; `ArgentumOnline-Mobile/util/websockify/node_modules/node-websockify/websockify.js:28`; `ArgentumOnline-Mobile/util/websockify/node_modules/node-websockify/websockify.js:50`; [websockify](https://github.com/novnc/websockify))

**ESTIMATED:** Preserve Aurora’s length headers inside the WebSocket payload. Maintain a byte accumulator because WebSocket messages and TCP reads need not align with AO frames. Preserve ordering, bound queues, avoid batching interactive actions, and disable Nagle on the proxy’s TCP connection as Aurora does. The extra hop adds scheduling and network latency; packet loss still causes ordered-stream blocking. Measure it rather than assigning an unsupported fixed millisecond cost. (`N/Foundation/Private/Network/Detail/Channel.cpp:212`; `N/Foundation/Private/Network/Detail/Channel.cpp:218`; `ArgentumOnline-Mobile/util/websockify/node_modules/node-websockify/websockify.js:31`)

**VERIFIED:** A plain proxy changes the server-visible source IP. This matters because the server records the TCP peer address and has per-IP character-creation accounting with a limit of 15. **ESTIMATED:** Shared proxy-IP behavior is an operations gate for browser deployment. Adding a PROXY-protocol preamble would require server support and cannot simply be inserted into this unchanged byte stream. (`S/modNetwork.bas:179`; `S/clsAntiMassClon.cls:41`; `S/Protocol.bas:1864`; `N/Foundation/Private/Network/Detail/Channel.cpp:225`)

## e) Migration strategy and compatibility test plan

All steps below are **ESTIMATED proposals**, not tests performed during this assessment.

1. **Pin the compatibility target.** Obtain the exact server executable, Aurora/AOAC DLLs, compile flags, configuration, database fixture, and matching asset release. Record `PYMMO`, `DEBUGGING`, compression, and feature-toggle settings. The source version discrepancy and conditional `Connected` payload make this necessary. (`argentum-online-client-classic/README.md:5`; `argentum-online-server-classic/Server.VBP:210`; `S/Protocol_Writes.bas:77`)

2. **Build the protocol library and headless client first.** Implement framing, primitives, account login, character selection, initial world-state decoding, movement, chat, inventory, and attacks before graphics. Use a language-neutral packet schema where practical, with explicit conditional profiles. (`N/Foundation/Public/Network/Writer.hpp:109`; `S/Protocol.bas:1403`; `C/Protocol_Writes.bas:397`; `S/Protocol_Writes.bas:1512`)

3. **Create compatibility fixtures.** Capture approved test-session traffic from the original client and compare complete bytes. Include UTF-8 accents, empty/long strings, varint boundaries, signed values, SafeArray lower bounds, and debug/non-debug `Connected` packets. Test partial headers, fragmented bodies, and several frames in one read. (`N/Proxy/Public/Core/Proxy.hpp:81`; `N/Proxy/Public/Network/COM_Writer.cpp:232`; `S/Protocol_Writes.bas:80`; `N/Foundation/Private/Network/Detail/Channel.cpp:218`)

4. **Use an isolated real VB6 server.** Establish Windows as the reference environment with its documented COM/runtime dependencies and disposable database. Then test Wine separately if needed. Wine compatibility is an unresolved runtime question here, especially for COM and proprietary DLLs. (`argentum-online-server-classic/Server.VBP:2`; `argentum-online-server-classic/Server.VBP:5`; `argentum-online-server-classic/README.md:16`; `S/AntiCheat.bas:68`)

5. **Prove the important rejection and acceptance cases.** Test valid/invalid login, mismatched profile, trailing bytes, repeated action counters, overflow, cooldowns, blocked movement, reconnects, and the no-EAC client remaining connected beyond 30 seconds. Test negotiated features only after baseline behavior works. (`S/Protocol.bas:243`; `S/Protocol.bas:959`; `S/Protocol.bas:2593`; `S/Protocol.bas:2093`; `S/AntiCheat.bas:125`; `S/Protocol.bas:1251`)

6. **Add resources and rendering.** Validate asset parsing independently, render a static reference map, then add character composition, movement prediction/correction, lights, roofs, particles, sound, and weather. Preserve externally referenced IDs. (`C/Recursos.bas:276`; `C/Recursos.bas:601`; `C/engine.bas:1709`; `C/TileEngine_RenderScreen.bas:408`)

7. **Add UI and behavioral parity.** Implement inventory/equipment, spells/hotkeys, chat, trading/banking, crafting, groups/guilds, quests, and the selected late-game systems. Compare identical scenarios against the original client, including packet traces and server-side resulting state. (`C/frmMain.frm:2417`; `C/Protocol_Writes.bas:5726`; `C/Protocol_Writes.bas:5967`; `S/PacketId.bas:175`; `S/PacketId.bas:228`)

8. **Validate under adverse timing.** Exercise latency, jitter, pauses, packet coalescing, frame-rate changes, and browser backgrounding. Do not replay a backlog of stale input when execution resumes. (`S/Protocol.bas:239`; `C/Protocol_Writes.bas:89`; `C/engine.bas:1403`; [Godot background-processing limitations](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html#background-processing))

## f) Hard parts and risks

| Risk | Evidence and implication |
|---|---|
| Numeric and string encoding | **VERIFIED:** Fixed integers, varints, UTF-8 strings, SafeArrays, and VB6 file structures coexist. **ESTIMATED:** Confusing any two produces failures that can resemble authentication problems. Use byte fixtures, not same-implementation round trips alone. (`N/Foundation/Public/Network/Writer.hpp:109`; `N/Proxy/Public/Core/Proxy.hpp:81`; `N/Proxy/Public/Network/COM_Writer.cpp:232`; `C/Recursos.bas:182`) |
| Client-side rules the server expects | **VERIFIED:** The client applies randomized movement under `UserEstupido`; the server movement path accepts the supplied heading and checks movement restrictions/legality. The server’s generic rate enforcement is also weaker than its names suggest. **ESTIMATED:** A faithful replacement must preserve these client behaviors even where the server does not reproduce them. (`C/General.bas:546`; `C/General.bas:667`; `S/Protocol.bas:2065`; `S/Modulo_UsUaRiOs.bas:2800`; `S/Protocol.bas:2610`) |
| Client-reported macro detection | **VERIFIED:** Repeated identical mouse positions are detected locally and reported through a packet. **ESTIMATED:** Omitting such reporting changes monitoring behavior even when login remains compatible. (`C/ModTaehcitna.bas:25`; `C/ModTaehcitna.bas:40`) |
| Layer and attachment order | **VERIFIED:** Equipment drawing changes with heading, and world rendering uses separate whole-layer and per-row passes. **ESTIMATED:** A generic tilemap plus one character sprite will not reproduce occlusion correctly. (`C/engine.bas:1709`; `C/engine.bas:1721`; `C/TileEngine_RenderScreen.bas:46`; `C/TileEngine_RenderScreen.bas:276`) |
| Alpha, filtering, and lighting | **VERIFIED:** Rendering uses normal alpha and additive blending, per-corner light values, roof fading, and different texture-load filtering/color-key settings between compressed and loose paths. **ESTIMATED:** Golden screenshots should cover both asset modes and translucent effects. (`C/TileEngine.bas:1027`; `C/TileEngine_RenderScreen.bas:160`; `C/TileEngine_RenderScreen.bas:408`; `C/clsTexManager.cls:302`; `C/clsTexManager.cls:311`) |
| Exact movement feel | **VERIFIED:** Local movement starts before acknowledgement, scroll offsets interpolate over time, pressed-key ordering affects direction, and body/weapon/shield frame durations are speed-adjusted and clamped to 40–220 ms. **ESTIMATED:** Server-valid movement can still feel wrong without matching these details. (`C/General.bas:577`; `C/General.bas:662`; `C/engine.bas:1403`; `C/engine.bas:1428`; `C/TileEngine_Chars.bas:453`) |
| Asset/version drift | **VERIFIED:** Current five-layer CSM, 32-bit animation references, and template-generated bodies differ from the community formats. **ESTIMATED:** Pinning assets is as important as pinning packet definitions. (`C/Recursos.bas:601`; `C/Declares.bas:1171`; `C/Recursos.bas:1767`; `G/game_assets.gd:250`) |
| External-auth dependency | **VERIFIED:** `PYMMO=1` binds token processing to an executable-derived key and server token records. **ESTIMATED:** This can block deployment independently of rendering or EAC. (`C/ModAuth.bas:1297`; `C/ModAuth.bas:878`; `S/Protocol.bas:1577`) |

## g) Effort: Build versus Wait

**ESTIMATED:** The following uses your calibration of **10–25 minutes of agent wall-clock per small feature PR**, assuming one sequential coding agent, an available test harness, and bounded PRs. It is a planning model, not a measured forecast. The scope basis is roughly 102k referenced VB6 lines, hundreds of message definitions, multiple asset formats, and extensive form/UI behavior. (`argentum-online-client-classic/Argentum20.vbp:12`; `S/PacketId.bas:20`; `S/PacketId.bas:237`; `C/Recursos.bas:276`)

| Build: estimated agent wall-clock | Wait: named gate and holder |
|---|---|
| **ESTIMATED:** Protocol/schema/headless baseline: **20–35 PRs, 3.3–14.6 hours**. (`S/Protocol.bas:1403`; `N/Foundation/Public/Network/Writer.hpp:109`) | **ESTIMATED gate:** **Server maintainer** supplies the exact build, flags, DLLs, test accounts, and isolated server. (`argentum-online-server-classic/Server.VBP:217`; `argentum-online-server-classic/README.md:16`) |
| **ESTIMATED:** Current asset loaders/conversion/fixtures: **15–25 PRs, 2.5–10.4 hours**. (`C/Recursos.bas:276`; `C/modCompression.bas:69`) | **ESTIMATED gate:** **Asset maintainer** supplies the pinned resource release; **rights holder** confirms the intended redistribution. (`argentum-online-client-classic/README.md:19`; [Recursos/license.txt:3](https://github.com/ao-org/Recursos/blob/master/license.txt#L3)) |
| **ESTIMATED:** World renderer, character composition, prediction, audio: **25–45 PRs, 4.2–18.8 hours**. (`C/TileEngine_RenderScreen.bas:166`; `C/engine.bas:1709`; `C/clsAudioEngine.cls:200`) | **ESTIMATED gate:** **Veteran player/product owner** provides representative scenes and accepts movement/visual feel. (`C/TileEngine_Chars.bas:453`; `C/General.bas:577`) |
| **ESTIMATED:** Core playable UI and gameplay workflows: **35–60 PRs, 5.8–25 hours**. (`C/frmMain.frm:2417`; `C/Protocol_Writes.bas:5726`; `C/Protocol_Writes.bas:5967`) | **ESTIMATED gate:** **Product owner/server operator** chooses beta scope and provides fixtures for trading, crafting, guilds, and quests. (`S/PacketId.bas:175`; `S/PacketId.bas:191`; `S/PacketId.bas:226`) |
| **ESTIMATED:** Compatibility fixes, reconnects, packaging, acceptance: **20–35 PRs, 3.3–14.6 hours**. (`S/Protocol.bas:959`; `S/Protocol.bas:2593`; `C/clsTexManager.cls:293`) | **ESTIMATED gate:** **QA/server operator** accepts real-server results; **auth owner**, if `PYMMO=1`, resolves token/key compatibility. (`S/AntiCheat.bas:125`; `S/Protocol.bas:1577`) |
| **ESTIMATED:** **Playable beta total: 115–200 PRs, approximately 19–83 agent hours.** This includes the five rows above, not full feature parity. (`C/Recursos.bas:276`; `C/Protocol_Writes.bas:174`; `C/frmMain.frm:2417`) | **ESTIMATED:** Calendar completion depends on the gates above. No source evidence supports assigning their holders a reliable turnaround time. (`argentum-online-server-classic/README.md:16`; `C/ModAuth.bas:878`) |
| **ESTIMATED:** Full parity adds **120–240 PRs, 20–100 hours** for remaining systems, visual edge cases, accessibility/platform work, and repeated acceptance fixes. **Total: approximately 39–183 agent hours.** (`S/PacketId.bas:191`; `S/PacketId.bas:228`; `C/TileEngine_RenderScreen.bas:408`; `C/engine.bas:1562`) | **ESTIMATED gate:** **Gameplay owner and experienced testers** accept the complete feature matrix; **release owner/rights holders** accept distribution. (`argentum-online-client-classic/Argentum20.vbp:147`; `argentum-online-client-classic/licence.txt:233`; [Recursos/license.txt:3](https://github.com/ao-org/Recursos/blob/master/license.txt#L3)) |
| **ESTIMATED, optional:** Browser bridge and browser-specific acceptance add **10–20 PRs, 1.7–8.3 hours**, excluding external-auth redesign. (`ArgentumOnline-Mobile/util/websockify/node_modules/node-websockify/websockify.js:19`; `W/client/js/network/gameclient.js:27`) | **ESTIMATED gate:** **Infrastructure/server operator** supplies WSS hosting and resolves shared-IP behavior; **browser QA** validates pause/resume and audio. (`S/clsAntiMassClon.cls:41`; [Godot web limitations](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html#limitations)) |

**ESTIMATED:** Overall, a login-and-walk prototype is moderately difficult; a faithful production replacement is hard. The protocol is inspectable, existing graphics can be reused subject to licensing, and the visible EAC integration does not impose a hard rejection. Most effort lies in the many presentation and interaction details. (`S/Protocol.bas:1403`; `C/Recursos.bas:276`; `S/AntiCheat.bas:125`; `C/TileEngine_RenderScreen.bas:229`)

**ESTIMATED:** **Replacing the client is the easier direction for a production-compatible migration.** Replacing the server while retaining the old client preserves rendering and input feel, but requires reproducing movement legality, combat timing, persistent state, database behavior, and the outward packet stream. A small new-server prototype may be quicker because it needs no graphics; complete behavioral parity carries greater gameplay and data risk. (`S/Modulo_UsUaRiOs.bas:1273`; `S/SistemaCombate.bas:958`; `S/Protocol_Writes.bas:1512`; `argentum-online-server-classic/README.md:45`)

## h) Licence implications

**VERIFIED:** Both classic repositories contain the actual licence heading:

> “GNU AFFERO GENERAL PUBLIC LICENSE”  
> “Version 3, 19 November 2007”

Source headers additionally specify “either version 3 … or … any later version,” so those files express **AGPL-3.0-or-later**, not merely AGPL-3.0-only. (`argentum-online-client-classic/licence.txt:1`; `argentum-online-server-classic/licence.txt:1`; `C/Protocol_Writes.bas:6`; `S/AntiCheat.bas:6`)

**VERIFIED:** The asset repository is linked separately from the client. Its currently published `license.txt` says:

> “Argentum Online Assets © by Noland Studios is licensed under CC BY-NC-ND 4.0”

It also directs commercial projects to obtain a commercial licence and identifies third-party resources requiring their own valid licences. This is the published resource licence, not proof that every asset in a particular historical release has identical provenance. (`argentum-online-client-classic/README.md:19`; [Recursos/license.txt:1](https://github.com/ao-org/Recursos/blob/master/license.txt#L1); [Recursos/license.txt:3](https://github.com/ao-org/Recursos/blob/master/license.txt#L3); [Recursos/license.txt:4](https://github.com/ao-org/Recursos/blob/master/license.txt#L4); [Recursos/license.txt:6](https://github.com/ao-org/Recursos/blob/master/license.txt#L6))

| Use | Implication |
|---|---|
| Translate or adapt the VB6 code | **ESTIMATED legal application:** Treat the resulting derivative client as AGPL-covered: retain notices, identify modifications, and distribute the required Corresponding Source with an appropriate source-access mechanism. Changing implementation language does not itself remove those obligations. (`argentum-online-client-classic/licence.txt:196`; `argentum-online-client-classic/licence.txt:210`; `argentum-online-client-classic/licence.txt:233`) |
| Independently implement the protocol | **ESTIMATED legal application:** Merely communicating with the AGPL server does not by itself establish that the new client is a derivative. The implementation’s actual copying and derivation matter; public repository access is not a blanket permission to relicense copied code. (`argentum-online-client-classic/licence.txt:223`; `S/PacketId.bas:20`) |
| Ship original graphics | **ESTIMATED legal application:** Unmodified, noncommercial redistribution can fit CC BY-NC-ND with attribution and notices. Publicly sharing creative adaptations requires additional permission. Necessary technical format conversions are expressly distinguished from adaptations. (`C/clsTexManager.cls:306`; [Recursos/license.txt:4](https://github.com/ao-org/Recursos/blob/master/license.txt#L4); [CC legal code, §§2–3](https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.en#s2)) |
| Operate a hosted web client | **ESTIMATED legal application:** Downloading JS/WASM and assets into browsers is distribution of those files. Provide source for an AGPL-derived client under the applicable conveyance terms; hosting does not remove the assets’ noncommercial/no-derivatives conditions. Section 13 additionally governs qualifying remote interaction with modified AGPL software. (`argentum-online-client-classic/licence.txt:263`; `argentum-online-client-classic/licence.txt:540`; [Recursos/license.txt:4](https://github.com/ao-org/Recursos/blob/master/license.txt#L4)) |
| Commercial operation or changed artwork/music | **ESTIMATED legal application:** Obtain permission covering the intended commercial use and adaptations. A free download alone does not establish noncommercial use; music synchronization also has specific adaptation treatment. (`C/clsAudioEngine.cls:200`; [Recursos/license.txt:3](https://github.com/ao-org/Recursos/blob/master/license.txt#L3); [CC definitions, §1](https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.en#s1)) |

**VERIFIED:** Reference-project licences are mixed. Godot and the web client carry MIT licences; Aurora.Network carries Apache-2.0. Conversely, `ao20-shared-types` explicitly calls itself proprietary, permits use solely for consuming/integrating the AO20 API, and restricts modification, redistribution, and derivative products. Its types should not be treated as freely reusable port code. (`ArgentumOnlineGodot/LICENSE:1`; `ao-web-client/LICENSE:1`; `Aurora.Network/LICENSE:1`; `ao20-shared-types/LICENSE:3`; `ao20-shared-types/LICENSE:6`; `ao20-shared-types/LICENSE:12`)

**ESTIMATED:** The practical release gate is therefore two separate approvals of compliance: the new code’s source/licence obligations, and an asset manifest with permissions covering the intended distribution and business model. AGPL permission for code does not override the graphics licence. (`argentum-online-client-classic/licence.txt:223`; [Recursos/license.txt:1](https://github.com/ao-org/Recursos/blob/master/license.txt#L1))
