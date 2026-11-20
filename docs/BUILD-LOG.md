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

## 2026-11-20 M2 resource formats

- Worktree `~/Projects/ao-client-m2`, branch `m2-render`, initially clean. Read this
  log first; no applicable AGENTS.md found in the worktree or ancestor directories.
- WEB ONLY: Vite + TypeScript + Pixi, no UI framework or native packaging. Browser
  format code uses Uint8Array/DataView/TextDecoder, without Node dependencies.
- Paired source: client `b648c1a9b14903884393a7194e9faa0bc275633b`, Recursos
  `89615f34162d9fa0bf0fae4242cd6639edbf772f`. Retained AGPL attribution in ports
  and NOTICE. Assets and `docs/screenshots/` are ignored and never staged.
- `.csm`: signed LE counts; VB6 ANSI strings with uint16 lengths; packed records,
  no in-memory padding. Legacy four layers insert an empty layer 3; W5L2 uses
  five. Physical tail order is triggers, particles, lights, objects, NPCs, exits.
  Stored map bounds are all zero in map 1; runtime bounds are fixed at 1..100.
  Entry blocking uses destination bit `1 << (heading - 1)`, not `blocked != 0`.
- Real-data gotchas found by tests: map 1 has 1,419 undeclared trailing bytes.
  Preserve their count and ignore them like CargarMapa, rather than inventing
  records; validate recognized W2B1 tails and all declared records. Modern files
  reject unknown tails. Graphics index has sparse IDs and unused dangling/nested
  animation references: report IDs and fail only when such a frame is resolved.
- Body templates are rows SOUTH/NORTH/WEST/EAST, while protocol headings are
  NORTH/EAST/SOUTH/WEST. `cabezas.ind` has a 263-byte fixed header, uint16 count,
  and four int32 GRHs per head. Bodies resolve on demand without expanding all
  5,000 templates. Animation speed is total cycle duration, not frames per second.
- Tests independently assemble small in-memory excerpts from AO_ASSETS at runtime;
  no derived fixture bytes are saved. Asset tests skip when AO_ASSETS is absent.
- Commands (worktree root):

```sh
pnpm install
# Sandbox DNS failed; repeated with network escalation. pnpm 12 then required
# an explicit esbuild lifecycle allowlist (allowBuilds.esbuild: true).
pnpm install --offline
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos pnpm exec vitest run packages/formats/test/formats.test.ts
pnpm typecheck
```

- Formats: **9 tests passed** against the real files; typecheck passed. Web tooling
  installed for subsequent work: Vite 7.3.8, Pixi 8.23.0, puppeteer-core 24.43.1
  (dev-only, uses installed Chrome; no browser download). No optional package
  agent skills activated. Build setting documented at https://pnpm.io/settings/build.

## 2026-11-20 M2 real-map transport and prediction

- Followed the actual CargarRecursos entry point: it calls **LoadGrhIni**, not
  LoadGrhData. The older binary index lacks 47 GRHs used by map 1; implemented
  the active `graficos.ini` loader too. Repeated INI GRHs use the last definition,
  matching VB6; surplus static fields are ignored as in LoadGrhIni. The current
  INI resolves every frame of every map-1 animation with no missing references.
- Stand-in accepts an optional parsed resource world. Its account list, ChangeMap,
  CharacterCreate and corrections share the same map ID/spawn. Nearest completely
  unblocked ground to (50,50) is selected; map 1 uses (50,50). AO_ASSETS activates
  this in the standalone CLI. M1 fixture tests retain their empty coordinate box.
- New Node-only world adapter reads original CSMs, including case-insensitive
  filename lookup. Collision is exactly the directional blocked-bit subset;
  water/navigation, triggers, doors, NPCs and map exits are not game rules here.
- Browser GameClient uses native binary WebSocket + M1 FrameDecoder/codecs, the
  account → first character → Logged handshake, authoritative CharacterCreate
  placement, server intervals/speeding, and a separate map-resource-ready gate.
  Walk updates local coordinates synchronously after send. Packet 31 replaces
  speculative coordinates; it has no acknowledgement sequence, so no invented
  replay/ack semantics. Unknown complete frames skip; errors/EOF disable input.
  Reconnection resets counters and state; credentials never enter logs/storage.
- Commands:

```sh
pnpm install --offline
pnpm --filter @ao/formats --filter @ao/protocol --filter @ao/standin-server --filter @ao/bridge build
pnpm typecheck
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos pnpm exec vitest run tools/standin-server/test/world.test.ts
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos pnpm exec vitest run packages/formats/test/formats.test.ts
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos pnpm test
```

- Socket tests run with sandbox escalation (loopback otherwise gives EPERM).
  Real-map TCP test proves a blocked step corrects and a free step succeeds on
  the same counter stream. Browser session tests use Node's native WebSocket
  through the real bridge and stand-in: synchronous prediction, packet 31,
  resource gating, throttle, auth errors, reconnect, and upstream closure.
- At this checkpoint: **79 tests passed, 7 files**, including formats and the
  read-only asset middleware tests. Typecheck passed.

## 2026-11-20 M2 Pixi browser, touch and local tooling

- Added a framework-free Vite/TypeScript app. Explicit WebGLRenderer and a RAF
  loop avoid the Application/UI framework overhead. Runtime dependencies in the
  client are Pixi plus the two dependency-free workspace packages. Browser-only
  `apps/web/tsconfig.json` excludes Node ambient types; root typecheck runs both.
- Source order: ground layer 1 uncentered; centered walkable layers 2 and 3;
  characters and layer 4 in y/x order (character before same-tile layer 4);
  layer 5 roofs last. Body 1/head 1 use the real PNG frames and offsets, with
  heading-specific walk animation. **No character or map placeholder art.**
  Roofs can be manually hidden; automatic trigger-based fading is outside M2.
- Viewport culling uses full artwork bounds, so tall trees anchored outside the
  visible tile rectangle still appear. Only visible animation atlases and the
  character are requested, with four concurrent PNG decodes. Camera follows each
  predicted/corrected tile; ResizeObserver and devicePixelRatio resize the canvas.
  Map movement is tile-stepped. Equipment, NPCs/objects, lights, shadows, particles
  and audio are outside this renderer's scope.
- Input supports arrows/WASD, held touch d-pad and drag. Pointer capture/release,
  cancel, blur and hidden-document handlers clear movement. The phone viewport
  uses dynamic viewport height, safe areas, 48px touch buttons (44px in landscape),
  and no fixed desktop-width layout. Entering the game moves keyboard focus out
  of the login form.
- Vite serves AO_ASSETS read-only at `/assets` from the original files, with
  path allowlisting, case-insensitive resource filenames, realpath confinement,
  no listing or writes. `publicDir: false`; compiled JS/CSS live in `dist/static`.
  No original or converted artwork enters dist. PNG opaque-black colorkey
  conversion matches the uncompressed clsTexManager loader and is memory-only.
- Gotcha from Chrome: 11 map-1 frames extend below the 512px atlas 5068.png.
  Preserve their original UVs and use repeat addressing instead of rejecting or
  altering artwork. This is inferred from classic Direct3D's default wrap state
  and the absence of an address-state override in the VB6 renderer; exact DX8
  pixel parity is **unverified**. Reference for the related Direct3D sampler
  default: https://learn.microsoft.com/windows/win32/direct3d9/d3dsamplerstatetype.
- Visual review caught a mobile error missed by the first smoke-script assertion:
  RAF's sampled timestamp can precede an input event's animation-start timestamp.
  Clamped elapsed animation time at zero to prevent frame -1. The script now
  requires the app to still be ready before either final screenshot, as well as
  checking browser errors and HTTP failures. Retested successfully afterward.
- `dev:web` owns stand-in, bridge and Vite in one process. Local assets default
  to `~/Projects/ao-reference/Recursos`; AO_ASSETS overrides. Internal listeners
  use ephemeral loopback ports; same-origin `/bridge` proxy also works for LAN
  phones via AO_WEB_HOST. `preview:web` serves the production build locally with
  the same external assets. `build:web` builds and sums level-9 gzip JS+CSS across
  **all** chunks (including optional Pixi environment chunks), excluding artwork.
- Headless screenshots use only dev dependency puppeteer-core and installed
  `/Applications/Google Chrome.app`, with ephemeral profiles. No chrome-cdp skill
  or downloaded browser used. Art-bearing screenshots are ignored, never staged.
- Commands (all from worktree root; network/socket/Chrome escalation as needed):

```sh
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos pnpm dev:web
pnpm build:web
pnpm typecheck
pnpm screenshot:web
pnpm install --frozen-lockfile --offline
# Offline frozen verification lacked cached chromium-bidi metadata; online succeeds:
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos AO_WEB_PORT=5174 pnpm preview:web
AO_WEB_URL=http://127.0.0.1:5174 pnpm screenshot:web
pnpm test
AO_ASSETS=/Users/dev/Projects/ao-reference/Recursos pnpm test
pnpm size:web
git diff --check
git ls-files --stage docs/screenshots assets
git check-ignore docs/screenshots/m2-desktop.png docs/screenshots/m2-mobile.png
```

- Final browser run at this checkpoint: Chrome **157.0.8103.79**, production build.
  Desktop 1440×900: west wall corrected to (50,50), D accepted to (51,50), A returned
  to (50,50): 3 walks / 1 correction. Mobile 390×844: real touch tap then drag to
  (51,51): 2 walks / 0 corrections, release stops movement. Rotated to 844×390 at
  DPR 2: canvas width 1,688 for 844 CSS pixels; restored portrait without reload,
  horizontal overflow or browser/asset errors. Both final images visually reviewed.
- Tests: **71 passed + 8 expected local-asset skips** without AO_ASSETS;
  **79 passed in 7 files** with it. Root + browser typechecks and all six workspace
  builds passed. Frozen install passed. No assets/screenshots tracked by git.
- Bundle: **419,761 bytes raw / 120,940 bytes gzip (118.11 KiB)** for four JS/CSS
  files, excluding assets and HTML. Vite's per-file default gzip display differs
  slightly from the report's explicit level 9. No source maps in the production build.
- Limitations: no compiled VB6 server available, so real-server login remains
  unverified. Headless mobile Chrome emulates touch/viewport, not a physical iOS
  or Android device. Native renderer pixel parity (including UV wrap and lighting)
  is not claimed. Stand-in rules cover only map bounds, CSM blocks and walk timing.

## 2026-11-20 M2 final handoff

- Local feature commits on `m2-render`: `0219ba9` (formats), `658e77a` (real-map
  stand-in/browser transport), `40ec5c2` (rendering, touch and tooling). No push or PR.
- Inspected the final production screenshots, including PNG dimensions:
  `/Users/dev/Projects/ao-client-m2/docs/screenshots/m2-desktop.png`
  is 1440×900 (2,070,257 bytes);
  `/Users/dev/Projects/ao-client-m2/docs/screenshots/m2-mobile.png`
  is 390×844 (519,920 bytes). Both show Connected and original character art.
- `git ls-files --stage docs/screenshots assets` returned no tracked files;
  `git status --ignored --short docs/screenshots` showed `!! docs/screenshots/`.
  Production dist contains only index.html and four JS/CSS files in static/.
- Stopped only this task's two identified Node listener processes with
  `kill -INT 14244 79053`; both `dev:web` and `preview:web` sessions exited **0**,
  confirming shutdown cleanup. Other pre-existing Chrome/server processes were
  left alone. To run the finished client again: `pnpm dev:web`.
