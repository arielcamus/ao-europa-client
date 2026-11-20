# Real local AO community server

Verified on the M1 Mac on 2026-11-20. This runs the actual
[lambdaclass/argentum](https://github.com/lambdaclass/argentum) Elixir/Rust server
at commit `1699a662e6352bfcc9ea5905c6d6f2c0157cb1e7` (Apache-2.0). Its own account,
session, map, NPC, collision and PostgreSQL persistence code executes. No
stand-in is involved. The original ao-org VB6 executable has **not** been built
or verified; the investigation is in [BUILD-LOG](../../docs/BUILD-LOG.md).

## Adapter scope

`AO_PROTOCOL_PROFILE=classic` enables the TCP adapter in `classic_profile.ex`.
The port originally uses unframed int16 IDs, int16 string lengths and session
tokens. The adapter accepts M1's uint16-framed account login (305), character
selection (73), walk (78), and position query (79). Passwords are checked with
the server's existing Bcrypt account code; character ownership is checked
before invoking the normal token/session login. Movement, timing, anti-replay,
collision, map entry and logout persistence remain the server's responsibility.

Outgoing packets retain their IDs. The adapter frames each packet at the final
TCP write boundary, after the server's existing priority/coalescing code. It
converts CharacterCreate/Error strings, reorders the twelve upstream intervals
into the sixteen classic fields, supplies neutral clan alignment and the full
logout byte, and maps the upstream zero map version to the actual map resource
ID. The four unsupported extra timings and account-list equipment are zero.
Unknown outgoing packets keep their body and can be skipped by frame length.
Unsupported incoming commands are rejected and the socket is closed.

This is the **login and walking subset**, not a claim of complete classic
combat/inventory/chat compatibility. With the flag absent, the upstream codec
remains in use. WebSocket gameplay handling is unchanged. Both listeners are
bound to loopback by `server.patch`; the Phoenix HTTP endpoint is disabled by
the launcher. Client protocol tables and the byte-transparent bridge are unchanged.

## Reproduce on macOS

Install the free native tools and clone only the official server source:

```sh
brew install elixir rust postgresql@16
git clone https://github.com/lambdaclass/argentum.git ../ao-reference/argentum-elixir
git -C ../ao-reference/argentum-elixir checkout 1699a662e6352bfcc9ea5905c6d6f2c0157cb1e7
bash tools/real-server/prepare.sh ../ao-reference/argentum-elixir
```

The preparation command verifies the exact revision before applying the small
gateway patch and copying the adapter. It is safe to repeat and stops on patch
conflicts. It does not edit game logic or the dependency lockfile.

Create a dedicated local database cluster once (the path must not already contain
another cluster). Trust authentication is limited to this local development
cluster, listening on `127.0.0.1:55432`:

```sh
AO_PG_BIN="$(brew --prefix postgresql@16)/bin"
AO_PG_DATA="$PWD/../ao-reference/runtime/ao-postgres"
"$AO_PG_BIN/initdb" -D "$AO_PG_DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C
"$AO_PG_BIN/pg_ctl" -D "$AO_PG_DATA" -l "$AO_PG_DATA/server.log" \
  -o '-h 127.0.0.1 -p 55432 -k /private/tmp' start
```

Compile, check the independent C++ packet fixtures, and launch:

```sh
export AO_CLIENT_ROOT="$PWD"
cd ../ao-reference/argentum-elixir/server
mix local.hex --force
mix local.rebar --force
mix deps.get
mix compile
mix run --no-start "$AO_CLIENT_ROOT/tools/real-server/classic_profile_test.exs"
export AO_PROTOCOL_PROFILE=classic AO_PORT=17666 AO_DB_PORT=55432
export AO_EMAIL='aoverify@local'
# Supply AO_PASSWORD securely in this shell, then:
mix run --no-start "$AO_CLIENT_ROOT/tools/real-server/run.exs"
```

The launcher creates/migrates `ao_client_real`, starts the backend before the
world, and creates a password-hashed account plus a normal warrior named
`Macwalker` if that account has no character. Subsequent starts verify the same
password and preserve character state. It uses upstream lazy map boot; initial
map-pack verification can take about a minute. Wait for `REAL AO COMMUNITY SERVER`.
Verified tools: Elixir 1.20.5 / OTP 29, Rust 1.100.0, PostgreSQL 16.

## Verify clients

In another shell at this repository, with the same account environment:

```sh
pnpm install --frozen-lockfile
pnpm build
AO_PORT=17666 node apps/bot/dist/cli.js
AO_PORT=17666 node tools/real-server/probe.mjs
```

The bot requires 30 seconds and accepted movement. The extra probe verifies
unauthenticated login, bad password, unowned character and duplicate walk
counters are rejected. It walks north until the map blocks a step, returns by
the same path, then tests replay disconnection. Use the supplied Ullathorpe test
character, without another client simultaneously logged into that account.

On the `m2-browser` branch, mount the matching original local artwork and start
the unchanged byte bridge to this real TCP server:

```sh
AO_ASSETS=/absolute/path/to/Recursos AO_TCP_PORT=17666 \
  AO_WEB_PORT=5191 AO_SERVER_PROFILE=elixir-classic node tools/dev-web.mjs --preview
# Separate shell, same AO_EMAIL/AO_PASSWORD:
pnpm exec playwright test --config playwright.real.config.ts
```

Run `pnpm build` on that branch first. The UI profile labels the selected server;
it does not change wire bytes or automatically attest an arbitrary endpoint.
The opt-in browser test requires that profile, attempts five walks, requires
accepted movement and verifies rollback for any blocked step. It stays connected
for 30 seconds, saves desktop/mobile screenshots, and reconnects to check
persistence. Traces are disabled so login credentials are not captured.
Normal `pnpm test:browser` remains a deterministic stand-in regression suite.

Local evidence is under `artifacts/server-attempts/` and `artifacts/screenshots/`
(gitignored, including the private `real-server.env`, mode 0600). No game artwork,
database, compiled executable or credential belongs in a commit.
