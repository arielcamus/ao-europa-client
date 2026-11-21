# ao-client

Lightweight Argentum Online client: TypeScript + PixiJS, web first (desktop and mobile browsers), speaking the
ao-org classic protocol (PYMMO=0) through a small WebSocket-to-TCP bridge.

Licence: code AGPL-3.0 (parts translated from ao-org VB6 sources keep their notices). Game assets are CC BY-NC-ND
(Noland Studios): never committed, loaded from a local path (`AO_ASSETS`), conversion only.

Start with the [project hub](docs/PROJECT.md) for goals, decisions, repository links,
current work and instructions for continuing with Codex. See also the [build log](docs/BUILD-LOG.md).

M1 provides a protocol library, a headless TCP bot, a binary WebSocket bridge, and
a **TEST STAND-IN** fixture. A real community AO server now runs natively on this
Mac: [lambdaclass/argentum](https://github.com/lambdaclass/argentum), with an opt-in
classic transport adapter. The bot passed 30 seconds and five accepted walks;
real collision, authentication and PostgreSQL persistence were checked too.
See [setup and scope](tools/real-server/README.md). Interoperability with the
original **ao-org VB6 executable** remains untested; no compiled binary was found.

M2 adds a browser client that renders local classic maps and an animated character
with keyboard/touch walking through the bridge. The `m2-browser` base was **verified
against the real community server**: 30 seconds connected, accepted movement, collision correction
and position persistence after reconnect. The original VB6 executable remains
unverified. Route attempts and evidence are in [the build log](docs/BUILD-LOG.md).

## Classic browser UI

`classic-ui` uses `m2-browser` as its base; the independent comparison with
`m2-render` is in [BUILD-LOG](docs/BUILD-LOG.md). The browser now uses the original
1024×768 VB6 interface, with its 736×608 world, 42-slot inventory, spells list,
console/chat, stats/menu panels and bitmap bars. Phones scale this entire layout
uniformly to fit; panels never rearrange. Positions come from `frmMain.frm` and
`FrmLogear.frm`, with runtime sizes checked against the classic source.

```sh
pnpm install --frozen-lockfile
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" pnpm dev:standin
# Open http://127.0.0.1:5173 and choose CONECTAR.

# Use a free port if 5173 is occupied:
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" AO_WEB_PORT=5187 pnpm dev:standin

# Point the same browser/bridge at an existing classic TCP server:
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" AO_TCP_HOST=127.0.0.1 AO_TCP_PORT=7666 pnpm dev

# Real local community server, after tools/real-server/README.md setup:
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" AO_TCP_PORT=17666 \
  AO_SERVER_PROFILE=elixir-classic AO_WEB_PORT=5191 pnpm dev

# Build and run the production bundle locally with the stand-in:
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" pnpm web:preview
```

Use arrows/WASD or touch the map in a direction from the character. Quick taps and held input work;
releasing, cancelling a touch, switching tabs or losing focus stops held movement.
The client picks the first account character, waits for server placement/intervals,
predicts one step, then requests the server position. Only a matching reply adds a
confirmed step. Rejections immediately restore server coordinates. Silence is a
timeout, never proof of a move. Credentials are not stored and the password input
is cleared when connecting. A disconnected session can be connected again.

Click Inventario/Hechizos to switch panels; Stats/Menú switches the original lower
panel. Click an item or the spell information control to read its local description.
Enter or the speech bubble opens chat; Enter sends, Escape closes. The console
renders server strings as text. Inventory, spells and bars consume verified classic
packets; unknown values remain blank/dashes. Casting: select a spell in the Hechizos
list and press Lanzar; the server answers with a target request
(the cursor changes), then click a tile (a tap on a phone) to cast, Escape cancels. Combat,
using and equipping items follow the same classic packets and the bound keys (Options > hotkeys).
The explicit stand-in supplies sample UI data and echoes
chat locally. The current `elixir-classic` adapter supports login/movement only, so
chat is disabled for that profile rather than sending an unsupported packet.

The launcher binds to loopback by default, starts the bridge on a free port, and
proxies `/bridge` through the web origin. For a phone on your **local network**, set
`AO_WEB_HOST=0.0.0.0` and open `http://<Mac-LAN-IP>:5173` on the phone; the WebSocket
uses that same origin automatically. This is a local development launcher, not a
public hosting setup. No native wrappers or cloud services are involved.

`AO_ASSETS` must point to an existing `Recursos` directory. Only numeric PNGs,
numbered CSM maps, four index files, `interface/*.bmp`, and `Dat/{Obj,Hechizos}.dat`
are served. Assets are neither
copied nor imported into the build; screenshots and build output are gitignored.
Code-only checkout/build/tests need no game assets. The browser runtime dependency
is PixiJS 8.23.0 plus the dependency-free protocol package; no UI framework.

Browser checks need the local resources, installed Google Chrome and Playwright
WebKit. They exercise the built app through the actual WebSocket→TCP→stand-in path:

```sh
pnpm exec playwright install webkit
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" pnpm test:browser
# If the client reference clone lives elsewhere, also set:
# AO_CLIENT_REFERENCE=/absolute/path/to/argentum-online-client-classic
pnpm size:web
```

Desktop Chrome, mobile Chrome and mobile WebKit each verify login, four directions,
30 seconds connected, confirmed coordinates, credential rejection and disconnect.
They also check original form geometry, inventory/spell switching and selection,
stat widths, literal chat text, and scaling at 390px. Reference screenshots are
assembled independently from the local `.frm` files and original bitmaps; they
are **not screenshots of a running VB6 executable**.
Screenshots are written to `artifacts/screenshots/classic-{desktop-chrome,mobile-chrome,mobile-webkit}.png`,
`classic-spells-*.png`, and `vb6-reference-{inventory,spells}-{desktop,native,390}.png`.
These are browser emulations on the Mac, not physical-phone testing.
The classic UI changes were verified with the stand-in; the opt-in community-server
test was adapted to the new controls but was not rerun in this session.

For a running real community server/preview on port 5191, supply the local
`AO_EMAIL`/`AO_PASSWORD` and run `pnpm test:browser:real`. This opt-in test requires
the `elixir-classic` profile, checks accepted and blocked movement, and reconnects
to verify persistence. It saves `classic-real-community-{desktop,mobile}.png` and a
credential-free proof JSON under `artifacts/screenshots/`. Its mobile image is
a responsive viewport check; the regression suite above tests touch emulation.

M2 supports four/five-layer CSM render prefixes, `graficos.ini`, `cabezas.ind` and
`cuerpos.dat`/`moldes.ini` character animations. It is a movement/rendering preview:
equipment rendering, NPC rendering, combat, map collision prediction, roof fading,
lighting, particles and full gameplay remain out of scope. The stand-in has no
collision rules. See [the asset contract and limitations](docs/ASSETS.md).

## Protocol and headless tools (M1)

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
