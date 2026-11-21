# Build log

## Decision 2026-11-20 11:07 CET (Ariel): classic UI first

The client reproduces the VB6 client's own UI (original interface graphics: main
window frame, inventory, spells list, console) with no redesign. Reasons: minimise
design/dev work and allow screen-by-screen comparison with the original. UI
modernisation comes later. Phones use the scaled classic layout until then. The
M2 custom dark web frame is to be replaced. AO Forever is a technical reference
only (browser client over WebSocket), never a visual one.

## 2026-11-20 classic UI: independent base decision

Session started **10:10:50 UTC / 11:10:50 CET**. Compared `m2-browser@01b5415`
(draft PR #2) and `m2-render@39f6266` by reading both implementations and running
their typechecks, unit/transport tests and production builds. Chosen base:
**m2-browser**; `classic-ui` branches directly from that commit. Neither original
branch is deleted, rewritten or merged into the other.

| Criterion | m2-browser | m2-render |
| --- | --- | --- |
| Browser/formats source, including HTML/CSS | 6 files; 1,328 lines; 47,435 bytes | 13 files; 1,057 lines; 62,346 bytes |
| Clarity | Small resource reader and transport-independent Session; UI CSS accounts for 539 lines | Better formats/input separation, but denser source and socket lifecycle coupled to GameClient |
| VB6 render fidelity | Four/five-layer maps, original bodies/heads, color key, smooth movement; fixed 2× zoom and actor-before-entire-layer-4 ordering need attention | Native zoom, artwork-bound culling, actor interleaved with layer 4, legacy body offset; camera snaps each tile |
| Fresh tests | 77/77; typecheck/build pass; committed Playwright desktop Chrome + 390px Chrome/WebKit suite, plus opt-in real community server test | 71 pass + 8 local-resource tests skipped without AO_ASSETS; **79/79 with local resources**; typecheck/build pass; Chrome Puppeteer smoke script |
| Fresh bundle: all JS, raw / gzip level 9 | 557,917 / 163,228 bytes | 411,184 / 118,281 bytes |
| Fresh CSS, raw / gzip level 9 | 6,586 / 2,201 bytes | 8,577 / 2,659 bytes |
| Shared protocol reuse | @ao/protocol + byte-transparent bridge | Same: protocol and bridge source have zero diff |

The decisive advantage is the browser Session's one-outstanding-walk/position
probe, explicit confirmation/correction, silence timeout, warp/reconnect handling,
and broader browser regression coverage. The competing branch has valuable render
details and a smaller bundle; those do not outweigh the risk of rebuilding session
correctness. Native 1× map rendering is required for the original 736×608 viewport.
Asset bytes are excluded from every bundle measurement; all chunks are counted.
Source line counts are not used as a proxy for clarity (the renderer branch packs
more bytes into fewer lines). No new UI framework is needed.

UI source: local classic client `b648c1a9b14903884393a7194e9faa0bc275633b`,
resources `89615f34162d9fa0bf0fae4242cd6639edbf772f`.
`frmMain.frm` stores positions in twips (15 per pixel at 96 DPI), including
renderer (10,150,736,608), panel (768,160,247,325), panelInf
(756,521,266,245), console (16,32,612,85), and chat (40,120,545.6,24).
Its design-time 1332×928 form is not the runtime window: `SetupGameplayUI` uses
the 1024×768 backbuffer (`dx_utils.bas`/`clsRenderer.cls`), matching the original
1024×768 `es_ventanaprincipal.bmp`. `FormParser` changes cursors, not geometry.
Inventory: 6 columns × 7 rows, 35px pitch, 9px gap after 24 normal slots,
original indexed slot graphics 47743 / 47742 / 1122. Stats use the runtime
bar maxima from frmMain (216px HP/mana, 89px stamina, 32px food/water, 235px XP).
All licensed artwork and rendered screenshots stay local and ignored.

### Classic UI implementation and local evidence

- Replaced the custom dark frame with the original Spanish main-window, inventory,
  spells, stats/menu, login and bar bitmaps, loaded through the local `AO_ASSETS`
  allowlist. Added only `interface/*.bmp` and `Dat/{Obj,Hechizos}.dat` to the
  existing resource mount. No artwork, reference forms or screenshots are committed.
- Native form geometry is recorded in `classic-layout.ts`; phones uniformly scale
  the whole window, including its 736×608 world. Inventory uses the original slot
  graphics and object names/icons; the spells list uses original names/descriptions.
  Unknown server values remain blank/dashes. Casting, item use/equipment changes,
  and other unimplemented menu actions are explicitly unavailable.
- Added verified classic stats, inventory, spell, food/water and console packets,
  plus paced client chat, to the existing protocol package. Paired VB6 procedures
  are in `docs/PROTOCOL.md`; independent C++ oracle bytes cover the new packets.
  The byte-transparent bridge is unchanged. The explicit browser stand-in supplies
  labelled synthetic UI data; the community adapter still supports login/movement
  only, so its chat action reports that limitation without sending a packet.
- Checked render details directly against VB6: native 1× tiles, half-tile camera
  center, classic body/head offsets, and layer-4 ordering around the character's
  row. Kept the chosen base's session, smooth interpolation and five-layer parser.
- WebKit rejected several original uncompressed true-color BMPs because their
  headers declare important palette colors despite having no palette. On native
  decode failure, a browser-local copy clears only those unused header fields.
  The source files and every pixel byte stay unchanged; synthetic unit fixtures
  verify this behavior and reject unsupported/truncated input.
- The full browser run exposed a held-input timing bug: a new walk could start
  after the current tick captured its timestamp, indexing animation frame -1.
  Clamp the first animation frame to zero, matching position interpolation. The
  held-key/blur regression also asserts that the session remains connected.
- Fresh comparison smoke for `m2-render` passed its Chrome desktop/mobile script,
  including accepted/blocked movement, touch drag, resize and DPR changes. This
  does not change the base decision: both original branches remain available.
- Another task switched the shared checkout to `vm-server` while this work was
  running. Moved only this task's changes into the isolated worktree
  `~/Projects/ao-client-classic-ui` on `classic-ui`, restored the shared checkout
  to its clean VM state, and repeated verification in the isolated worktree.

### Classic UI verification (2026-11-20 11:42 CET)

- `pnpm install --frozen-lockfile`, `pnpm typecheck`, all five workspace builds,
  and `git diff --check` pass. Final unit/transport run: **97/97 tests, 7 files**.
  One earlier concurrent run exposed the existing bot fixture's 10ms reply-window
  flake (four confirmed steps instead of five). Normal fixture replies now have
  100ms; the intentional late-correction test explicitly retains 10ms. Production
  bot timing is unchanged. Final unit verification passed after that adjustment.
- `AO_ASSETS=~/Projects/ao-reference/Recursos pnpm test:browser`: **9/9 pass**,
  desktop Chrome, 390px mobile Chrome and 390px mobile WebKit. Each connects through
  the actual WS/TCP bridge, walks four directions, stays connected 30 seconds,
  rejects bad credentials and reconnects. Checks also cover held-key/blur stopping,
  landscape resize/touch, the resource allowlist, 42 slots, inventory/spell/menu
  controls, packet-driven bar widths, and literal chat text without HTML execution.
- The geometry oracle reads the local original `.frm` independently of production
  layout constants. Visible controls agree within 0.08 native pixels; every phone
  panel uses the same scale and the page has no horizontal overflow.
- `pnpm size:web` counts every emitted chunk with gzip level 9: **JS 572,483 raw /
  168,538 gzip bytes** (9 files), **CSS 3,462 / 1,322 bytes** (1 file), HTML
  6,595 / 1,855 bytes. JS + CSS: **169,860 bytes gzip (169.9 kB / 165.9 KiB)**.
  Licensed artwork is excluded and still comes only from the local mount.
- Locally inspected screenshots under
  `/Users/dev/Projects/ao-client-classic-ui/artifacts/screenshots/`:
  `classic-desktop-chrome.png`, `classic-mobile-chrome.png`,
  `classic-mobile-webkit.png`, and `classic-spells-*.png`.
  `vb6-reference-{inventory,spells}-{desktop,native,390}.png` reconstruct the
  source layout with the original bitmaps. `comparison-desktop.png` and
  `comparison-390.png` place the browser and reference side by side.
  These references are **not captures of a running VB6 executable**; dynamic
  reference labels are the form defaults and the world is blank. No claim of
  native Win32 font parity or physical-phone testing.
- The opt-in real community-server test was adapted to the classic controls but
  was not rerun in this session (no credentials supplied). Earlier M2 real-server
  evidence remains separate. New classic UI state/chat is verified against source
  procedures, independent oracle bytes, and the explicitly labelled stand-in.
- Published `classic-ui` and opened **draft PR #5** against `m2-browser`:
  https://github.com/arielcamus/ao-client/pull/5. Feature commit `a4c4b1f`.
  Real wall-clock from session start to opening the draft: **33m 27s**
  (10:10:50–10:44:17 UTC), including branch comparison, implementation and retries.

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

## 2026-11-20 PR #5 classic adapter packet audit and live verification

Work started **10:53:58 UTC**. The adapter's tracked source is in this repository,
`tools/real-server/classic_profile.ex`, so the fix is on PR #5's `classic-ui`
branch. No changes were made to `~/Projects/argentum-server`, its `gate-fixes`
branch/worktree, or that job's running server. Validation used the existing,
separate pinned checkout `ao-reference/argentum-elixir` at `1699a662`.

Confirmed against both official VB6 trees at the revisions in PROTOCOL.md:

- Server `Protocol_Writes.bas:666` (`WriteUpdateExp`) writes Int16 ID 29 then
  exactly one Int32 experience value. Client `Protocol.bas:1375`
  (`HandleUpdateExp`) reads exactly one Int32. The classic frame for XP 25 is
  `06 00 1d 00 19 00 00 00`. The port adds a second Int32, `next_xp`.
- The adapter now removes that field only at the classic TCP boundary.
  The client decoder, shared upstream encoder and native WebSocket protocol
  stay unchanged. Next-level XP belongs to UpdateUserStats (61).
- The full audit found one additional mismatch: ConsoleMsg (37) retained the
  port's Int16 string length. It now uses classic varint UTF-8 byte length and
  appends `TEXTCHANNEL_SYSTEM = 0`, the neutral default for the port's absent
  channel. This matches `PrepareMessageConsoleMsg:3477` and
  `HandleConsoleMessage:1834`.

The [complete audit table](../tools/real-server/README.md#complete-decoded-packet-audit-pr-5)
covers **21 emitted/client-decoded packet types**. InventoryUnlockSlots (64),
PosUpdateUserChar (186), and PosUpdateChar (187) are decoded but never emitted by
this pinned port; the coverage test checks that explicitly.

Added C++ oracle fixtures for adapter defaults and edge cases, 21 individual
byte-exact table rows, an emitter/decoder coverage guard, signed Int32 XP limits,
empty/128-byte UTF-8 console strings, and profile-off preservation of all native
commands in the table. `verify-wire.mjs` decodes the actual Elixir adapter output
with the built client codec, both coalesced and byte-at-a-time, and verifies
exact re-encoding. It does not substitute TypeScript-generated expected bytes.

Before applying the fix, **19/21 table rows passed**, UpdateExp/ConsoleMsg failed,
and the production decoder reproduced `Packet id=29: 4 trailing bytes in
one-message frame`. After applying it with `prepare.sh`, **21/21 rows and 29/29
ExUnit tests passed**, including the cross-language check. The existing **97/97
unit/transport tests**, typecheck and all five workspace builds passed.

Final live test against the real community server on TCP 17666 and PR #5's
production browser bundle through the normal WS/TCP bridge:

- **Passed in 33.7 seconds** (34.9 seconds including runner startup), final
  pre-reconnect capture **11:03:49 UTC**.
- Real Bcrypt account login, map 1 / Ciudad de Ullathorpe, **five accepted walks
  and two authoritative collision corrections**, **30 seconds connected**.
- Position changed **(60,43) → (60,44)**; logout/login restored **(60,44)**.
  An independent PostgreSQL query after logout confirmed `pos_x=60, pos_y=44`.
- Both logins decoded UpdateExp (XP 0), displayed the exact welcome ConsoleMsg,
  and produced no protocol/page errors or failed asset requests.
- Desktop and resized 390px mobile screenshots inspected. A first run passed
  login/walking/30s but exposed an immediate resize-assertion race; the test now
  polls the same no-overflow condition. A second passing run ended its walk loop
  at the initial tile, so the final test requires a changed tile before checking
  reconnect persistence. No production UI or timeout was changed for this.

Reproduction: follow `tools/real-server/README.md`, build the client protocol,
run `mix run --no-start "$AO_CLIENT_ROOT/tools/real-server/classic_profile_test.exs"`
inside the prepared server, then run the opt-in Playwright real-server config.
Local evidence (ignored): `artifacts/server-attempts/adapter-{before,after}.log`,
`classic-adapter-live-{server,web,browser}.log`, and
`artifacts/screenshots/classic-real-community-{desktop.png,mobile.png,proof.json}`.
The task's server and preview remain available on loopback ports 17666/5191.
No credentials, artwork, database or compiled artifacts are committed.

## 2026-11-21, WP-A: the last three screens (frmGuildLeader, frmMain buttons, frmMapaGrande)

Spec = the pinned VB6 client 619e69d (the reference checkout is at b648c1a, 84 lines of frmMain later: use `git show 619e69d:CODIGO/<form>`).

- **frmGuildLeader: nothing to build.** The .frm has no control for `cmdElecciones_Click`, `Command7_Click` (peace list), `Command9_Click` (alliance list); frmGuildBrief
  has none for `Guerra_Click` / `Command1-3`. Those handlers are dead code. The server explains why: `HandleGuildPeacePropList`, `...AlliancePropList`, `...DeclareWar`,
  `...OfferPeace/Alliance` and `HandleGuildOpenElections` / `HandleGuildVote` only answer a LocaleMsg "Relaciones / Elecciones de clan desactivadas por el momento"
  (Msg1149-1151, Msg1172). Recorded against the live server: `tests/fixtures/vb6/guild/guild-leader-relations-disabled.jsonl` (`tools/real-server/record-guild-leader-lists.mjs`,
  leader Wintest of WinGuild, read-only requests plus two refusals on names that do not exist; GuildOpenElections is not sent). The only command the pinned
  client has for any of it is `/VOTO <nick>`, added to chat-input.ts.
- **frmMain, audited control by control** (pinned frmMain.frm vs apps/web): built btnTotalExp / btnExp / btnExp2 / btnExpRemaining with their four labels (`exp-display.ts`,
  UpdateExpBar captions, default `exp`), imgManual / imgMAO (MsgBox, then the page), CombateIcon / globalIcon (WriteMacroPos 239; ChatGlobal now filters FONTTYPE_GLOBAL and
  faction console lines, ChatCombate gates the meditation lines, both only once the server has sent BindKeys), Hogar (`/HOGAR`), Retos (`/RETAR`), imgBugReport (FrmGmAyuda).
  The settings button no longer also prints the old help lines. Not built, on purpose: buttonskins (frmSkins is class c), Label1 (frmBancoCuenta, class b), Image4(0) (minimise),
  PicCorreo / imgSwitchWorld (no handler in the form), and the `lblPorcLvl` / `exp` click toggle (only active with ButtonsExpBar = 0, which no pinned form writes).
- **frmMapaGrande**: the creature list, the four stat labels, the drop list with its picture and percentage, and the animated preview (tmrPreview, 120 ms, a quarter turn per
  18 ticks). **QuestNPCsMapData.bin is not what this form reads** (it is ListNPCMapData, the minimap's NPC dots): the list comes from the NPC section of the map's .csm
  (`parseMap().npcs`) and the stats from `init/sp_localindex.dat`. That file has no DropCount / Drop<n> / NroItems keys, so drops fall back to the server's `Dat/npcs.dat`
  NROITEMS rule (100 %). Gotcha: `assets.parseIni` folds a section header with a trailing comment (`[NPC560] 'Ogro`) into the previous NPC; `parseNpcSections` does not.
  The search box writes "name (n)" with a space, a click on the picture "name(n)" (both as in the form).
- Real-server checks (own account wpa@local.test / char Wpascreens, own bridge 7794, web 5794, `tools/wp-a-screens-shot.mjs`, `tools/wp-a-map-shot.mjs`): BindKeys 0x88 `0101`, MacroPos
  sends `ef00 0001` / `ef00 0000`, `/HOGAR` = 264, map 4 "Lobo Negro": HP 400, 20/35, EXP 220, drop "Piel de Lobo Negro" 100 %.

## 2026-11-21 maps fidelity (fix/maps-fidelity)

- Minimap, pinned VB6 (619e69d): the default `CenteredMinimap = 1` draws `interface/mapa1_200x200.bmp` / `mapa2_200x200.bmp` (ModMinimap.RenderMinimapCentered); world 3 has no file (`Case Else: minimapFile = ""` then `Exit Sub`, nothing drawn). Those two bitmaps exist in no public Recursos commit (tree and per-path history checked with `gh api`, nor in Recursos-prehoo), so the pinned client run on public data draws a blank minimap. Default here is now CenteredMinimap = 0 (the per-map 100x100 pictures, real data); the continuous mode stays behind the option, composed from those pictures at an assumed 200 px per cell.
- Mode 0 also paints the quest NPC markers (DibujarMiniMapa, `OUTPUT/QuestNPCsMapData.bin` = ListNPCMapData): 2x2 cyan (state 1) or yellow square with 8 grey pixels around. Was missing. `tools/local-assets.mjs` now serves that one file.
- frmMapaGrande already loaded the real `interface/mapa<world>.bmp` (513x594, 19x22 cells of 27 px). TotalWorlds = 3 (mapa1 continent, mapa2 dungeons, mapa3 the 2024 lands incl. Forgat); `ToggleDungeonView` only swaps worlds 1 and 2, so from world 3 the Dungeons check does nothing in VB6 as well. `mapsworlddata.dat` also holds a [WORLDMAP4] (14x18) that TotalWorlds = 3 ignores.
