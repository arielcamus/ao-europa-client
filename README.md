# ao-client

Lightweight Argentum Online client: TypeScript + PixiJS, web only (desktop and mobile browsers), speaking the
ao-org classic protocol (PYMMO=0) through a small WebSocket-to-TCP bridge.

Licence: code AGPL-3.0-or-later (parts translated from ao-org VB6 sources keep their notices). Game assets are CC BY-NC-ND
(Noland Studios): never committed, loaded from a local path (`AO_ASSETS`), conversion only.

M1 provides a protocol library, a headless TCP bot, a binary WebSocket bridge, and
a **TEST STAND-IN** server. The real target is the **ao-org classic VB6 server**.
No compiled VB6 server was available for this milestone, so live interoperability
with it remains untested. The stand-in is a deterministic fixture, not a game server.

Requires Node 24 and pnpm 12.21.0. From this repository:

## M2 browser client

```sh
pnpm install --frozen-lockfile
export AO_ASSETS="$HOME/Projects/ao-reference/Recursos"
pnpm dev:web
```

Open `http://127.0.0.1:5173` and select **Enter world**. The local test credentials
are prefilled (`standin@local` / `testpass`). This starts the stand-in with real
map 1 (Ciudad de Ullathorpe), a binary WebSocket bridge, and Vite in one process.
The TCP and bridge listeners use free loopback ports; Vite proxies `/bridge`, so
phones connect to the same host as the page. Ctrl-C closes all three listeners.

Use **WASD / arrows**, the **touch d-pad**, or **drag the canvas** to walk. Releasing
touch, cancelling a pointer, changing tabs or losing focus stops input. Steps are
predicted on send; blocked steps are corrected by packet 31. Use the view controls
to zoom or hide roofs. All five map layers and the original body/head frames render;
there is no placeholder character. The camera follows the player and the canvas
tracks its element size and devicePixelRatio. No UI framework or Node APIs are
used in browser code; a separate browser TypeScript check enforces that boundary.

`AO_ASSETS` defaults to `~/Projects/ao-reference/Recursos` for local dev/preview.
Files stay in place and are served read-only at `/assets` (GET/HEAD, no directory
listing, traversal or escaping symlinks). The browser reads `Mapas/mapaN.csm`,
`init/graficos.ini`, `cuerpos.dat`, `moldes.ini`, `cabezas.ind`, and original PNGs
from `Graficos`. PNG alpha/legacy opaque-black colorkey and texture rectangles are
converted only in memory. No artwork is edited, copied into `dist`, or committed.

```sh
# Optional map and LAN access for a physical phone on your network:
AO_MAP_ID=1 AO_WEB_HOST=0.0.0.0 pnpm dev:web
# Open http://<this-Mac-LAN-IP>:5173 on the phone.

pnpm build:web       # production app + total gzip size of every JS/CSS chunk
pnpm size:web        # report the existing build again; excludes game assets
pnpm preview:web    # local production build + stand-in/bridge + read-only assets
pnpm typecheck
AO_ASSETS="$HOME/Projects/ao-reference/Recursos" pnpm test
pnpm screenshot:web # while dev:web or preview:web is running
```

`AO_WEB_PORT` changes the web port. `AO_STANDIN_REJECT_WALKS=1` exercises correction
on every step, and `AO_VERBOSE=1` prints stand-in packet activity. Builds do not
require AO_ASSETS; asset-backed tests generate excerpts in memory and skip if the
variable or map 1 is absent. Screenshots are saved to ignored
`docs/screenshots/m2-desktop.png` (1440×900) and `m2-mobile.png` (390×844).
The smoke script uses dev-only puppeteer-core and installed
`/Applications/Google Chrome.app`; `AO_CHROME` and `AO_WEB_URL` can override those.
It checks real keyboard input, a wall correction, touch tap/drag and release,
portrait/landscape resizing, DPR 2, and browser/asset errors before capturing.

To target a separately running server, start `AO_TCP_HOST=... AO_TCP_PORT=... pnpm bridge`
and `pnpm --filter @ao/web dev` in separate terminals. Vite defaults to forwarding
`/bridge` to `ws://127.0.0.1:7667`; `AO_BRIDGE_TARGET` overrides that target. Enter
the server account in the form. The connection settings also accept a direct
`ws://` or `wss://` bridge URL. Production hosting must provide `/assets` and a
WebSocket bridge separately; the build contains no licensed resources.

M2 limits: the stand-in implements CSM directional blocked tiles, not water,
navigation, doors, NPCs, persistence or map transitions. The renderer covers map
layers and the player, not object/NPC simulation, equipment, lighting, particles,
audio or automatic roof fading. Roof visibility is manual. The legacy graphics
binary parser is retained, but the active INI is required for current map artwork.
Real compiled VB6 server compatibility, exact native-renderer pixel parity, and
physical iOS/Android browsers remain unverified; desktop/mobile Chrome is tested.

## M1 protocol tools

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
With `AO_ASSETS` set, it reads a real CSM (`AO_MAP_ID`, default 1) and uses its
blocked tiles; otherwise it keeps the M1 empty coordinate box. There is no
persistence, combat, NPC simulation, or production auth.

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
- `packages/formats`: browser-compatible CSM, GRH/index and character template parsers.
- `apps/web`: Vite + Pixi browser client, keyboard/touch controls and local asset middleware.
- `tools/standin-server`: explicitly labelled fixture using the same wire subset.
- `packages/bridge`: binary WebSocket ↔ TCP proxy.

`encodeClientPacket` / `encodeServerPacket` return message **bodies**.
`encodeClientFrame` / `encodeServerFrame` include the uint16LE length prefix.
Pass each body returned by `FrameDecoder.push(chunk)` to a packet decoder and call
`FrameDecoder.finish()` at EOF. Unknown complete frames return `{ unknown: true,
id, payload }`; malformed known packets throw with their ID.

See [the verified wire layouts](docs/PROTOCOL.md), [build log](docs/BUILD-LOG.md),
and [upstream notices](NOTICE). Source headers retain the AGPL/Apache notices.
