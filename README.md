# ao-client

Lightweight Argentum Online client: TypeScript + PixiJS, web first (desktop and mobile browsers), speaking the
ao-org classic protocol (PYMMO=0) through a small WebSocket-to-TCP bridge.

Licence: code AGPL-3.0 (parts translated from ao-org VB6 sources keep their notices). Game assets are CC BY-NC-ND
(Noland Studios): never committed, loaded from a local path (`AO_ASSETS`), conversion only.

M1 provides a protocol library, a headless TCP bot, a binary WebSocket bridge, and
a **TEST STAND-IN** server. The real target is the **ao-org classic VB6 server**.
No compiled VB6 server was available for this milestone, so live interoperability
with it remains untested. The stand-in is a deterministic fixture, not a game server.

Requires Node 24 and pnpm 12.21.0. From this repository:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm bot:standin
```

`bot:standin` builds the workspaces, starts the stand-in on a free loopback port,
runs the bot, and closes the server when the bot exits. It uses the test account
`standin@local` / `testpass` and the DEBUGGING Connected variant by default.
Expect about 32 seconds including compilation. The bot selects the first character,
waits for Logged and authoritative placement, sends five paced walks, and remains
connected for at least 30 seconds after Logged. Exit 0 requires at least one accepted
walk; earlier disconnection, malformed data, login failure, or all walks corrected
produces exit 1. Position queries prove acceptance; silence without a correction is
explicitly labelled as an inference and can be revoked by a later correction.

Tests use short library-only observation durations; the CLI has no option to shorten
its 30-second success condition. Tests bind ephemeral loopback ports.

```sh
# Plain Connected variant and deliberately rejected walks (expected exit 1):
AO_STANDIN_DEBUG=0 AO_STANDIN_REJECT_WALKS=1 pnpm bot:standin

# Run the stand-in by itself on 127.0.0.1:7666:
pnpm standin

# Connect the bot to an existing classic server/account:
AO_HOST=127.0.0.1 AO_PORT=7666 AO_EMAIL='existing-account' AO_PASSWORD='existing-password' pnpm bot

# Binary WebSocket on 127.0.0.1:7667, forwarding to TCP 127.0.0.1:7666:
pnpm bridge
```

Standalone stand-in settings: `AO_HOST`, `AO_PORT`, `AO_EMAIL`, `AO_PASSWORD`,
`AO_STANDIN_DEBUG=1`, `AO_STANDIN_REJECT_WALKS=1`. The fixture has one character,
one map, coordinates 1..100, and a 300ms walk interval. Accepted walks have no
self acknowledgement, matching the VB6 path; position request 79 returns packet 31.
There are no maps, assets, persistence, combat, NPC simulation, or production auth.

Bridge settings: `AO_WS_HOST`, `AO_WS_PORT`, `AO_TCP_HOST`, `AO_TCP_PORT`.
Only binary WebSocket messages are accepted (up to 1 MiB per message). AO frames
can span WebSocket messages or share one message. Bytes pass through unchanged;
the bridge does not parse or rewrite packet/frame headers. Both TCP connections
disable Nagle; backpressure and closure propagate between transports. Its only
runtime dependency is `ws`.

Workspace code:

- `packages/protocol`: dependency-free, browser-compatible Writer/Reader, frame
  accumulator, enums, typed packet codecs, C++-derived golden fixtures.
- `apps/bot`: raw TCP protocol probe; credentials are never included in its logs.
- `tools/standin-server`: explicitly labelled fixture using the same wire subset.
- `packages/bridge`: binary WebSocket ↔ TCP proxy.

`encodeClientPacket` / `encodeServerPacket` return message **bodies**.
`encodeClientFrame` / `encodeServerFrame` include the uint16LE length prefix.
Pass each body returned by `FrameDecoder.push(chunk)` to a packet decoder and call
`FrameDecoder.finish()` at EOF. Unknown complete frames return `{ unknown: true,
id, payload }`; malformed known packets throw with their ID.

See [the verified wire layouts](docs/PROTOCOL.md), [build log](docs/BUILD-LOG.md),
and [upstream notices](NOTICE). Source headers retain the AGPL/Apache notices.
