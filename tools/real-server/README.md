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
converts CharacterCreate/Error/ConsoleMsg strings, reorders the twelve upstream intervals
into the sixteen classic fields, supplies neutral clan alignment and the full
logout byte, and maps the upstream zero map version to the actual map resource
ID. UpdateExp carries only current XP, as in VB6; next-level XP is a field of
UpdateUserStats. ConsoleMsg supplies the port's missing channel as
`TEXTCHANNEL_SYSTEM = 0`. The four unsupported extra timings and account-list
equipment are zero.
Unknown outgoing packets keep their body and can be skipped by frame length.
Unsupported incoming commands are rejected and the socket is closed.

This is the **login and walking subset**, not a claim of complete classic
combat/inventory/chat compatibility. With the flag absent, the upstream codec
remains in use. WebSocket gameplay handling is unchanged. Both listeners are
bound to loopback by `server.patch`; the Phoenix HTTP endpoint is disabled by
the launcher. Client protocol tables and the byte-transparent bridge are unchanged.

## Complete decoded-packet audit (PR #5)

The source of truth is the paired VB6 writer/handler at the revisions in
[PROTOCOL.md](../../docs/PROTOCOL.md), not the port's encoder comments.
`WriteUpdateExp` (`Protocol_Writes.bas:666`) writes ID 29 then **one Int32**;
`HandleUpdateExp` (`Protocol.bas:1375`) reads precisely that Int32. The complete
frame for XP 25 is `06 00 1d 00 19 00 00 00` (8 bytes including the envelope).
The port adds `next_xp`, producing a 12-byte frame with four trailing bytes.

`classic_profile_test.exs` tests all 21 emitted types that PR #5 decodes against
independent C++ fixtures in `packages/protocol/test/goldens.json`. A coverage
guard compares the client enum with the pinned upstream encoder's packet IDs.
The three decoded but never emitted types are explicitly checked as absent.
The same actual adapter frames pass through the production TypeScript decoder,
both coalesced and one byte at a time. Profile-off tests cover every upstream
command in the table. The adapter does not change the upstream encoder.

| ID | Packet | Golden body bytes (excludes 2-byte envelope) | Audit result |
| --- | --- | ---: | --- |
| 1 | Connected | 2 | Pass: empty non-debug body after ID |
| 2 | Logged | 3 | Pass: one-byte Boolean |
| 7 | Disconnect | 3 | Pass: existing full-logout Boolean conversion |
| 25 | UpdateSta | 4 | Pass: Int16 |
| 26 | UpdateMana | 4 | Pass: Int16 |
| 27 | UpdateHP | 8 | Pass: Int16 HP, Int32 shield |
| 28 | UpdateGold | 10 | Pass: two Int32s; unsupported gold cap is zero |
| 29 | UpdateExp | 6 | **Fixed:** omit port's second Int32 |
| 30 | ChangeMap | 6 | Pass: two Int16s; existing zero-version resource mapping |
| 31 | PosUpdate | 4 | Pass: x/y bytes |
| 37 | ConsoleMsg | 12 | **Fixed:** varint UTF-8 byte length, text, font, system channel |
| 42 | CharacterCreate | 81 | Pass: full VB6 sequence, converted strings and neutral clan alignment |
| 44 | CharacterMove | 6 | Pass: Int16 index, x/y bytes |
| 47 | UserCharIndexInServer | 4 | Pass: Int16 |
| 61 | UpdateUserStats | 36 | Pass: full VB6 sequence including next-level XP and current XP |
| 63 | ChangeInventorySlot | 18 | Pass: full sequence, float32 price, tags, Boolean flags |
| 64 | InventoryUnlockSlots | — | Not emitted by pinned port (classic payload is one byte) |
| 66 | ChangeSpellSlot | 8 | Pass: byte slot, Int16 spell/index, Boolean; empty index = -1 |
| 73 | ErrorMsg | 8 | Pass: existing String8 conversion |
| 78 | UpdateHungerAndThirst | 6 | Pass: four bytes in water/food order |
| 158 | Intervals | 66 | Pass: existing reorder and 16 Int32 fields |
| 186 | PosUpdateUserChar | — | Not emitted (classic x/y bytes, Int16 index) |
| 187 | PosUpdateChar | — | Not emitted (classic Int16 index, x/y bytes) |
| 199 | AccountCharacterList | 39 | Pass: count, two complete variable-integer/String8 records |

Before the fix: **19/21 rows passed**; UpdateExp and ConsoleMsg failed. After:
**21/21 rows, 29/29 ExUnit tests**, including signed Int32 XP limits, empty and
128-byte UTF-8 console messages, incoming framing, and unchanged native output.
Lengths above use the table's sample values; string-containing packets vary.
Unsupported gameplay packets outside this decoder overlap remain frame-skipped.

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
pnpm --filter @ao/protocol build # used by the adapter's cross-language check
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

On PR #5's `classic-ui` branch, mount the matching original local artwork and start
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
persistence at a position different from the starting tile (taking extra steps
if the initial loop returns to its origin). Traces are disabled so login
credentials are not captured.
It also checks UpdateExp on both logins, exact welcome-console text, and records
received packet IDs without saving raw frames or credentials. Evidence is saved
as `artifacts/screenshots/classic-real-community-{desktop.png,mobile.png,proof.json}`.
Normal `pnpm test:browser` remains a deterministic stand-in regression suite.

Local evidence is under `artifacts/server-attempts/` and `artifacts/screenshots/`
(gitignored, including the private `real-server.env`, mode 0600). No game artwork,
database, compiled executable or credential belongs in a commit.
