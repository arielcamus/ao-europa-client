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
