# AO Europa client

**A browser client for classic Argentum Online. Playable with no download, hosted for Europe.**
*Hecho en Europa.*

Home: [aoeuropa.com](https://aoeuropa.com)

## Why

Argentum Online is a game a lot of us grew up with, and Spain and Europe had their own servers for it once.
AO Europa is an attempt to bring that back as an open-source hobby project: a light client you open in a tab on a
laptop or a phone, talking the classic protocol. The full story is at [aoeuropa.com](https://aoeuropa.com).

## Status

- The **web client is open source and runs** from this repo.
- The **game server is not public yet**; it comes later. To actually connect today you need a classic AO server
  of your own. There is a built-in stand-in server for UI and protocol work with no server at all.
- Early and moving fast. Login, walking, inventory, spells and the classic 1024x768 interface are in; full
  gameplay parity with the original is not. See [docs/COVERAGE.md](docs/COVERAGE.md) for what is done.

## Quick start

Requires Node 24 and pnpm 12.21.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test   # code-only checks, no game assets needed
pnpm build
```

To see the client running you need the game artwork (see below), then:

```sh
# Against the built-in stand-in fixture (no real server needed):
AO_ASSETS=/path/to/Recursos pnpm dev:standin
# open http://127.0.0.1:5173 and press CONECTAR

# Against a classic AO TCP server:
AO_ASSETS=/path/to/Recursos AO_TCP_HOST=127.0.0.1 AO_TCP_PORT=7666 pnpm dev

# Production bundle served locally:
AO_ASSETS=/path/to/Recursos pnpm web:preview
```

### How it connects

The browser speaks WebSocket; classic AO servers speak TCP. A small bridge in `packages/bridge` forwards binary
WebSocket messages to the server's TCP port, unchanged. `tools/dev-web.mjs` starts the web server and the bridge
together and proxies `/bridge` through the page's own origin, so the client needs no server address of its own.

Point it at your server with environment variables:

| Variable | Meaning | Default |
| --- | --- | --- |
| `AO_TCP_HOST`, `AO_TCP_PORT` | classic AO server the bridge forwards to | `127.0.0.1`, `7666` |
| `AO_WEB_HOST`, `AO_WEB_PORT` | where the web client listens | `127.0.0.1`, `5173` |
| `AO_ALLOWED_HOSTS` | comma-separated extra hostnames allowed to open the dev server | none |
| `AO_ASSETS` | path to the game's `Recursos` directory | required |

The bridge also runs standalone with `pnpm bridge` (`AO_WS_HOST`, `AO_WS_PORT`, `AO_TCP_HOST`, `AO_TCP_PORT`).
For a phone on your local network, set `AO_WEB_HOST=0.0.0.0` and open `http://<your-LAN-IP>:5173`.
This is a development launcher, not a public hosting setup.

### Game assets

The game artwork is by Noland Studios under CC BY-NC-ND. It is **not in this repo** and never will be: you point
`AO_ASSETS` at your own copy (for example a checkout of [ao-org/Recursos](https://github.com/ao-org/Recursos)).
Details and limits in [docs/ASSETS.md](docs/ASSETS.md).

### Browser tests

```sh
pnpm exec playwright install webkit
AO_ASSETS=/path/to/Recursos pnpm test:browser
```

## Tech stack

- TypeScript, [PixiJS](https://pixijs.com) 8, [Vite](https://vite.dev); no UI framework
- pnpm workspaces: `apps/web` (the client), `apps/bot` (headless protocol bot), `packages/protocol`
  (dependency-free, browser-compatible packet codecs), `packages/bridge` (WebSocket to TCP proxy),
  `tools/standin-server` (test fixture)
- Vitest and Playwright for tests, ESLint, GitHub Actions CI

Protocol notes are in [docs/PROTOCOL.md](docs/PROTOCOL.md); the decision log is [docs/PROJECT.md](docs/PROJECT.md).

## Contributing

The point of opening this is that other people build on it. Former players, VB6 veterans, TypeScript people,
anyone who remembers how a hechizo should feel: issues and pull requests are welcome. Small PRs are easiest to
review. Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before opening one. If you are unsure whether
something fits, open an issue and ask first.

## License

Code is [AGPL-3.0-or-later](LICENSE). Parts translated from the ao-org VB6 sources keep their original notices;
see [NOTICE](NOTICE) and [docs/PROVENANCE.md](docs/PROVENANCE.md). Third-party assets keep their own licences
(CC BY-NC-ND artwork, loaded locally and never committed; fonts under their own terms in `LICENSES/`).

---

AO Europa is a fan project and is **not affiliated with the original Argentum Online authors** or with any
Argentum Online server. Argentum Online and its artwork belong to their respective owners.
[aoeuropa.com](https://aoeuropa.com) - Hecho en Europa.
