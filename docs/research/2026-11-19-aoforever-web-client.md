# How AOForever built a web client for Argentum Online (2026-11-19)

**Answer in 2 lines.** AOForever's web client is a from-scratch TypeScript + PixiJS v8 client (Vite bundle, obfuscated, no wasm) that speaks the server's own binary packet protocol over binary WebSocket frames through a custom gateway (`wss://gw.aoforever.cc/ws`, behind Cloudflare), so the VB6-lineage server stays authoritative. Assets are converted once to static PNG/JSON, maps are the original `.map` files parsed in the browser, and the same bundle is wrapped as the Android/iOS/Mac apps: this is the working precedent for "new client, old server".

Coverage: strong on technology (read the live bundle, deobfuscated it, observed the live WebSocket handshake and asset fetches, diffed packet IDs against public source). Medium on people (site, changelog, GitHub; no Discord, no YouTube devlog, no gs-zone read). I did not log in, create an account or play. Wall-clock ~6 min of tool time for the research pass.

Labels: **VERIFIED** = observed directly (source named). **INFERRED** = my reasoning.

---

## 1. What the web client technically is

- **VERIFIED** URL `https://aoforever.cc/jugar/`. HTML is a ~8 KB Vite shell (`<div id="app">`, one module script `assets/main-Dk2ijPhU-2611181712.js`, 3.8 MB, no sourcemap). The page CSS comment says the game frame is **800x600** letterboxed on black; JS has mobile/iOS/apk branches (`M.apk`, `M.iosApp`).
- **VERIFIED** The bundle is TypeScript compiled by Vite and then run through javascript-obfuscator (string-array `A1P(0x...)` calls). I deobfuscated the string table to read it. Strings include `main.ts` references in comments and class names in Spanish (`conectarWs`, `armarDom`, `reevaluarPausa`).
- **VERIFIED** Engine: **PixiJS v8** (`pixi.js/math` ObservablePoint/Matrix, spritesheet loader, BSD-3 licence banner, v8.x strings). Renderer preference strings `"webgl"` and `"webgpu"` present. No WebAssembly, no Emscripten, no Phaser/Godot/Unity, no Capacitor/Cordova string in the bundle. Not a VB6 transpile or emulation: it is a rewrite.
- **VERIFIED** UI is DOM plus PNG art (`recursos/ui/*.png`, windows absolutely positioned at 800x600 coordinates with the original AO window art), game world is on a Pixi canvas. Bitmap font `recursos/fuentes/font1.fnt/.png`. Web Audio for `.wav` sounds (35 wav refs), OffscreenCanvas used.
- **VERIFIED** Extras the team built on top: proximity voice chat (second WebSocket, JSON control + binary audio, only on map 197 per `/estado`), F11 video recorder on PC, ES/EN/PT UI, configurable keys including mouse wheel, mobile HUD, packet-sniffer debug panel (`ao-export-json`, "N paquetes").

### Assets (they converted the originals, they did not ship the VB6 formats)
- **VERIFIED** Graphics: one PNG per Grh file number, `GET /jugar/recursos/graficos/<n>.png` (e.g. `1.png`, `20015.png`, `28010.png`). Battle-arena set under `recursos/graficos_battle`. Loaded lazily with an LRU texture budget (mobile 192 MB / PC 512 MB constants).
- **VERIFIED** Indexes converted to JSON: `recursos/init/grh.json` (`{"1":{"file":1,"sx":64,"sy":0,"w":32,"h":32}, ...}`, i.e. the `.ind` Grh table with source rects), plus `bodies.json, heads.json, helmets.json, weapons.json, shields.json, fxs.json, cinetics.json, skins.json, charinfo.json, bm.json`. Versioned with `?v=<hash>`; whole thing ~3,500 to 6,400 files per the iOS CI check.
- **VERIFIED** Maps: the **original binary `.map` files**, served as `recursos/mapas/MapaN.map` (`application/octet-stream`, Mapa1.map = 32,387 bytes) and parsed in the browser with a DataView: 0x111-byte header, then per tile a flag byte (blocked bit, layers 2/3/4 present bits, trigger bit) + uint16 layer-1 graphic, little-endian. This is the classic AO `.map` layout. Prefetch cache of up to 12 maps (6 on iOS) and an optional "precache all maps" tool.
- **INFERRED** Sound is converted to `.wav` the same way; I did not fetch audio.

## 2. Network transport and protocol

- **VERIFIED** (live) On load the page opens `wss://gw.aoforever.cc/ws?server=argentina&v=2&canal=jugar` and sends the 6 raw bytes `AOFCR?`. The gateway replies with a 24-byte binary frame, then a text-ish binary frame `CR=1\nSEG=9735\nTXTHEX=<hex>\nFIN=1\n` (decodes to "Tanda de skins cambia en:" with a countdown in seconds), then closes. So the first thing is a pre-login status probe over the same socket. Also `GET https://gw.aoforever.cc/estado?canal=jugar` returns JSON: `{"version":2,"versionCredencial":63,"permiteTrabajo":true,...,"permiteVoz":true,"vozMapas":[197],"androidSoloApp":true,"iosSoloApp":true,"servidores":{"battle":true,"oficial":true}}`. `server=` selects the world (argentina/oficial/battle); `canal=` is web vs app.
- **VERIFIED** (bundle) Game traffic is **binary WebSocket frames** (`binaryType = 'arraybuffer'`) carrying the **AO packet protocol**: a `ServerPacketID` enum (`Logged ... Pong ... ShowMOTDEditionForm ... MiniMapa ... PedirInspeccion`, ~0x97 entries) and a `ClientPacketID` enum, each packet a TS class with `read/write` using little-endian DataView (`getUint16(...,true)`, 4/8-byte writes), `Reader`/`Writer` buffers.
- **VERIFIED** The packet IDs are **the same numbering as AOForever's own 2024 VB6 source**: from `Comunidad-Winter/AOForever.cc` `Protocol.bas` I counted `UpdateHungerAndThirst=66 (0x42), Fame=67, MiniStats=68 (0x44), CharacterInfo=83 (0x53), Pong=94 (0x5e), ShowMOTDEditionForm=98 (0x62)`; the web bundle has exactly 0x42, 0x43, 0x44, 0x53, 0x5e, 0x62. It does NOT match ao-org's Argentum20 `PacketId.bas` numbering (`eMinPacket, eConnected, elogged...`).
- **VERIFIED** On top of the packet payload sits a **session framing + encryption layer** the web client implements itself in JS: each outgoing message is `[credentialByte][len lo][len hi][seal counter 0..255]` followed by `IV(16 random bytes) + AES-128-CFB(payload)` with a key embedded in the bundle (hand-written AES, no WebCrypto). `versionCredencial` (63) from `/estado` rides in the credential byte. Inbound is IV + CFB ciphertext. The web client re-implements this exactly because the real server expects it.
- **INFERRED (confidence high)** The gateway is a WebSocket-to-TCP bridge (websockify-style but custom: it also answers `AOFCR?`, `/estado`, a voice relay, rate/health, multi-server routing) running on a server behind a **Cloudflare Tunnel** (the client has an error string about "Under Attack challenge ... or tunnel caído" and tells the admin to exempt `gw.aoforever.cc` in Cloudflare). The iOS build bakes the gateway URL (`GATEWAY_URL=wss://gw.aoforever.cc/ws` in `variables.txt`).
- **INFERRED (confidence high, ~85%)** The game server behind it is the **original VB6 AOForever server (Winsock/ByteQueue lineage, AO 0.13-style)**, unchanged for web: the web client is a second client of the same server as the Windows client, with the same worlds, same accounts, same packets ("el mismo mundo y los mismos servidores en todas las plataformas", site JSON-LD). Evidence: packet IDs equal the 2024 VB6 source; changelog says new commands were added to "el cliente multiplataforma web/app" in step with the Windows client; no sign of a second server codebase. What I could not verify: whether AES framing is terminated in the VB6 server itself or in the gateway (the 2024 public source has only a trivial `mod_Crypt`, so framing was added later in closed code).

## 3. Who makes it and what they say

- **VERIFIED** AOForever (Argentum Online Forever), running since 2022, community portal Nosetu (`nosetu.com`, Discord `discord.nosetu.com`, Nosetu Launcher). Staff named "Sun" (admin, posts every changelog; GitHub commit author "Sun" on the 2024 source) and others. Premium/cheque marketplace, character market (MAO), real-money prizes, Steam app "Argentum Forever" (store id 3007860), Android (Google Play), iOS/iPad/Mac (App Store id 6799763888), Windows client.
- **VERIFIED** Timeline from their own news: 22 Jul 2026 "Se viene el nuevo cliente multiplataforma" (staff already working on it; Windows stays the main client; testers sought for Linux and macOS via Discord tickets). 1 Sep 2026 changelog: "Nuevo cliente WEB para jugar desde el navegador (version primaria muy limitada)" at `/jugar/`. By 15 Nov 2026: web/app have ES/EN, drag items, bank/trade commands, F11 recorder, voice, HUD config, mac app parity. So **v1 in about 6 weeks, and a rich multi-platform client in about 16 weeks**. Later they restricted work/skilling in the browser ("ya no se puede trabajar desde el navegador, solo app/cliente descargado"; `/estado` flags `androidSoloApp`, `iosSoloApp`), an anti-bot/abuse measure.
- **VERIFIED** The iOS build is public as CI scaffolding in `darhj/aof-ios-paquete` (Xcode 26, `App/www` = the web build, ~3,500 files, split zip parts, GitHub Actions to App Store Connect, Fastlane). The `App/www` layout means the apps are the **web bundle in a native WebView shell**, same code as `/jugar/`. No game source in that repo ("sin codigo del server").
- **NOT FOUND** A public repo of the web client source, a devlog, or a stated tech stack. The bundle is obfuscated, which suggests they do not intend it to be read or reused.
- **Base codebase: VERIFIED** AOForever's public 2024 repo (`Comunidad-Winter/AOForever.cc`, "Versión 1.0 estable", Jul 2024, licence file GPL-2.0, `AOForever_Cliente` and `AOForever_Servidor` as VB6 `.VBP` projects) is an AO 0.13-lineage Winsock client and server with `Protocol.bas` by Maraxus carrying an Affero GPL v1 header. It is **not** ao-org's Argentum20 base (different packet IDs, `mswinsck` rather than Aurora.Network, `clsByteQueue`). So AOForever is a classic-AO derivative, closer to the Dakara/0.13.x family than to AO20.

## 4. Other web AO clients, for comparison

| Project | Approach | Server it talks to | Licence | State |
|---|---|---|---|---|
| **horacioMartinez/dakara-client** (2016, JS, 23 stars) | Written from scratch in JS/HTML5 (later PixiJS). Speaks the plain 0.13.x binary protocol; **websockify** converts WebSocket to TCP. `config.json` sets version/ip/port. | Dakara C++ server (`DakaraOnline/dakara-server`, AGPL, C++/libevent, machine-translated from VB6) or a normal VB6 0.13.x server | MIT (client) | Old (last push 2017), but the direct template for "new client, old server" |
| **ominousg/ao-web-client** + `ao-web-server` (2022) | Fork of dakara-client, PixiJS (WebGL/canvas), JSON assets, same websockify route; README says it works with dakara-server and the conventional **VB6 0.13.3 server** | Dakara C++ or VB6 0.13.3 | MIT client, AGPL server | Small hobby project |
| **dcatanzaro/aoweb** (2016, JS, 51 stars) | Separate **JS/Node authoritative server + PixiJS client**, new protocol, not VB6-compatible | Its own Node server (`argentumonlineweb-servidor`) | GPL-3.0 server, client no licence | Independent game; MobAO (2026) forks it |
| **fergarcia1/aoweb** (2026 prototype) | TypeScript, tile maps, own authoritative WebSocket server, assets exported from AO with an `ao-export` tool | Own Node server | none stated | Prototype |
| **rtroncoso/bao** (2019 to 2026) | Full-stack TypeScript monorepo (client, Colyseus rooms, API, MySQL), Vercel demo | Own TS servers | MIT | Active, a rewrite, not compatible |
| **Ginijhnc/ao-web-suite** (Oct 2026) | Texture-atlas and data editor for the JSON asset format used by dakara-client forks | n/a | MIT | New, tooling only |
| **ao-org** (Argentum 20 official) | No web client found in the org (repos: classic client and server, Aurora.Network, compressor, ao-unity (2021 stub), `ao20-shared-types` "for web, api, gameapi" = account/market site types, not the game client). Aurora.Network is their C++ TCP lib and is marked "NO LONGER MAINTAINED, use Aurora.Engine". | n/a | AGPL-3.0 code | no browser client |

Two architectures exist: **(A) new client against the old authoritative server through a bridge** (dakara-client family and AOForever) and **(B) new client plus new server** (aoweb, bao, fergarcia). Only (A) matches Ariel's option.

## 5. Synthesis

**Likely architecture (confidence ~85%):**
```
Browser: TS + PixiJS v8 canvas + DOM windows
  fetch  -> static PNG-per-Grh, JSON indexes (grh/bodies/heads/...), raw .map files (CDN via Cloudflare)
  wss    -> gw.aoforever.cc/ws?server=<world>&canal=<web|app>   (binary frames)
            frame = [cred][len16][seal] + IV + AES-128-CFB(AO packet: id byte + LE fields)
Gateway (custom WS<->TCP bridge, status probe AOFCR?, /estado JSON, voice relay), behind cloudflared tunnel
Original VB6 AOForever server (same worlds and accounts as the Windows client)
Native apps = the same bundle in a WebView shell (Android APK, iOS/Mac Xcode project)
```

**What it implies for Ariel (new client, VB6-compatible server):**
1. **It is proven in the wild and it was fast.** A small team shipped a limited web client in ~6 weeks and parity-ish plus mobile apps in ~16, against an unchanged server. The client is the thin part; the server never needed to change.
2. **The reusable pieces are all on the client/edge side:**
   - Protocol: re-implement `ServerPacketID`/`ClientPacketID` (read straight from the server's `Protocol.bas`/`PacketId.bas`), little-endian fields, length-prefixed strings. With ao-org this is the "classic" server (`argentum-online-server-classic`, AGPL, "capped at v5.6.76") whose PacketId list is public; AOForever's numbering is different, so a client is bound to one server's enum.
   - Bridge: websockify (as dakara-client did) is enough for a plain-TCP protocol; AOForever wrote a custom gateway to add status, multi-world routing, voice, rate limiting and tunnel hosting. Start with websockify, grow into a gateway.
   - Assets: one-off conversion script to PNG-per-Grh + JSON indexes + served raw `.map`. `ao-web-suite` and dakara-client already define a JSON format; AO20 assets can be decompressed with `ao-org/argentum20-compressor`.
   - Renderer: PixiJS (all web AO clients converged on it), with an LRU texture budget and map prefetch.
3. **Risks they had to solve (and so will Ariel):** (a) browser cannot do raw TCP, so a gateway is mandatory and is a new attack surface; (b) bots and macro abuse from a browser (they now block skilling and force the app for mobile); (c) Cloudflare WAF/UAM challenges break WebSockets, so exempt the gateway host; (d) texture memory on mobile; (e) keeping client packet classes in lockstep with every server patch (they track a `versionCredencial` and `/estado` version to force reload); (f) packet encryption and anti-replay (`seal`) if the server demands it; (g) store policy: iOS/Android apps need a native shell and, per the CI file, an Apple Developer team and Xcode 26.
4. **Cheapest falsification test (do this first):** stand up `ao-org/argentum-online-server-classic` (or any VB6 0.13 server) locally, put websockify in front, fork `ominousg/ao-web-client` (MIT) and see whether login plus a map render works. If the packet enum of the chosen server differs, that is the main port cost, not rendering.

**Licence angle:**
- AOForever's server and Windows client derive from AO 0.13-lineage code whose `Protocol.bas` carries the **Affero GPL v1+** header (Maraxus), and AOForever itself published its 2024 client and server under **GPL-2.0** (`LICENSE` file, GitHub metadata). Their public repo is **VERIFIED** to be a stale snapshot (Jul 2024, "Versión 1.0 estable"), while the server is running 2026 closed changes (premium, MAO market, retos, Aurora-style framing). **INFERRED:** AOForever is likely not meeting AGPL/GPL source-offer obligations for current code. I did not see a "source" link on the site.
- The **web client** is new TypeScript written by them, so it is theirs; no ao-org code is in it (the numbering and architecture do not match ao-org AO20). The PNGs, maps and sounds are original AO assets re-exported, so asset licence (original AO assets, and ao-org's `Recursos` repo is marked NOASSERTION) is the exposure for anyone copying their asset pipeline, not the code.
- For Ariel specifically: **ao-org code is AGPL-3.0**, so a public server built from it must offer its source to users, and a new **client that is a separate program talking to an AGPL server over the network** is a separate work (the client is not derived from server code), but only if Ariel's client contains no copied ao-org client code (client-classic is also AGPL-3.0). Assets are CC BY-NC-ND per the brief (I did not re-verify), which forbids commercial use and modified redistribution: converting BMP to PNG atlases and serving them publicly is an adaptation, which is the one real legal risk for a commercial web client. Worth a lawyer line before launch; not needed for the first prototype.

## Sources
- Site and changelog: https://aoforever.cc, https://aoforever.cc/jugar/, https://aoforever.cc/changelog.php (entry 1 Sep 2026), https://aoforever.cc/noticias.php?n=539 (22 Jul 2026), `https://gw.aoforever.cc/estado?canal=jugar`
- Bundle: https://aoforever.cc/jugar/assets/main-Dk2ijPhU-2611181712.js (deobfuscated locally; also live CDP capture of the WebSocket and fetches)
- AOForever repos: https://github.com/Comunidad-Winter/AOForever.cc (2024 VB6 snapshot), https://github.com/darhj/aof-ios-paquete (iOS CI shell)
- ao-org: https://github.com/ao-org (argentum-online-client-classic, argentum-online-server-classic, Aurora.Network, ao20-shared-types)
- Others: https://github.com/horacioMartinez/dakara-client, https://github.com/DakaraOnline/dakara-server, https://github.com/ominousg/ao-web-client, https://github.com/ominousg/ao-web-server, https://github.com/dcatanzaro/argentumonlineweb-cliente, https://github.com/fergarcia1/aoweb, https://github.com/rtroncoso/bao

## Not done / open
- No Discord, YouTube or gs-zone reading, so no statement by the team about their stack. I did not log in or inspect post-login frames (consent rule), so the exact login handshake after `AOFCR?` is not decoded.
- Quick next step if wanted: ask on their Discord (Ariel's call, not mine) or decode the post-login frames with a throwaway account Ariel approves.
- Undo: nothing was changed. Temp files in `/private/tmp/aof-*` and the scratchpad can be deleted; Chrome tabs closed with `skills/cdp-close-tabs.sh`.
