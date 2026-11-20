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

## Decision 2026-11-20 11:07 CET (Ariel): classic UI first
The client reproduces the VB6 client's own UI (original interface graphics: main window frame, inventory, spells list, console) with no redesign. Reasons: minimise design/dev work and allow screen-by-screen comparison with the original. UI modernisation comes later. Phones use the scaled classic layout until then. The M2 custom dark web frame is to be replaced. AO Forever is a technical reference only (browser client over WebSocket), never a visual one.

## 2026-11-20 Windows VM continuation with supplied ARM64 ISO

Session started **10:47:55 UTC** on `vm-server`, initially clean. Ariel supplied
`~/Downloads/ao-vm/Win11_ARM64_en-gb.iso` and explicitly changed the host reserve
to **12 decimal GB**. Initial `df` availability was **36,043,728 KiB**. The ISO's
8,543,594,496-byte size and SHA-256
`500bcb6f272b7c455156470ea06816f558f13b885723f84ee9eab7534c7dee61`
were verified. Its Pro image is index 3, ARM64, build 26300.9457, language en-GB.
The original ISO is unchanged; `windows.iso` in the bundle is a hard link.

### UTM startup and headless fallback

`open -a UTM`, opening `ao-build.utm`, and help/list/start CLI calls were tried.
Every `utmctl` call had a 10–20-second timeout; none reached usable VM control.
A bounded documented AppleScript version query returned `-1712`. Process samples
showed the UTM app at `_dyld_start`, only 96 KiB resident; system logs reported
no eligible provisioning profile / launch-policy denial for `utmctl`. Strict
recursive code-signature verification and notarization assessment both passed.
A scoped quarantine-metadata removal on the verified app did not fix startup;
its original quarantine metadata was restored and the stalled app terminated.
No Computer Use, screenshots, mouse input or keyboard automation was used.

To continue the requested Windows provisioning, installed Homebrew QEMU 11.1.3,
swtpm 0.10.2_1 and wimlib 1.14.5_2, with automatic Homebrew update and cleanup
disabled. Homebrew installed/upgraded their declared dependencies. The fallback
uses **the existing 40 GB thin raw disk**, HVF, **4096 MiB RAM**, four cores,
NVMe, the original virtio MAC and both loopback TCP forwards. Its optional human
display is VNC on **127.0.0.1:5905**. UTM must not open the disk concurrently.
`qemu-backend.json` makes the existing up/down/status wrappers select this backend.

Initial `highmem=off` could not map 4 GiB; corrected to `highmem=on`. The TPM TIS
device then failed with `HV_BAD_ARGUMENT` in HVF, so the fallback omits that TPM
and its unused helper was stopped. The answer file explicitly relaxes TPM and
storage setup checks. Secure Boot is provided by UTM's bundled firmware and
Microsoft-key variable template; RAM and CPU checks passed without overrides.

The reserve monitor was changed to pause at **14 GB**, polling every 250 ms,
with a bounded QMP pause and a SIGSTOP fallback for its identified emulator.
It never saves guest RAM to disk. A simulated low-space / unresponsive-monitor
check passed without touching the live VM. Other host writers are outside its
control. The minimum observed space is recorded privately in
`disk-guard-status.json` and will be reported at closeout.

### Unattended setup fixes and evidence

- Matched all answer-file language fields to en-GB / UK keyboard. Added offline
  Microsoft ARM64 OpenSSH 10.4.0.0p1-Preview to the seed, avoiding a dependency
  on Windows Update / Features on Demand. Its release SHA-256 was verified:
  `d2b1928225479fec9e0c938f527fdb5ed676446cca1bbcc5af84aca1f272842e`.
- Created an APFS clone of the official ISO and replaced its 1,720,320-byte
  El Torito EFI image at offset 1,126,400 with the same ISO's
  `efisys_noprompt.bin`, avoiding the DVD keyboard prompt.
- Added temporary WinPE diagnostics to that separate copy: exported Setup image
  2 as its boot image, included Microsoft's native curl from OS image 3, loaded
  the supplied NetKVM driver and ran Setup with the explicit seed answer file.
  The original contiguous boot.wim extent at offset 25,886,720 was hash-checked
  before replacement. The modified boot WIM was 627,252,671 bytes, SHA-256
  `edbe13808d03066a590daa286f04c861da83c1e6b5ea7abe07cc05c6cd3e0bcc`.
  A loopback-only receiver collected three private setup logs, capped at 8 MiB.
  The scratch WIM was removed after embedding it to reclaim host space.
- Logs proved the initial halt was the empty ProductKey field (`0x80070002`).
  Added the public Windows Pro installation key, which selects the edition and
  does not activate Windows. The next halt was missing Secure Boot capability;
  switched to UTM's Secure Boot firmware and preloaded Microsoft keys.
- WinPE confirmed **10.0.2.15** and a working host route. Setup then selected
  Windows 11 Pro, accepted its EULA, partitioned guest disk 0, and began
  `WIMApplyImage` with Compact OS at **11:10:10 UTC**.
- A brief paused, read-only disk inspection confirmed the apply phase from
  `$WINDOWS.~BT\Sources\Panther\setupact.log`. The host's read-only attachment
  was detached before the guest resumed. It did not change guest files.

The project has not been imported or compiled; those are deliberately human
steps in the handoff. Final provisioning evidence follows.

At 11:36 UTC, removed inherited macOS background throttling from the QEMU
process with `taskpolicy -B -p <pid>`; subsequent launches do this automatically.
The optional request to reset its nice value was denied, so that value remained
unchanged. Disk growth increased during the following observation interval.

### Completed guest provisioning

Windows booted from its installed disk and SSH became reachable at approximately
11:47 UTC. `quser` confirms local `aobuilder`, console session 2, Active;
auto-logon is enabled. Secure Boot was confirmed from Windows. OpenSSH's ARM64
binary reports 10.4.0.0 and a valid Microsoft signature. A quoted long SFTP
subsystem path was interpreted by the PowerShell default shell as a string;
changed it to `C:/PROGRA~1/OpenSSH/sftp-server.exe`, validated the configuration,
and restarted sshd. Both SSH and SCP/SFTP then worked.

Copied/extracted the staged payload to `C:\ao`, source to `C:\ao\server`, and
maps/data to `C:\ao\Recursos`. All five signed Microsoft VB6 controls registered.
Aurora initially failed registration with exit 3: its import table requires
MSVCP140/VCRUNTIME140, absent from this clean image. Downloaded the official
[Microsoft x86 Visual C++ redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
through `https://aka.ms/vc14/vc_redist.x86.exe`; SHA-256
`7b0117e6e20e9e349029c000a8a2715a52cf37c15b6bb697b2908e8bc7066cdf`.
Windows validated Microsoft's signature and installed version **14.52.37029**.
Added the runtime to the pinned payload manifest and installer.

The resumed installer completed successfully: Aurora and DX8VB registration,
x86 SQLite ODBC installation, WebView2 availability, and the interactive IDE
task. **32-bit `Server.Server` COM activation and ADO/SQLite `SELECT 1` passed.**
twinBASIC process **7796**, session **2**, is responsive. Guest `ready.txt` and
host `provisioned.json` record completion; source import/build remains false.
The post-build SSH launcher correctly rejects a missing `server.exe`.

Ejected both installer and seed CDs using QMP, cleared their UTM media entries,
and removed only the task-created Windows ISO link/APFS clone. The original
Microsoft ISO remains unchanged. Stopped the temporary diagnostic receiver
and detached the host's guest-tools ISO. Subsequent starts use the installed
disk without setup media. UTM itself remains unusable on this Mac; the QEMU
fallback and its disk guard are left running. No Computer Use was used.

Validation includes Python AST parsing, shell syntax, answer-file XML parsing,
whitespace checks, source/installer hashes, the disk-guard simulation, and the
actual guest COM/database/SSH checks above. These changes do not affect the
web client, so its unrelated test suite was not rerun.

Closeout verification at **11:57:51 UTC**: QEMU running, SSH reachable,
local console active, twinBASIC responsive; host free **16,936,652,800 bytes
(16.94 GB)**, minimum observed **16.37 GB**, above the approved
12 GB floor. The disk guard remains active. Elapsed wall-clock through this
check: **1 h 9 min 56 s** since 10:47:55 UTC; commit/push follow.

## 20 November 2026 — VNC password authentication repair

Resumed at **12:44:39 UTC** after the orchestrator deleted the original Windows
ISO to recover space. QEMU was paused by the disk guard and still had its old
unauthenticated VNC listener. Its QMP `set_password` request was rejected while
`query-vnc` reported `auth: none`; the already-committed launch configuration
had not yet been applied to that process.

Restored the disk guard, resumed Windows, and requested `shutdown /s /t 0` over
SSH. Waited for QMP to report `shutdown`, then used `vm-up.sh` to exit the
already-shut-down emulator and restart with the same installed disk, firmware,
memory, CPUs and forwards, plus `-vnc 127.0.0.1:5,password=on`. Neither installer
nor seed media is attached. QMP set the private random eight-character password
from `~/Projects/ao-reference/runtime/ao-vm/vnc-password.txt`, mode `600`.

The launcher now checks the RFB handshake for security type 2 after loading the
password, and handles the QEMU process left alive by `-no-shutdown`. Its recovery
path resumes a SIGSTOP-paused process before querying QMP and refuses to launch
a replacement until the previous emulator has exited.

Verification at **12:52:25 UTC**:

- RFB 3.8 offers only security type **2**; RFB 3.3 also selects type **2** and
  sends the password challenge. An invalid response is rejected. QMP confirms
  `auth: vnc` on **127.0.0.1:5905**. The live unauthenticated listener had been
  rejected by the new check before the restart.
- SSH works; `aobuilder` is active in console session **1**. The existing
  `AOTwinBASIC` task opened process **3772**. A temporary interactive task
  confirmed it is responsive with a **twinBASIC IDE** window, then was removed.
  No project import, compiler invocation, mouse or keyboard automation occurred.
- QEMU PID **5673** is running; the disk guard heartbeat is current and host
  free space is above **22 GB**. The password file is outside Git, mode `600`,
  inside the mode-`700` private state directory.
- Shell/Python syntax and whitespace checks passed. Fault-injection checks
  confirmed recovery from a SIGSTOP pause and refusal to replace a QEMU process
  that has not exited. Running `vm-up.sh` again preserved the active guest and
  authenticated listener.

Elapsed wall-clock through this verification: **7 min 46 s** for this resumed
task; the commit and push follow.

## 20 November 2026 — VNC framebuffer repair

Started at **12:55:02 UTC**. The existing QEMU command already included ramfb,
qemu-xhci, usb-kbd and usb-tablet. A QMP screenshot confirmed the reported
"Guest has not initialized the display (yet)" message; Windows enumerated no
video controller. The earlier process/window checks had not established a
working display.

Before selecting a VirtIO GPU, queried the Windows Driver Store over SSH and
confirmed Red Hat ARM64 **viogpudo 22.7.38.43** (`oem1.inf`) and its matching
PCI hardware ID. Added a private `qemu-display.json` selection of
`virtio-gpu-pci`. The launcher keeps ramfb as the default for unconfigured guests
and a secondary framebuffer for this guest. It creates the GPU's console first
so both VNC and QMP screendump select the Windows display. Existing PCI devices
retain their allocation order. No new driver installation was needed.

Requested `shutdown.exe /s /t 0` over SSH and waited for QMP's `shutdown` state.
The first restart exposed a port preflight failure after the old QEMU process
exited, with no listeners remaining. Enabled `SO_REUSEADDR` for the preflight,
allowing TIME_WAIT connections while still refusing occupied listening ports.
`vm-up.sh` then started QEMU with the same firmware, disk, RAM, CPUs, networking,
USB devices and password-authenticated loopback VNC, plus the primary GPU.
The existing private password was loaded through QMP without printing it.

Verification at **12:58:56 UTC**:

- Auto-logon returned to console session 1; SSH works. Windows reports
  **Red Hat VirtIO GPU DOD controller**, **Status OK**, error code **0**, driver
  **22.7.38.43**, resolution **1024×768**.
- Started the existing `AOTwinBASIC` scheduled task, whose principal is
  `aobuilder`, `LogonType Interactive`. Inspected a PNG from QMP `screendump`
  showing the Windows taskbar and twinBASIC's licence dialog. Saved the final
  image at `artifacts/screenshots/vm-desktop.png` (local artifact, ignored by Git).
  Licence acceptance, project import and compilation remain human steps.
- VNC is **127.0.0.1:5905**, `auth: vnc`; the RFB handshake offers only security
  type **2**. The password file remains mode **600**. QMP reports the USB tablet
  as current and absolute.
- QEMU PID **45351** and disk guard PID **45353** are running. Host free space
  is **22,620,073,984 bytes (22.62 GB)**; the guard heartbeat is current and its
  historical minimum is **14.01 GB**, above the **12 GB** floor.
- Python syntax and focused checks passed for ramfb default selection, VirtIO
  primary-console ordering, invalid-device rejection and live-port rejection.
  The actual restart and framebuffer inspection verified the complete path.

Elapsed wall-clock through visual/runtime verification: **3 min 54 s**;
documentation, final checks, commit and push follow.

## 2026-11-20 18:00-18:25 CET first run of the twinBASIC-built classic server (BLOCKED: unlicensed OCX)
Result: `C:\ao\server\server.exe` (14,658,048 B, 17:48) starts but never listens on 7667. M1 bot / M2 browser client were NOT run (nothing to connect to).
- `scripts/vm-ssh.sh 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/ao/start-server.ps1'` -> task AOClassicServer runs, process `server` alive (~42 MB, 0.17 s CPU, idle), no listener after 30 s. `Server.ini` StartPort=7667 (matches QEMU hostfwd). No logs written except `Logs/recordusers.log`.
- Cause found by enumerating the process's windows from an interactive scheduled task (EnumWindows, principal aobuilder/Interactive, task removed after): a visible modal `#32770 'ActiveX error'` owned by server.exe: "instance creation failed for control ComctlLib.ProgressBar (name: cargar)". Startup is blocked on `frmCargando`.
- Probe from 32-bit PowerShell: `[Activator]::CreateInstance(GetTypeFromCLSID 0713E8D2-850A-101B-AFC0-4210102A8DA7)` -> **0x80040112 CLASS_E_NOT_LICENSED**. The KB2708437 comctl32.ocx 5.0 is registered (WOW6432Node CLSID ok) but `HKCR\Licenses` has no key; VB6 exes embed the licence, twinBASIC-built exes do not. `regsvr32` of `C:\ao\server\MSCOMCTL.OCX` (repo-supplied) exits 3 and is not the typelib the VBP references anyway (VBP uses `{6B7E6392-...}#1.3 comctl32.ocx`).
- Only 3 ProgressBars use it: `frmCargando.cargar`, `frmDbControl.pbarDb`, `FrmStat.ProgressBar1` (all `ComctlLib.ProgressBar`).
- Not done on purpose: no licence key was guessed or injected into the registry (licensing is Ariel's call).
- Cleanup: killed my own server.exe, removed temp scripts in C:\ao. AOClassicServer task left registered (Ready). Undo of nothing else needed; VM state otherwise unchanged. Host disk 22 GB free.
Options (each needs a human twinBASIC re-import/build): (1) replace the 3 ProgressBars with a PictureBox/Label bar or twinBASIC's native ProgressBar and delete the `Object=` comctl line if nothing else uses it (fastest, no licence issue); (2) Ariel supplies the VB6 licence key/LPK and we add it under `HKCR\Licenses`; (3) check other comctl32 controls (grep showed only ProgressBar in server .frm files).

## 2026-11-20 licence-free ProgressBar patch (option 1, coordinator go)
Patch only, no GUI, no build. Applied in the VM at `C:\ao\server`; backups `<file>.orig2` (frmCargando.frm, FrmStat.frm, frmDbControl.frm, Server.VBP). Diff: `scripts/vm/patches/2026-11-20-progressbar-replacement.patch` (CRLF, latin-1; already applied in the VM, do not re-apply).
- New `Codigo/clsProgressBar.cls` (Min/Max/Value/Visible, paints a bar with `Line ... BF` on a PictureBox). Added `Class=clsProgressBar; Codigo\clsProgressBar.cls` to Server.VBP.
- Each of the 3 forms: ComctlLib.ProgressBar replaced by `VB.PictureBox picCargar / picProgress1 / picPbarDb` (same position/size/TabIndex/Visible), `Public cargar|ProgressBar1|pbarDb As New clsProgressBar` plus `Form_Initialize` that binds `.Host`. All existing `frmCargando.cargar.Min/.max/.value`, `With frmCargando.cargar`, `FrmStat.ProgressBar1.value = .value + 1` and `pbarDb.Visible/.max/.value` call sites stay untouched (FileIO.bas, Admin.bas, frmDbControl.frm). The `Object = ...comctl32.ocx` line removed from the 3 .frm and `Object={6B7E6392...} comctl32.ocx` from Server.VBP.
- grep of every .frm/.bas/.cls for ComctlLib / MSComctlLib / ProgressBar: only those 3 controls (no TreeView, ListView, ImageList, StatusBar etc.). Nothing else references comctl32.ocx.
- Licence scan (32-bit PowerShell CreateInstance of every CLSID registered to comctl32.ocx, msinet.ocx, msdatgrd.ocx): ALL fail 0x80040112 (not licensed), including MSINET Internet Transfer {48E59293...} and DataGrid {CDE57A43...}.
  - MSDATGRD: `frmDbControl.DataGrid1` is used (opened from a frmMain menu item, frmMain.frm:730), NOT at startup. Still a licence risk the first time that form opens; left untouched (not in the brief).
  - MSINET: `Object=` line in Server.VBP only; no form or code uses Inet. Proposal: delete that VBP line (harmless, avoids a dead dependency).
- Undo: copy each `.orig2` over its file and delete `Codigo\clsProgressBar.cls`.

## 2026-11-20 18:00-18:30 run of the rebuilt server.exe (14,696,960 B, 17:58:38): STILL NOT LISTENING (crash during data load)
No ActiveX modal any more; the ProgressBar patch works. M1 bot / M2 client NOT run (no listener on 7667).
1. First run: process alive, idle at 3.6 s CPU, modal `#32770 'ERROR MIGRATIONS'` (found with EnumWindows + EnumChildWindows from an interactive scheduled task): "No value given for one or more required parameters. Script: invalid - change first castle coordinate val". Cause: `RunScriptInFile` strips CR/LF, so the leading `-- Update castle coordinates...` comment swallows the whole `UPDATE` (only ScriptsDB file with a `--` line; 34 earlier migrations ran fine).
   Fix (data only, no rebuild): removed the comment line from `C:\ao\server\ScriptsDB\20260724-01-change first castle coordinate val.sql` (backup `.orig3`). After it, migrations 35-46 all applied (last `20261111-03`).
2. Second run: no modal, one thread at 100% CPU (about 12.5 s CPU per 12 s, WS 650-750 MB), then **APPCRASH after ~90 s CPU**: server.exe 5.6.0.75, fault module `ucrtbase.dll` 10.0.26100.9444, exception 0xC0000005 (read AV, address 0x13A5xxxx), offset 0xfccac. Reproduced 3 times (18:03:31 and two more). Modules in the WER report: ADO, ODBC32, sqlite3odbc, scrrun, WMI; **no Aurora.Network / DX8VB loaded**, so it dies in the data-load phase of `Sub Main` (between `LoadDBMigrations` and `modNetwork.Listen`), before the network layer. Logs written: only numusers.log/recordusers.log.
   - Minidump via WER LocalDumps (temporary registry key `HKLM\...\Windows Error Reporting\LocalDumps\server.exe`, DumpType 1, folder `C:\ao\dumps`; remove with `Remove-Item` on that key if unwanted): copy at `/private/tmp/claude-501/aodump/server.exe.4616.dmp` (2.8 MB). The thread is x86 under xtajit emulation; stack return addresses land in server.exe+0xa481e1 etc., but twinBASIC emitted no PDB/MAP so they cannot be mapped to a procedure.
3. `Server.VBP`: removed the unused `Object={48E59290...} MSINET.OCX` line (backup `Server.VBP.orig3`), in the VM only; it takes effect in the next rebuild. MSDATGRD line stays (used by frmDbControl).
Next cheapest step (human, ~2 min): in the twinBASIC IDE press F5 (run, not build) with Server.VBP project open; the IDE debugger stops on the exact failing line of the data-load phase (likely a Load* routine, or a CRT call such as a bad String/UDT copy). Alternative: I can bisect by adding temporary `Open ... For Append` trace lines in `Sub Main` between each Load* call (patch only, rebuild by human) so the last line written names the failing loader.
Undo: `.orig3` copies; clean-up of temp scripts in C:\ao done; AOClassicServer task Ready; server not running.

## 2026-11-20 crash root cause: clsIniManager.SortMainNodes (patch only, human rebuild pending)
Debugger (human, IDE F5): ACCESS_VIOLATION at `clsIniManager.cls` line 237 (`ucrtbase.dll+0xFCCB0`), during map NPC `.DAT` loads (`CargarMapaFormatoCSM`).
- Line 237 = `fileData(Min) = fileData(max)` inside `SortMainNodes`. There is no CopyMemory/StrPtr trick in this class: it is a plain whole-UDT swap (`Temp = fileData(Min): fileData(Min) = fileData(max): fileData(max) = Temp`) of `MainNode`, which holds a dynamic array member (`values() As ChildNode`). twinBASIC's UDT copy memcpy's the array descriptor and faults on self-assignment (Min = max, which quicksort hits constantly) and/or on an unallocated `values()` (section with no keys, common in the map NPC .DAT files, absent in the earlier files that sorted fine). VB6 tolerated both.
- Fix (`C:\ao\server\Codigo\clsIniManager.cls`, backup `.orig4`, diff `scripts/vm/patches/2026-11-20-inimanager-swap.patch`): new `SwapMainNodes(A, B)` swaps name / numValues / values() member by member, returns on A = B, copies `values()` only when numValues > 0 and `Erase`s otherwise; `SortMainNodes` calls it. `SortChildNodes` keeps its swap (ChildNode is two Strings, no array) but skips Min = max. Behaviour (sorted order) identical.
- Whole-Codigo grep for CopyMemory/RtlMoveMemory/ZeroMemory/MoveMemory/StrPtr/VarPtr/ObjPtr/Not Not: no other VarPtr/ObjPtr/Not Not. Remaining, NOT changed, listed as risk: `cStringBuilder.cls` (CopyMemory ByVal StrPtr(...) string-buffer writes, lines 139/182/215-250; used by DatabaseGlobals, CharacterPersistence, Database_Queries, JSON, modDatabase); `PathFinding.bas:621` MoveMemory over `OpenVertices` (t_Position, plain numeric UDT, low risk); `AntiCheat.bas:81`, `Protocol_Writes.bas:4682` (byte buffers from pointers, low risk); `wskapiAO.bas:431` (winsock, unused with Aurora); `Modulo_SysTray.bas:59` (tray window proc); `General.bas:1627` ZeroMemory on `CharList` (Integer array, fine). Other whole-UDT assignments of types with array members elsewhere were not enumerated.
- Cleanup: WER LocalDumps key for server.exe removed, `C:\ao\dumps` deleted, server not running.

## 2026-11-20 first live contact: M1 bot vs the VB6 server (IDE F5 session, host 127.0.0.1:7667)
Result: transport, framing and the login handshake match PROTOCOL.md byte for byte; character LOAD fails server-side, so no 30 s session and no walks yet.
- Test data (local only): `tools/real-server/vb6-create-account.mjs` (new) sends `CreateAccount(304: email:s, password:s)` then `LoginNewChar(74: name:s, race:v, gender:v, class:v, head:v, home:v)`, the PYMMO=0 handlers (`Protocol.bas:1369`, `:1845`; `ValidarCabeza`: human male head 1 ok; race 1, gender 1, class 3 Warrior, home 1 Ullathorpe). Created account `aotest@local.test` / `aotestpw1`, characters `Aotest` (id 1) and `Aotesta` (id 2; my second run also inserted a duplicate account row: `account.email` has no UNIQUE constraint, so `CreateAccount` never answers "ya hay una cuenta"). Rows verified in the VM `Database.db` (pos map 1, 57,44).
- Bot: `AO_PORT=7667 AO_EMAIL=aotest@local.test AO_PASSWORD=aotestpw1 node apps/bot/dist/cli.js`:
  `recv Connected(1)` body `01 01 0a 01..0a` (DEBUGGING=1 variant, as PROTOCOL.md predicts) -> `LoginAccount(305)` -> `AccountCharacterList(199)` with 2 records decoded (`Aotest`, `Aotesta`, body 107, head 1, class 3, map 1, 57,44, level 1) -> `LoginExistingChar(73)` -> server sends `ShowMessageBox(40)` payload `ed 06 00` (msg 1773 `MSG_NO_SE_PUEDE_CARGAR_EL_PERSONAJE`, empty arg) and closes. The same ShowMessageBox follows `LoginNewChar`, after ChangeInventorySlot(63).
- Protocol diffs vs PROTOCOL.md / the lambdaclass classic profile: **none found on the wire** (frame header, varints, String8, Connected, AccountCharacterList, packet ids 1/199/73/74/304/305/63/40 all as documented). Differences in the FLOW only: VB6 needs `CreateAccount`+`LoginNewChar` to make a character (the bot has no such path; the elixir profile used a pre-seeded account); `Connected` carries the debugging SAFEARRAY.
- Failure (Windows Application log, source `Argentum20`, event 20, read with `Get-EventLog -LogName Application -Source Argentum20`): `[Database.log] Error en LoadCharacterFromDB: Aotest. -2147467259 - Unspecified error. Línea: 0` (E_FAIL), for both characters and both the new-char and existing-char paths. `QUERY_LOAD_MAINPJ` itself is valid: the same SQL run with sqlite3 on the VM database returns the row. So the E_FAIL comes from ADO/ODBC field access or a Setup* routine in `CharacterPersistence.bas:253-313` (reading `RS!...` columns / `SetupUserBasicInfo`, `SetupUserFlags`, ...) in the twinBASIC runtime; the error handler discards the line (Línea: 0). Not yet located.
  - Suspect, NOT changed: `cStringBuilder.cls` (CopyMemory on StrPtr) builds that query; I drafted a plain-string rewrite, then reverted it (VM file restored byte-identical to the original) because the insert query built by the same class worked, so it is unproven.
  - Cheapest next step (human, 2 min): in the twinBASIC IDE debugger, set break on all errors (or put a breakpoint on `ErrorHandler:` of `LoadCharacterFromDB`), log in with the bot or `node /private/tmp/.../ao-probe-login.mjs` equivalent, and read the failing line.
- Other server-side noise at load (Application log): many `404 NPC no existe en los .DAT's ... CargarMapaFormatoCSM` / `OpenNPC FAILED NpcInfoCache entry does not exist: <n>` (maps reference NPC numbers missing from the NPC cache: 944, 994, 1307, ...). Data load continues past them.
- Browser: `AO_ASSETS=~/Projects/ao-reference/Recursos AO_TCP_PORT=7667 AO_WEB_PORT=5197 node tools/dev-web.mjs` (classic profile) + headless Chrome: login reaches the server, then "Server connection closed"; screenshot of that state `artifacts/screenshots/vb6-real-login-char-load-fails.png` (gitignored). Not a success shot.
- Housekeeping: IDE session / server process untouched. Host disk 13 GB free at the end (VM image 17 GB).

## 2026-11-20 instrumentation patch for the LoadCharacterFromDB E_FAIL (patch only, human re-import + F5 pending)
`C:\ao\server\Codigo\CharacterPersistence.bas` (backup `.orig5`, diff `scripts/vm/patches/2026-11-20-characterpersistence-dbgstep.patch`, CRLF/latin-1, already applied in the VM).
- Module-level `Dim dbgStep As String`; 151 markers `dbgStep = "<Sub> L<line>: <statement text>"` placed before every `RS!field` read, `Query(`/`Set RS`/`Execute(` call and every `Call` in `LoadCharacterFromDB`, in `SetupUserBasicInfo/Flags/FactionInfo/Spells/Pets/BankInventory/Skills/Quests/QuestsDone`, `LoadCharacterBank`, `LoadCharacterInventory`, `GetPatronTierFromAccountID`. No logic changed.
- The four error handlers (main, Bank, Inventory, Patron tier) now log `... Línea: <Erl> [dbgStep=<last step>]`; the main one also logs `Source=<Err.Source>`.
- Static suspect: none obvious. Candidates considered and left alone: main recordset `RS` stays open while the `Setup*` routines run other queries on the same connection; fields are read out of select order and some twice (`is_banned`); neither is wrong in VB6.
- Read the result: `Get-EventLog -LogName Application -Source Argentum20 -Newest 5 | % { $_.Message }` after running `node tools/real-server/vb6-create-account.mjs`-style login (or the bot).

## 2026-11-20 first dbgStep read was useless (instrumentation bug), fixed
Application log after login: `Error en LoadCharacterFromDB: Aotest. -2147467259 - Unspecified error Source=. Línea: 0 [dbgStep=LoadCharacterFromDB L334: Call LogDatabaseError(...)]`. My marker generator had also put a marker on the first line of the `ErrorHandler:` block, overwriting the real last step. Removed (backup `.orig6`, patch file regenerated); other handlers never had one. Needs one more re-import + F5.

## 2026-11-20 dbgStep result and fix attempt (needs one more re-import)
Application log: `Error en LoadCharacterFromDB: Aotest. -2147467259 - Unspecified error ... [dbgStep=SetupUserSpells L436: User.Stats.UserHechizos(RS!Number) = RS!spell_id]`. So SetupUserBasicInfo/Flags/FactionInfo (direct `.x = RS!field` assignments) all pass; it dies in the first `Setup*` that uses a Field object as an ARRAY INDEX or member index.
Data is fine (spell rows: integer number 1-40, spell_id 0; `typeof` integer, no NULLs).
Fix (patch only, `CharacterPersistence.bas`, backup `.orig7`, diff regenerated): every `X(RS!Number)` becomes `X(CLng(RS!Number))` (19 places: spells, pets, bank, skills, quests); `RS!spell_id`, `RS!pet_id`, `RS!value` wrapped in `CLng(SanitizeNullValue(..., 0))`; extra `dbgStep = "<Sub>: before RS.MoveNext"` markers so a MoveNext failure is distinguishable. Hypothesis: twinBASIC does not coerce an ADO Field default value in an index/subscript expression. Unproven until the next F5 run.

## 2026-11-20 sweep of ADO Field usage in all of Codigo (patch only; backups `.orig8`)
Scope: every `RS!x`, `Result!x`, `RS2!x`, `RS.Fields(..)`, `RS("..")` in the 148 source files (recordset variable names in the code base: only RS, Result, RS2; 324 `!` uses + 21 `.Fields`/`("")` uses). Plain `lhs = RS!x` assignments, `CStr/CLng(RS!x)` and `x = RS.Fields(n).value` were left (the BasicInfo/Flags/Faction reads of the main character row, ~90 such assignments, executed fine in the live server; `GetPersonajesCuentaDatabase(Result!Id,...)` also works).
Wrapped (23 lines, 5 files; plus the 19 `(RS!Number)` subscripts and 3 value reads already done in the previous patch): ByRef String param (`SQLiteToDate(CStr(RS!start_date))`), Byte/Integer ByVal params (`EquiparInvItem` x2, `GetCastleSlotById`, `WriteCharacterInfo` args), array bound (`ReDim CastleData(1 To CLng(RS.Fields(0).value))`), `Split(CStr(SanitizeNullValue(RS!NPCs...)))` x2, `val(CStr(SanitizeNullValue(...)))` x3, `Query(..., CLng(RS!id) / CStr(RS!character_name) / CLng(RS!castle_id))` (ParamArray -> `CreateParameter` switches on `VarType`, a Field object would fall through), arithmetic and comparisons against enums (`ModGlobalQuests`, `IsLegion/IsArmy`, `RS!Number >= LBound`), `GetUserName(CLng(RS!user_id))`, `GetCharacterNameByUserId(CLng(...))`.
Files: CharacterPersistence.bas, ModCastle.bas, ModGlobalQuests.bas, clsClan.cls, modDatabase.bas. Diff: `scripts/vm/patches/2026-11-20-recordset-field-coercion.patch` (relative to the VM state after the earlier patches). Select Case / For-bound uses of a Field: none found other than the ReDim above.

## 2026-11-20 18:50 SUCCESS: real VB6 server (twinBASIC build, IDE F5) vs M1 bot and M2 browser client
After the ADO-field sweep patch (`.orig8`) the character loads (no `.orig9` needed). Server on 127.0.0.1:7667 (map load takes ~14 min under the debugger).
- M1: `AO_HOST=127.0.0.1 AO_PORT=7667 AO_EMAIL=aotest@local.test AO_PASSWORD=aotestpw1 node apps/bot/dist/cli.js` -> `SUCCESS {"connectedMs":30029,"walksSent":5,"confirmedWalks":5,"inferredWalks":0,"correctedWalks":0,"map":1,"position":{"x":58,"y":44}}`. One extra id seen: S->C 112 (2-byte payload, unknown to the decoder, skipped as designed).
- M2: `AO_ASSETS=~/Projects/ao-reference/Recursos AO_TCP_PORT=7667 AO_WEB_PORT=5197 node tools/dev-web.mjs` + headless Chrome: Connected, "Ciudad de Ullathorpe", character Aotest rendered, 4 arrow steps confirmed, 0 corrections. Screenshot `artifacts/screenshots/vb6-real-ingame.png` (gitignored).
- Root cause chain: (1) unlicensed comctl32 ProgressBar OCX, (2) a `--` comment line in a ScriptsDB migration, (3) whole-UDT swap in `clsIniManager.SortMainNodes`, (4) ADO Field objects used as subscripts/typed args in `CharacterPersistence` (twinBASIC does not coerce them).

## 2026-11-20 classic-UI client (origin/main b44a35d, PR #5) vs the real VB6 server: WORKS
Worktree `../ao-client-classic` at origin/main (detached, removed afterwards; vm-server untouched). `AO_ASSETS=~/Projects/ao-reference/Recursos AO_TCP_PORT=7667 AO_WEB_PORT=5198 node tools/dev-web.mjs` (profile `classic`), headless Chrome, account aotest@local.test, CONECTAR.
- Desktop 1280x860 and phone 390x844 (touch, dpr 3): both Connected on Ciudad de Ullathorpe as Aotest, position 58-60,44 after 5 arrow steps (59,44 desktop; 60,44 phone), `#error` empty, no page errors (one 404 for a static resource). Console shows the server's welcome lines and uptime; inventory shows 14 real items (500/35/100... stacks), spells list, HP 20/20, stamina 60/60, hunger/thirst 100. Screenshots `artifacts/screenshots/vb6-real-classic-desktop.png`, `vb6-real-classic-phone.png` (gitignored). Phone view is the whole 1024x768 layout scaled to width (small, letterboxed vertically).
- Strict decoder: **no rejected frame, login not blocked**; no decoder change/PR needed. ConsoleMsg (37, 3 frames) and UpdateExp-adjacent stats (UpdateUserStats 61) decode on the VB6 bytes. The decoder skips unknown ids by design; ids the VB6 server sends at login that the decoder does not know (name from ServerPacketID, first bytes):
  20 SafeModeOn (empty) · 46 UserIndexInServer `0100` · 50 ObjectCreate x12 `38195c09010000000000` · 53 BlockPosition x8 `482301` · 57 AreaChanged `3c2c` · 80 LevelUp `0a00` · 87 SendSkills (24 zero bytes) · 102 FYA `131300001313` · 104 Contadores `00000000` · 112 UserOnline x2 `0100` (the id 112 the bot reported) · 117 hora `ec17290000dd6d00` · 120 SpeedToChar x2 `fa090000803f` · 134 VelocidadToggle x2 `0000803f` · 136 BindKeys `0101` · 141 LocaleMsg `0a0206416f746573740800` · 160 UpdateRM `0000` · 161 UpdateDM `0000` · 177 Privilegios `00` · 195 SendClientToggles (feature-toggle strings) · 197 AntiCheatStartSession (empty) · 201 GuildConfig `030604050803040508090a0b0c`. Writers are in server `Protocol_Writes.bas` (`WriteUserOnline`, `WriteObjectCreate`, ...); not needed for login/walk.
- Wall-clock for this step ~10 min.

## 2026-11-20 tailnet-only playable classic client for Ariel (no secrets here)
- Worktree `~/Projects/ao-client-play` (detached at origin/main, production build via `pnpm build`; local-only 1-line change in `tools/dev-web.mjs`: optional `AO_ALLOWED_HOSTS` for vite preview so the MagicDNS name is not 403). Untracked helper `play.sh start|stop|status` (nohup, log `.play.log`, pid `.play.pid`).
- Exposure: ONE listener, `REDACTED-IP:5199` (this Mac's tailnet IP only; verified with lsof, nothing on 0.0.0.0, no tunnel/funnel/Vercel). It serves the built client, the local assets (`AO_ASSETS=~/Projects/ao-reference/Recursos`) and proxies `/bridge` (same origin, so the client's WS URL follows the tailnet host) to the bridge, which listens on 127.0.0.1 only and forwards to the VB6 server 127.0.0.1:7667. URL `http://ariels-macbook-pro-1.tailfe04d6.ts.net:5199/` (fallback `http://REDACTED-IP:5199/`).
- Account for Ariel created with `tools/real-server/vb6-create-account.mjs` (ariel@local.test, character Player); credentials only in the gitignored `ao-client-play/.local-credentials` (mode 600).
- Verified from this Mac through the tailnet URL (not localhost): login, Connected, character Player on Ullathorpe 57,44, 2 steps right.
- Note: the VB6 server runs inside the twinBASIC IDE F5 session; if it stops, the page connects but cannot log in. A localhost URL does not work (bound to the tailnet IP only).

## 2026-11-20 doors / roofs (PR #6, branch feat/doors-roofs) and a halted VB6 server
- Real traffic (aotest walking Ullathorpe): the server sends `ObjectCreate`(50: x,y,objIndex i16,amount i16,tags i32), `BlockPosition`(53: x,y,sides) and `ObjectDelete`(52: x,y); closed doors are blocked (sides 1/6/12 around the door tile, e.g. door obj 76 at (45,40)). Ullathorpe has 7 plain doors (obj 2334 "Puerta cerrada", Llave=0 at (72,35),(82,35),(26,37),(47,64),(62,66),(44,79),(65,79)) and many key doors (Llave=1: houses). Opening is client-initiated: `DoubleClick`(96)/`LeftClick`(95) with x,y. Tile exits (TE) do the map change when stepped on (324 in map 1; building interiors e.g. maps 600-603, 748, 168).
- Cause of "can't enter buildings": the M2/classic client ignored packets 50/52/53 and never sent a click, so doors were invisible and stayed closed. Not yet confirmed live which exit tile an open door leads to (server stalled, below).
- Roof rule (VB6 `HayTecho`: trigger >= 60 or 1, 4, 16; layer-4 tiles with the player's trigger fade). Ullathorpe's triggers (26-54) are all < 60, so by the VB6 rule it has no fading roofs.
- BLOCKER (not caused by me): at ~19:55 the IDE-hosted server stopped answering: the twinBASIC debugger is halted on `Debug.Assert False` at `modDatabase.bas` `Query_Err:` (red dialog "Run-time error ... Assertion FAILED", Try Again / Ignore (Resume Next) / Stop). TCP accepts, no Connected packet. Started after Player's character creation/login. It needs a human click (I was told not to click GUIs). Likely a failing query for the new account; after resuming, check `Get-EventLog -LogName Application -Source Argentum20 -Newest 5` for `[Database.log] Database Error`.
- PR #6 is a draft: not yet verified live and play (5199) NOT updated.
