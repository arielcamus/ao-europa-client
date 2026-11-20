# Build log

## 2026-11-20 setup and server finding
- Reference clones copied to ~/Projects/ao-reference (server-classic @ caac313, client-classic, Recursos, Aurora.Network).
- Scope (Ariel 07:33): WEB FIRST. No Capacitor, no Tauri. Desktop + mobile browsers (touch, small screens), report bundle size.
  Keep code free of choices that block a native wrapper later.
- **Server blocker (VERIFIED):** ao-org/argentum-online-server-classic ships SOURCE ONLY. Releases v5.6.77-79 have zero assets,
  repo has no Server.exe, CI workflows are only ai-fix. Building needs `vb6.exe /make Server.VBP` (Agents.md) = a licensed VB6 IDE.
  So "Wine / Windows ARM VM" can only run it once someone compiles it. No VB6 on this Mac; Rosetta not installed; no wine.
- Routes to a compiled server: (a) a licensed VB6 copy (Ariel supplies media) installed in Wine or a Win11-ARM UTM VM;
  (b) twinBASIC (free) importing Server.VBP: experimental headless build (`--buildAndExit32`), unknown with OCX/DX8VB, not tried yet;
  (c) skip VB6 and run a stand-in server for client dev (see below), clearly labelled as NOT the real server.

## 2026-11-20 M1 protocol foundation

- Branch confirmed `m1-protocol`; initial commit `5e32a59`; working tree initially clean.
- Read only the server/client/Aurora references. Exact revisions and paired procedure
  locations are in `docs/PROTOCOL.md`. No assets copied or committed.
- Checked `node --version` → `v24.15.0`, `pnpm --version` → `12.21.0`.
- Counted both PacketId.bas enums with the `PYMMO=0` entries included; subset agrees.
  Classic LoginExistingChar is `Int32 id + String8 name`, without PYMMO token/version.
- Confirmed COM signed WriteInt's lossy negative behavior, unsigned VB Int8, UTF-8
  byte lengths, SAFEARRAY dimensions/bounds, and the one-message uint16LE envelope.
- Implemented browser-compatible protocol primitives without runtime dependencies,
  all requested layouts, full CharacterCreate for real initial placement, the three
  position variants, and RequestPositionUpdate/ErrorMsg/Disconnect for diagnostics.
- Added strict malformed-input failure and bounded partial-frame accumulation. Unknown
  complete frames are safely sized by their envelope and skipped; no guessed parsing.
- Preserved upstream AGPL/Apache headers, added NOTICE and the Aurora Apache license.
- Commands run from `~/Projects/ao-client`:

```sh
pnpm install
c++ -std=c++20 -Wall -Wextra -Werror tools/protocol-oracle.cpp -o /private/tmp/ao-protocol-oracle
/private/tmp/ao-protocol-oracle > packages/protocol/test/goldens.json
pnpm typecheck
pnpm test
```

- First install hit sandbox DNS failure (`registry.npmjs.org`); the same `pnpm install`
  succeeded with network escalation. pnpm 12 ignored `.npmrc` settings: removed that
  file and put repo-local `storeDir` in workspace YAML for subsequent installs.
  `managePackageManagerVersions` is also no longer accepted by pnpm 12 and was
  removed after its configuration error. The first install used pnpm's default cache.
- Initial verification: **45 tests passed, 1 test file; typecheck passed**. Goldens
  were emitted by C++, independently of TypeScript, and frozen for Vitest.
- Local commit: `0ecdddc feat(protocol): implement classic framing and verified packet subset`.

## 2026-11-20 M1 TCP proof, stand-in and WebSocket bridge

- Added `apps/bot` with raw TCP, Nagle disabled, redacted credential logging,
  Connected → LoginAccount → first character → LoginExistingChar → Logged flow.
  Placement uses CharacterCreate plus UserCharIndexInServer, independently of
  account-list coordinates, and waits for Intervals before walking.
- The five walks use counters 1..5 and respect walk interval / speeding plus a
  margin. Packet 79 probes resulting positions through packet 31. The bot tracks
  confirmed, corrected and inferred walks separately. A late correction revokes
  prior inference; malformed/partial frames, disconnects and failed login stop.
- CLI success requires a continuous connection for at least 30 seconds and at
  least one accepted walk. It actually observes 30 seconds after Logged. Short
  durations exist only in the library test harness, never as CLI/env overrides.
- Added labelled `tools/standin-server`: source packet layouts and login order,
  one fixed test account/character, a 100×100 coordinate box, server intervals,
  counter checks and correction paths. Accepted walks send no self acknowledgement,
  as in VB6 `MoveUserChar`. It is **NOT a game server** and uses no assets.
- `tools/run-standin.mjs` uses an ephemeral loopback port, starts the bot only after
  listen succeeds, propagates failure status and closes all fixture sockets/server.
- Added `packages/bridge`, whose only external runtime dependency is `ws` (lockfile:
  8.23.0). Binary bytes pass unchanged, with no parsing or extra length prefix.
  TCP/WebSocket backpressure, upstream connection failure, closure, text rejection,
  Nagle off on both TCP legs, and a 1 MiB WebSocket message cap are explicit.
- Raised the TypeScript target to ES2024 for Node 24's Promise.withResolvers;
  changed cached character updates to immutable replacements after typecheck
  caught writes to inferred readonly fields. Build/typecheck subsequently passed.
- Commands run (from repo root; no push or PR):

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm bot:standin
pnpm typecheck
pnpm list --recursive --depth 0
git diff --check
AO_STANDIN_DEBUG=0 AO_STANDIN_REJECT_WALKS=1 pnpm bot:standin
```

- Loopback bind is blocked by the execution sandbox (`listen EPERM 127.0.0.1`).
  The socket tests and CLI were rerun with execution escalation, not skipped or
  mocked. Improved a test fixture's listen-error handler exposed by this run.
  Also resumed paused WebSockets before closing after upstream failure, allowing
  the WebSocket close handshake to complete.
- Verification: **63 tests passed, 3 test files**, duration 5.64s; typecheck and
  all four workspace builds passed. Tests cover normal/debug login, five accepted
  walks, all corrections, auth failure, absent Logged/placement, empty accounts,
  early EOF, malformed/unsized packets, unknown-frame skipping, inference/late
  correction, 2 MiB byte-for-byte bridge transfer with backpressure, failed TCP
  connects, text rejection, TCP EOF and a full WebSocket→TCP→stand-in login/walk.
- Full CLI success (DEBUGGING=1): exit **0**, `connectedMs=30006.92225`,
  `observedMs=30003.130208`, `walksSent=5`, `confirmedWalks=5`, `inferredWalks=0`,
  `correctedWalks=0`, map 1, final position (51,50). Stand-in closed afterward.
- Full negative CLI run (DEBUGGING=0, `AO_STANDIN_REJECT_WALKS=1`): all five
  walks corrected to (50,50), stayed connected for the observation period,
  then **exit 1** with `No walk accepted`. Stand-in closed afterward.
- Final review found TextDecoder's default BOM stripping would alter a leading
  U+FEFF in a String8. Added `ignoreBOM: true` and an independent C++ golden
  (`04efbbbf41`) for that case. Recompiled the oracle and regenerated fixtures;
  inspected the diff: the only fixture change was the new BOM entry. Reran
  `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` afterward.
- Final verification: **64 tests passed, 3 test files (5.19s)**; typecheck, all four
  workspace builds, and whitespace checks passed. Runtime dependencies: none for
  protocol/bot/stand-in beyond workspace code; `ws` only for the bridge.
- No implemented layout remains unverified against the paired VB6 source procedures.
  **Unverified limitation:** no real compiled VB6 server exists here; the stand-in
  proves the source-derived subset and transport behavior, not a live game login.

## 2026-11-20 real-server attempt on this Mac (A: blocked)

Session began **07:09:47 UTC**. Read this log, PROTOCOL, draft PR #1, and all three
port assessments. References already survive outside `/private/tmp` in
`~/Projects/ao-reference/{argentum-online-server-classic,argentum-online-client-classic,Recursos,Aurora.Network}`.
The shortened checkout names in earlier notes are aliases, not actual directories.

Host: Apple M1, arm64, 16 GB, macOS 26.6.2 (25G83), Homebrew 7.0.11.
Rosetta was absent (`arch -x86_64 /usr/bin/uname -m` failed). Installed it with
`softwareupdate --install-rosetta --agree-to-license`; completed successfully.
`brew install --cask wine-stable` failed: Homebrew disabled the cask on 2026-09-01
because it does not pass Gatekeeper. `wine@devel` is also disabled. Used the
upstream WineHQ macOS package referenced by the cask, without changing Gatekeeper
or globally installing Wine. Its SHA-256 matched Homebrew's published value.

Exact successful runtime preparation (paths are local, no binaries committed):

```sh
softwareupdate --install-rosetta --agree-to-license
brew install --cask wine-stable # fails: disabled cask, see above
mkdir -p "$HOME/Projects/ao-reference/runtime/downloads"
cd "$HOME/Projects/ao-reference/runtime"
curl -fL -o downloads/wine-stable-11.0_1-osx64.tar.xz \
  https://github.com/Gcenx/macOS_Wine_builds/releases/download/11.0_1/wine-stable-11.0_1-osx64.tar.xz
shasum -a 256 downloads/wine-stable-11.0_1-osx64.tar.xz
# b50dc50ec7f41d58b115a6b685d4d1315ba3c797bd3aa0f49213f2703cb82388
tar -xf downloads/wine-stable-11.0_1-osx64.tar.xz
export WINEPREFIX="$HOME/Projects/ao-reference/runtime/prefix"
export WINEDEBUG=-all MVK_CONFIG_LOG_LEVEL=0
ao_wine='./Wine Stable.app/Contents/Resources/wine/bin/wine'
"$ao_wine" --version # wine-11.0
"$ao_wine" wineboot --init
"$ao_wine" 'C:\windows\syswow64\cmd.exe' /c ver
# Microsoft Windows 10.0.19045 (32-bit executable through WoW64/Rosetta)
"$ao_wine" 'C:\windows\syswow64\regsvr32.exe' /s \
  'Z:\Users\arielcamus\Projects\ao-reference\argentum-online-server-classic\Aurora.Network.dll'
"$ao_wine" 'C:\windows\syswow64\regsvr32.exe' /s \
  'Z:\Users\arielcamus\Projects\ao-reference\argentum-online-server-classic\DX8VB.DLL'
brew install cabextract # 1.12
curl -fL -o downloads/WindowsXP-KB936929-SP3-x86-ENU.exe \
  http://www.download.windowsupdate.com/msdownload/update/software/dflt/2008/04/windowsxp-kb936929-sp3-x86-enu_c81472f7eeea2eca421e116cd4c03e2300ebfde4.exe
shasum -a 256 downloads/WindowsXP-KB936929-SP3-x86-ENU.exe
# 62e524a552db9f6fd22d469010ea4d7e28ee06fa615a1c34362129f808916654
cabextract -q -d downloads/vb6 -L -F i386/msvbvm60.dl_ \
  downloads/WindowsXP-KB936929-SP3-x86-ENU.exe
cabextract -q -d prefix/drive_c/windows/syswow64 downloads/vb6/i386/msvbvm60.dl_
"$ao_wine" 'C:\windows\syswow64\regsvr32.exe' /s msvbvm60.dll
curl -fL -o downloads/sqliteodbc.exe http://www.ch-werner.de/sqliteodbc/sqliteodbc.exe
shasum -a 256 downloads/sqliteodbc.exe
# 3bce566ecc2545a49c0cad1d0c4c62ddafd529b77bdc147c1dcee8eace8acc70
"$ao_wine" downloads/sqliteodbc.exe /S
"$ao_wine" 'C:\windows\syswow64\reg.exe' query 'HKLM\Software\ODBC\ODBCINST.INI' /s
```

All three `regsvr32` calls reported success. Aurora's 1.5 type library and x86
CLSID entries are in the prefix registry. The x86 ODBC registry reports
`SQLite3 ODBC Driver = Installed`, driver/setup `sqlite3odbc.dll`. `file` confirms
the extracted `msvbvm60.dll` is PE32/i386. HTTPS variants of the two old download
hosts failed certificate hostname checks; used their documented HTTP URLs. The
Microsoft package was verified against the hash in upstream Winetricks `vb6run`.
The SQLite hash above records the downloaded installer; it is not a signed
upstream checksum. A supplemental cscript COM/ADO smoke attempt produced no
output, so **COM activation/ADO queries and application startup are not proven**.

The actual compile attempt:

```sh
"$ao_wine" 'C:\Program Files (x86)\Microsoft Visual Studio\VB98\vb6.exe' \
  /make 'Z:\Users\arielcamus\Projects\ao-reference\argentum-online-server-classic\Server.VBP' \
  /d PYMMO=0:DIRECT_PLAY=0:DEBUGGING=0
# exit 53: wine: failed to open ...\VB98\vb6.exe
```

**Exact blocker:** no compiled classic `Server.exe`, and no licensed VB6 compiler
or installation media in the supplied references/Downloads. Rechecked upstream
release API: v5.6.77, v5.6.78 and v5.6.79 all have `assets: []`. The upstream
README requires opening Server.VBP in VB6; Agents.md names that same compiler.
Wine can execute x86 programs here; the missing compiler is not a Wine execution
failure. UTM/Windows ARM was therefore **not installed or claimed tested**: changing
OS does not supply this prerequisite. No cloud resources used.

To unblock A, supply a trusted compiled server for the pinned revision with
`PYMMO=0,DIRECT_PLAY=0`, or licensed VB6 installation media. Then complete OCX/ADO
startup validation, copy example INIs/Empty_db.db into an isolated server working
copy, configure a local test account, and run `pnpm bot` for the required 30 seconds.
No real-server login, connected-duration or walk claim is made. **PR #1 stays draft.**
M2 uses the explicitly labelled stand-in, as allowed by the task.

Sources: [Homebrew cask](https://formulae.brew.sh/cask/wine-stable),
[WineHQ macOS package maintainer](https://github.com/Gcenx/macOS_Wine_builds),
[Winetricks runtime extraction](https://github.com/Winetricks/winetricks/blob/master/src/winetricks),
and the pinned server README/Agents.md.

## 2026-11-20 M2 browser map and movement (stand-in)

Branch `m2-browser` is based on the updated `m1-protocol` branch. A separate
pre-existing `~/Projects/ao-client-m2` worktree uses port 5173; it was left untouched.
This session's preview uses **http://127.0.0.1:5187/** and browser tests use 5188.

- Added a plain TypeScript/PixiJS browser app, without a UI framework or native
  wrapper. Keyboard arrows/WASD and touch buttons support taps and held movement;
  input resets on release, cancellation, focus loss and hidden tabs.
- Reused the binary protocol and bridge. The browser performs account/first-character
  login, waits for authoritative placement, uses resourceMap for asset selection,
  paces walks from server interval/speed and maintains increasing counters. One
  outstanding walk/position probe prevents ambiguous confirmations. Rejections snap
  to server coordinates, no reply times out, and silence never counts as acceptance.
- Added packed four/five-layer CSM render-prefix readers, current `graficos.ini`,
  body templates/direct references, head indexes, and original PNG loading. Source
  provenance and intentionally unimplemented features are in docs/ASSETS.md.
- Renderer reuses sprites, loads nearby sheets on demand, discards stale map loads,
  releases textures on map changes, and caps resolution at 2 and rendering at 60 fps.
  Body/head rendering, walking animation and camera interpolation are implemented.
- Local launcher mounts only allowed assets through `AO_ASSETS`, runs the bridge
  on an ephemeral loopback port, proxies same-origin WebSockets and cleans up on
  failure/signals. `--standin` is explicit. Normal `pnpm dev` targets an existing
  TCP server; there is no silent fallback to the stand-in.
- The UI visibly labels **TEST STAND-IN** and its absence of collision/gameplay
  rules. No real-server interoperability is claimed. No assets, screenshots,
  binaries, generated art, credentials or local environment files were staged.

Observed and fixed during actual browser/resource checks:

- The supplied graficos.ini has one unused static record with surplus fields;
  follow the VB6 reader's first-six-fields behavior instead of guessing animation.
- Some 5068.png rectangles exceed the actual 512px image height. Preserve their
  indexed footprint, clip absent pixels to transparent and show a visible count.
  This is a documented preview fallback; native sampler parity remains unverified.
- Rendering work could consume a short press before the next animation frame.
  Key/pointer down now starts a step immediately; held input continues on the ticker.
- Playwright WebKit's mouse click on a scrolled mobile viewport could hit HTML.
  Mobile browser cases use actual touch taps after scrolling the target into view.
- Retain self character index across map changes, clear stale placement, and start
  a fresh placement deadline at each warp. Ignore old-session asynchronous load
  failures after reconnect. Keep Pixi's shared EMPTY texture alive during cleanup.

Local resource scan: 842 CSM render prefixes parse; `mapa844.csm` is empty (0 bytes)
and is rejected. 77,746 graphic records, 757 heads, all 921 mapa1 graphic references
resolve. Tests embed original synthetic data only. One exploratory Node strip-only
command failed on TS parameter properties; the scan succeeded with Node's
`--experimental-transform-types`. This flag is not needed by normal app commands.

Validation commands:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm exec playwright install webkit
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" pnpm test:browser
git diff --check
```

Unit/transport verification: **77 tests pass in 5 files**; includes the real
WebSocket→TCP bridge in browser-session tests for accepted and rejected walks,
placement ordering, paced headings, counters, correction, silence/timeouts,
malformed/partial data, map changes and synthetic resource formats. Typecheck and
all five workspace builds pass. Frozen lockfile installation succeeds.

Browser validation uses the production Vite bundle, installed Chrome 157 and
Playwright WebKit 27.2. Desktop Chrome and 390×844 touch Chrome/WebKit each check
login, 30 seconds after Logged, four accepted directions, no corrections, bad
credentials, leave/reconnect, and local-file allowlist rejection. Mobile tests also
resize to 844×390 and walk; desktop checks held keys stop on blur. These are browser
emulations on this Mac, not tests on physical phones.
Final result: **6 browser tests passed in 1.7 minutes**, with no page errors or
failed asset requests in the four-direction/30-second checks.

Bundle measurement (sum of all emitted JS chunks, including lazy chunks):
**557,566 bytes raw / 163,522 bytes gzip**. CSS: 6.58 kB / 2.22 kB gzip.
This excludes artwork and local resource files. One desktop inspection loaded 23
resource requests including indexes/map and used about 53 MB of JS heap; that is
not a measurement of total GPU/process memory. The only new browser runtime
dependency is `pixi.js@8.23.0`; Vite and Playwright are development dependencies.

Screenshots (local, ignored; manually inspected desktop and mobile renders):

- `artifacts/screenshots/m2-desktop-chrome.png`
- `artifacts/screenshots/m2-mobile-chrome.png`
- `artifacts/screenshots/m2-mobile-webkit.png`

The preview server is left running on loopback port 5187 for inspection. Its
launch command was `AO_ASSETS="$HOME/Projects/ao-reference/Recursos" AO_WEB_PORT=5187
node tools/dev-web.mjs --standin --preview`. No server deployment or PR merge.

## 2026-11-20 real-server continuation

Session start: **07:37:23 UTC** (Europe/Madrid 08:37:23). Existing Wine/Rosetta
prefix reused; no cloud resources, paid licences or unofficial VB6 compiler.
Existing draft PRs: #1 `m1-protocol` → `main`; #2 `m2-browser` → `m1-protocol`.

### Route 1 — official ready-built server: unavailable

- GitHub API rechecked all classic releases: v5.6.77–79 have zero assets.
  Repository-wide Actions artifacts and workflow runs both report zero.
- Enumerated **517 tags**, fetched the complete official history (7,342 commits),
  and searched every reachable object for executable/archive names. Only old
  third-party account/statistics utilities and AdminLibSetup.exe occur; there is
  no Server.exe or server archive. No such utility was executed.
- The old `ao-org/argentum-online-server` URL returns 404 with the connected account.
  Enumerated the public ao-org repositories. `forever-client` is a Unity client;
  `argentum20-instalador` contains runtime installers, not a game server. Neither
  has releases. `Recursos` has no release or executable/archive in its checkout.
- Cloned only the requested official
  [Comunidad-Winter/AOForever.cc](https://github.com/Comunidad-Winter/AOForever.cc)
  at `d9661b93e44c6bc64072cd3c3bf6cb3bb7efb913`. Both commits were inspected:
  no server executable, releases, tags or Actions artifacts. Its only executable
  is `AOForever_Cliente/CODIGO/Launcher.exe`; it was not run. Server source is
  `AOForever_Servidor/AOFServer.VBP` (GPL-2.0).
- AOForever's `Codigo/Protocol.bas` uses byte packet IDs and a streaming
  clsByteQueue, not Aurora's uint16 envelope/int16 IDs. LoginExistingChar=22,
  Walk=28, RequestPositionUpdate=29, Logged=6, ChangeMap=27, PosUpdate=28.
  Login takes character name, password and three version bytes; no account-list
  handshake. Consequently a numeric table remap alone would be incorrect.
- Local API evidence: `artifacts/server-attempts/` in `ao-client` (ignored).
  Commands: `gh api .../{releases,tags,actions/artifacts}?per_page=100 --paginate`,
  `git fetch --unshallow --tags origin`, `git rev-list --objects --all`.
  The connector rejects the tags/artifacts endpoints, so those read-only checks
  used GitHub CLI. No downloaded server binary was available to verify or run.

### Route 2 — twinBASIC community compiler: import/build UI blocked

- Downloaded official `twinbasic/twinbasic` release `beta-x-1044` (41,210,379 bytes).
  SHA-256 matched the release asset's published digest exactly:
  `d9e525fd7743f6161653025c130aec141fbcfa79dca7255b1eff067b519a0554`.
  Extracted to `ao-reference/runtime/twinbasic-1044`; PE32/i386 IDE and compiler.
- Started `wine twinBASIC.exe ...\\Server.VBP` in the existing prefix. The process
  starts, but no imported project or Server.exe has been produced. Created a
  detached source worktree at `runtime/classic-twinbasic` for any build-only fixes.
- `wine ...\\bin\\twinBASIC_win32.exe help` runs and identifies v0.15.1044.
  Its supported console commands are twinproj import/export, not VB6 compilation.
  Trying `export ...\\Server.VBP ...\\classic-twinbasic-export --overwrite`
  explicitly fails: `input twinproj file does not exist` (it appends `.twinproj`).
  Log: `artifacts/server-attempts/twinbasic-export.log`.
- The official IDE requires WebView2 and only supports Windows, so there is no
  native macOS compiler to run. Downloaded Microsoft's x86 Evergreen installer
  from `https://go.microsoft.com/fwlink/?linkid=2099617`; recorded SHA-256
  `316965c12d39ebac80976c460c3573a8eea734b3d91fed861b69991a5c15c9e7`.
  Ran `/silent /install`; Microsoft's Edge updater reports exit `0x00000000`
  at **07:45:18 UTC**, installing WebView2 **158.0.4370.33**. Restarted the IDE
  with that runtime; Wine spawned its WebView2 children but produced no project
  or executable. Logs: `webview2-install.log`, `edge-update.log`,
  `twinbasic-with-webview.log` under `artifacts/server-attempts/`.
- Computer Use returned **“Computer Use was not approved to use Wine Stable”**.
  Requested that app access asynchronously; no alternate UI-control mechanism
  was used to bypass the restriction. Consequently the VBP import/build has not
  been reached and no source/compiler incompatibility is claimed proven.
- [Current licensing](https://twinbasic.com/licensing) excludes automated/CI
  builds from Community; the IDE build remains the free route. No licence was
  bought, no compiler was patched, and no licence gate was bypassed.

### Route 3 — real community port with classic adapter: works

- Compared `gorlok/aoj-server` (0.12.3), `francollamas/argentum-server-net`
  (0.13), Dakara's Java migration and `cavazquez/pyao`. Selected the fuller
  [lambdaclass/argentum](https://github.com/lambdaclass/argentum) Elixir/Rust port,
  official source revision **1699a662e6352bfcc9ea5905c6d6f2c0157cb1e7**,
  Apache-2.0. No third-party server binary downloaded or executed.
- Native Homebrew tools: Elixir **1.20.5**, Erlang/OTP **29**, Rust **1.100.0**,
  PostgreSQL **16**. `mix local.hex --force`, `mix local.rebar --force`,
  `mix deps.get`, `mix compile` succeeded, including the Rust tile-grid NIF.
  The pinned dependency lockfile was not changed. Upstream compiler warnings
  remain; no game-logic build fixes were required.
- The port is **not wire-compatible untouched**. It has unframed int16 IDs,
  int16 string lengths and token-based login. Added the explicit
  `AO_PROTOCOL_PROFILE=classic` server transport/auth adapter rather than
  claiming that matching packet IDs imply compatibility. M1's protocol and
  WebSocket bridge are unchanged. Only its four incoming commands are accepted.
  Full mapping, limits, source pin and reproduction commands are in
  [tools/real-server/README.md](../tools/real-server/README.md).
- The small patch touches only the TCP gateway and loopback listener bindings.
  Actual Bcrypt authentication, account ownership, token/session validation,
  packet anti-replay, flood guard, map entry, NPC simulation, authoritative
  collision, walk timing and logout persistence execute upstream code. No
  coordinates or movement responses are synthesized by the adapter.
- Database: a dedicated cluster in `ao-reference/runtime/ao-postgres`,
  `127.0.0.1:55432`, database `ao_client_real`. The launcher creates a normal
  account and warrior `Macwalker` through upstream creation/persistence APIs.
  Credentials are private in gitignored `artifacts/server-attempts/real-server.env`
  (0600). Server source/build is `ao-reference/argentum-elixir`.
- Server listens at **127.0.0.1:17666**, with Phoenix HTTP disabled and lazy map
  boot. Startup loads 4,275 items, 146 spells, 821 NPC definitions and 258 quests.
  Map 1 loads **Ciudad de Ullathorpe, 5,228 blocked tiles, 27 NPCs, 131 objects,
  324 exits**. The bundled `mapa1.csm` equals the client's original Recursos file:
  SHA-256 `96a5cdc680009da916ccf2996da65b7c446c094eb01cbb7b1fc958dd30ef9644`.
- First start revealed the upstream umbrella starts the world before its DB
  application (GuildServer logged DB unavailable). The launcher now explicitly
  starts `game_backend` before `app.start`. A full process restart verified
  `GuildServer loaded 0 guild(s) from DB` and preserved character position.
  Server logs: `real-server.log`, `real-server-restarted.log`.

#### M1 proof and regression checks

At **07:54:53 UTC**, the unmodified 30-second bot exited **0**:

```json
{"connectedMs":30617.209790999997,"observedMs":30003.053375,"walksSent":5,"confirmedWalks":5,"inferredWalks":0,"correctedWalks":0,"map":1,"position":{"x":58,"y":44}}
```

Log: `artifacts/server-attempts/m1-real-bot.log`. A direct PostgreSQL query
after logout found `(58,44)`, not the original spawn `(57,44)`;
`persistence-after-bot.txt` records that query. Browser login then independently
started at `(58,44)`.

After a full server process restart the bot exited **0** again at **08:00:44 UTC**:
30,416 ms connected, five walks sent, **four accepted, one corrected**, zero
inferred, final `(60,43)`. Log: `m1-real-bot-after-restart.log`. The correction
is expected against real terrain, unlike the collision-free stand-in.

`node tools/real-server/probe.mjs` additionally passed real TCP checks for login
before authentication, wrong password, an unowned character, and duplicate walk
counter rejection/disconnection. First run encountered the actual NPC spawn at
`(59,32)` after eleven accepted north steps. After restart it accepted `(60,42)`,
rejected movement into **solid tile `(60,41)`**, and walked back to `(60,43)`.
The upstream CSM parser confirms that tile's value is `1` (solid); the earlier
NPC tile is `0` (walkable ground occupied by NPC 602). Logs:
`real-server-probe.log`, `real-server-probe-after-restart.log`, `collision-grid.log`.

- Adapter: **6 ExUnit tests passed**, comparing independent C++ oracle bytes
  for login, movement, framing, strings, complete CharacterCreate and intervals;
  tests include truncation/coalescing, malformed input and profile-off behavior.
  Log: `classic-profile-tests.log`.
- M1: build, typecheck, and **64 tests passed**. The existing 2 MiB bridge test
  initially exceeded its 10-second deadline twice while doing generic deep
  object comparison of Buffers. Replaced those two assertions with exact
  `Buffer.equals` checks (same bytes and length, no relaxed limit). The entire
  suite then passed in **1.64 seconds**, including the unchanged backpressure test.
- `bash tools/real-server/prepare.sh ...` also passed when repeated against the
  already patched pinned checkout. No source or lockfile drift beyond the
  documented gateway patch and new adapter.

#### M2 proof

The production browser client connects through the byte-transparent bridge to
TCP 17666; no `--standin` option. Its explicit `elixir-classic` display profile
labels **AO COMMUNITY SERVER**, keeping the original VB6 target unverified.

First real browser test passed: four keyboard directions plus the on-screen
east button, **five confirmed moves / zero corrections**, **30 seconds**,
then logout/login preserving `(59,44)`. Desktop and mobile layouts were captured
and visually inspected; no page errors or failed asset requests. The mobile
screenshot is a resized desktop Chrome viewport, not a physical-device test.
The separate existing browser suite covers touch-emulated Chrome/WebKit.

Local evidence (ignored, not uploaded with licensed artwork):

- `artifacts/screenshots/m2-real-community-desktop.png`
- `artifacts/screenshots/m2-real-community-mobile.png`
- `artifacts/screenshots/m2-real-community-proof.json`
- `artifacts/server-attempts/m2-real-browser.log`

After the full server restart the browser test passed again in **34.2 seconds**:
four accepted steps, one collision correction, 30 seconds connected, reconnect
preserving `(60,43)`. The final screenshots/proof JSON above reflect this second
run at **08:02:11 UTC**; log `m2-real-browser-after-restart.log`. The live test
now accepts actual blocked terrain while checking that a rejected step restores
the authoritative position; it does not assume a collision-free square.

Stopped investigating additional server routes after this success. Terminated
the task's twinBASIC IDE after the denied app access; no VBP compilation claimed.
Original VB6 and full gameplay wire compatibility remain outside this result.
The community server and real browser preview are left running locally.

M2 final regression validation after integrating M1: frozen lockfile install,
typecheck, all workspace builds, **77 unit/transport tests (1.50 s)** and
**6 browser tests (1.7 min)** passed. The browser suite exercised the production
bundle in desktop Chrome, touch-emulated Chrome and touch-emulated WebKit.
The opt-in real-server browser test passed separately in **34.2 s**, with traces
disabled to avoid saving credentials. Logs: `m2-typecheck.log`, `m2-build.log`,
`m2-frozen-install.log`, `m2-regression.log`, `m2-real-browser-after-restart.log`.
The final real-server screenshots were visually inspected. No artwork,
credential, database or binary is staged; both PRs remain draft.

## 2026-11-20 Windows VM request — stopped at compiler licensing preflight

Session began **08:42:30 UTC** (09:42:30 Europe/Madrid), following Ariel's
09:41 VM approval. Read the complete build log, including the Wine/twinBASIC
attempt and the lambdaclass adapter. Started from the clean `m2-browser` branch
and created `vm-server`; PR #2 remains the base of this follow-up.

Constraints: original `ao-org/argentum-online-server-classic`, `Server.VBP`,
`PYMMO=0`; at most 4 GB VM RAM and a 40 GB thin virtual disk; at least 25 GB host
free space; official software sources; no purchases or account use. Ariel
explicitly instructed: **if a paid licence or Ariel's account is needed, STOP
and report exactly what**.

### Verified stop condition

Rechecked the publisher's current [twinBASIC licensing table](https://twinbasic.com/licensing)
on 20 November. Its `Automated builds / CI` row says **No** for Community and
Personal, **Yes** for Professional and higher. Professional explicitly includes
`Automated and unattended build support`. Thus the requested command-line build
over SSH and one-command unattended rebuild require a **twinBASIC Professional
or higher licence**; the free Community IDE does not authorize that workflow.
No suitable licence has been supplied for this task. The earlier claim that
twinBASIC is free must be qualified by this automation restriction.

Stopped VM installation and server work at this point, per Ariel's instruction.
No purchase, activation, login, licence bypass, UTM install, Windows download,
VM creation, dependency installation, or compiler invocation was performed in
this session. No source compatibility or Windows ARM execution failure is
claimed: this is a verified licensing prerequisite, before an execution test.
Even a suitable licence would not by itself prove that VBP import or this
server's dependencies build successfully; those checks remain outstanding.

The existing `beta-x-1044` download is present, but the previous Wine result
remains the only compiler evidence. A licensed VB6 compiler remains another
possible route, also unavailable as documented above. Resuming either route
requires Ariel to supply an existing suitable licence and authorize its use,
or to change the command-line build requirement to a permitted manual workflow.
No working `vm-up.sh`, `vm-build-server.sh`, or `vm-down.sh` is claimed or added;
there is no verified one-command rebuild yet.

### Actual result and resource use

- VM RAM allocated/used: **0 GB**; virtual disk created/used: **0 GB**.
- `df -k .` initially reported **54,369,808 KiB available** (51.85 GiB,
  55.67 decimal GB), below the prompt's approximate 70 GB but above its floor.
  At **08:43:25 UTC**, `statvfs` reported **55,674,802,176 bytes available**.
- No original-VB6 M1 run, bot log, M2 browser run, or new screenshot exists.
  The earlier `m1-real-bot*.log` and `m2-real-community-*.png` evidence applies
  exclusively to the lambdaclass adapter and is not evidence for this VM goal.
- This branch records the blocker only. VM provisioning, SSH/port forwarding,
  `PYMMO=0` compilation, original-server launch and live client validation remain
  unperformed. Repository checks and closeout timing are recorded below.

Documentation closeout: `pnpm test` passed **77 tests in 5 files (1.50 s)**;
`git diff --check` passed. No implementation changed, so no browser or VM test
was represented as a regression check for this update. At **08:43:56 UTC**,
`df -k .` reported **54,333,612 KiB free** (51.82 GiB / 55.64 GB), still above
the 25 GB floor. Preflight, documentation and tests took **1 minute 26 seconds**
from session start; final commit/PR closeout follows this measurement.
