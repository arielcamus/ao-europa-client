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
