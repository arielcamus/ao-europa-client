# Argentum Online project hub

- Relaunch AOSpain for Spanish and European players as an open-source hobby project, not a business.
- Build a lightweight browser client in TypeScript and PixiJS, reproducing the original VB6 interface first.
- Use Ariel's lambdaclass server fork, subject to the gameplay gate; keep the classic wire protocol.
- Login and walking pass against the stand-in and lambdaclass; full gameplay and the VB6 oracle remain pending.
- Continue from this hub, the relevant branch's BUILD-LOG, and the parity report; use small PRs with independent review.

Decisions: **Ariel, 20 November 2026**. Status is a snapshot of that day's ongoing work; refresh the PRs and working trees before starting.

## Goal

This is **not a business**. Ariel wants to relaunch **AOSpain**, the Spanish Argentum Online server that existed in **2003–05**, for Spanish and European players, then add new content. Release all project code, tools and documentation as open source. The repositories are private during development; making them public is a later launch step.

Monetisation should only cover running costs, with hosting estimated at **EUR 10–40/month**. The conservative, safe working reading of the art licence is voluntary donations and supporter badges **without any in-game advantage**. This is a project constraint, not a blanket licence clearance for monetisation: CC BY-NC-ND defines noncommercial use by purpose, and cost recovery alone does not decide that question. Preserve attribution and the existing artwork; check any proposed monetisation against [Noland's terms](https://github.com/ao-org/Recursos/blob/master/license.txt) and the [CC BY-NC-ND 4.0 licence](https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.en).

Third-party artwork keeps its existing licence; it cannot be relicensed as project code. Load assets from local resources and never add them to project commits. New content must respect those boundaries.

## Decisions and why

All decisions below are from **20 November** and take precedence over earlier research recommendations.

| Decision | Why / boundary |
| --- | --- |
| **Web-only client first**, desktop and mobile browsers; no Capacitor or Tauri now. | One delivery path and less packaging work. Keep later wrappers possible without building them now. |
| **TypeScript + PixiJS**, lightweight, no UI framework required. | Fits the sprite renderer and browser delivery. Report total JavaScript bundle size, including lazy chunks, separately from artwork. |
| **Reproduce the VB6 client's classic UI exactly**, using its original interface graphics. | Minimise design and implementation work; compare matching screens against the original. Include the main frame, inventory, spell list, console and their layout. Scale the classic layout on phones; modernise later. |
| **AO Forever is technical proof only. Never use it as a visual reference.** | It demonstrates a browser client over WebSocket. Its UI, packet numbering and server lineage are not the target. |
| **Fork `lambdaclass/argentum`**, Elixir with Rust components, declared Apache-2.0; close gaps using VB6 as the feature specification. | Reuse substantial working server logic. The parity report estimates **60% ±15 percentage points of gameplay**, not release readiness or wire compatibility. Investment beyond the prototype depends on the gameplay gate. Preserve source provenance and licences when porting VB6 logic. |
| **Keep the CLASSIC protocol (`PYMMO=0`) for now.** | Reuse the protocol library, bot and bridge, and retain a common boundary for the original server and differential tests. Upstream lambdaclass needs an explicit adapter. |
| **Compile the original VB6 server once with twinBASIC Community in a Windows VM, then keep it running as an ORACLE.** | Compare real behavior, packets and state while evolving the Elixir server. Ariel manually clicks Build in the IDE: Community [does not permit automated/CI builds](https://twinbasic.com/licensing). Avoid paid twinBASIC and VB6 licences. This is the intended baseline, **not a completed compile**. |
| **Codex builds; Brian (Claude) orchestrates and reviews when available. Every PR gets an independent review.** | Keep implementation and review separate. If Brian is unavailable, Ariel can continue directly with Codex and obtain a separate review before merging. |

The earlier native-first/Godot and C# rewrite recommendations in the research archive are historical options, not the current plan. The manual Community build also supersedes the earlier request for an unattended VM compiler workflow.

## Repositories and architecture

| Repository | Role | Licence / local location |
| --- | --- | --- |
| [arielcamus/ao-client](https://github.com/arielcamus/ao-client) | Project hub, browser client, protocol library, bot, stand-in, WebSocket–TCP bridge, VM scripts and docs. Implementation is still on feature branches. | AGPL-3.0, with translated source notices retained; `~/Projects/ao-client`. |
| [arielcamus/argentum-server](https://github.com/arielcamus/argentum-server) | **Existing** private working fork, stored as a standalone repository preserving upstream history. Gameplay-gate work is on `fix/browser-session-secret`. | Declared Apache-2.0 upstream code; `~/Projects/argentum-server`. `origin` points here and `upstream` points to lambdaclass. Classic-adapter integration into this fork remains pending. |
| [lambdaclass/argentum](https://github.com/lambdaclass/argentum) | Upstream Elixir server and its own clients; reuse server behavior. | Apache-2.0 code. Verified local classic-adapter runtime: `~/Projects/ao-reference/argentum-elixir`. |
| [ao-org/argentum-online-client-classic](https://github.com/ao-org/argentum-online-client-classic) | VB6 visual, input, packet and resource-format specification. | AGPL-3.0; source headers include “or later”. Local reference directory has the same repository name. |
| [ao-org/argentum-online-server-classic](https://github.com/ao-org/argentum-online-server-classic) | VB6 gameplay specification and future running oracle. | AGPL-3.0; source headers include “or later”. Local reference directory has the same repository name. |
| [ao-org/Recursos](https://github.com/ao-org/Recursos) | Original graphics, interface, maps, sounds and indexes. | **CC BY-NC-ND 4.0, Noland Studios**, with separate terms for third-party resources; `~/Projects/ao-reference/Recursos`. |
| [ao-org/Aurora.Network](https://github.com/ao-org/Aurora.Network) | C++ transport/serialization reference, including VB6 COM conversion. | Apache-2.0; `~/Projects/ao-reference/Aurora.Network`. |
| [ao-org/ao20-shared-types](https://github.com/ao-org/ao20-shared-types) | Account/API types, **not** the gameplay protocol. | **Proprietary: do not reuse**; read-only reference at `~/Projects/ao-reference/ao20-shared-types`. |

Stable reference clones live under **`~/Projects/ao-reference/`**. The abbreviated `server-classic` and `client-classic` names in early [BUILD-LOG](BUILD-LOG.md) entries mean `argentum-online-server-classic` and `argentum-online-client-classic`.

Original research scratchpad, still present locally:

```text
/private/tmp/claude-501/-Users-arielcamus-Projects-second-brain/f0889fd4-00d3-4d91-955c-86101e8fbc5e/scratchpad/
  ao-client-port-assess/   original reference clones
  ao-port-assess/          earlier assessment
  codex-server-final.md    detailed static server assessment
/private/tmp/argentum-parity-20261120-085150/
  audit.py, audit.json, packets.tsv, groups.json, runtime-server/
```

Prefer the stable clones over scratch copies. `/private/tmp` evidence can disappear; preserve useful findings in docs, with no credentials, assets or personal data. The detailed runtime history is in the [M2 branch BUILD-LOG](https://github.com/arielcamus/ao-client/blob/m2-browser/docs/BUILD-LOG.md); main's log currently contains only setup and the classic-UI decision.

Reference pins used in the research and M1/M2 proof:

| Source | Revision |
| --- | --- |
| Classic server | `caac31333f7cefdbe2b7771cf309e555b33a563e` |
| Classic client | `b648c1a9b14903884393a7194e9faa0bc275633b` |
| Recursos | `89615f34162d9fa0bf0fae4242cd6639edbf772f` |
| lambdaclass | `1699a662e6352bfcc9ea5905c6d6f2c0157cb1e7` |

```text
Local Recursos --HTTP via local asset loader--> Browser (TypeScript + PixiJS)
                                                   |
                                             binary WebSocket
                                                   |
                                           WebSocket–TCP bridge
                                                   |
                          TCP CLASSIC: uint16 LE length + int16 LE packet ID
                          PYMMO=0; length excludes its own two bytes
                                                   |
                         +-------------------------+------------------------+
                         |                         |                        |
                    VB6 server              lambdaclass classic       TEST STAND-IN
                    Windows VM              adapter -> Elixir        transport fixture
                    future ORACLE           -> PostgreSQL            no game rules

Headless bot -------------------- TCP CLASSIC ------^
```

Choose one TCP backend per session. The bridge forwards bytes unchanged; it does not translate packet layouts. WebSocket messages and TCP reads need not align with AO frames. Assets are served from `AO_ASSETS`, never imported into the client bundle or added to commits. The lambdaclass snapshot already inherits tracked resources from upstream; those need a provenance/distribution review before public release and are not permission to add further artwork.

The classic adapter currently accepts only account login **305**, character selection **73**, walk **78** and position query **79**. A working native lambdaclass gameplay flow does not yet prove the same flow through this adapter.

## Status

| Workstream | Status on 20 November |
| --- | --- |
| **M1: protocol + bot** | **PASS against the stand-in and the real lambdaclass server with classic adapter**: at least 30 seconds connected and accepted walks; real collision, rejected authentication, replay checks and position persistence were exercised. Recorded regression result: 64 tests passed. This is not a pass against a compiled VB6 server. |
| **M2: browser rendering** | `m2-browser` ([PR #2](https://github.com/arielcamus/ao-client/pull/2)) and `m2-render` are both present. The latest local classic-UI log chooses **`m2-browser@01b5415`** as its base for session correctness and browser coverage; `m2-render@39f6266` remains an alternative, not merged or discarded. M2 records 77 unit/transport tests, six browser tests and a real-server walk/reconnect pass. |
| **Classic UI** | **In progress.** Local `classic-ui` branch exists from M2; current interface changes are still uncommitted in the shared checkout. Check the working tree and owner before resuming. No classic-UI PR was open at this snapshot. |
| **VM / original server** | **In progress, blocked before Windows installation**, `vm-server`, [PR #3](https://github.com/arielcamus/ao-client/pull/3). The latest local `docs/VM-BUILD-HANDOFF.md` reports UTM installed and the VM bundle staged, but no imported/booted guest. Official ARM64 installation media and working UTM access remain unresolved. No successful original-VB6 compile or oracle test is recorded. |
| **lambdaclass gameplay gate** | **In progress; initial result is NO-GO**, in `~/Projects/argentum-server`, branch `fix/browser-session-secret`, commit `20777fb9`, [server PR #1](https://github.com/arielcamus/argentum-server/pull/1) (draft). The [gate handoff](https://github.com/arielcamus/argentum-server/blob/20777fb9a5b55ffb9f12db06bf808b43e34513dd/docs/GAMEPLAY-GATE-2026-11-20.md) records login fixed, pickup/combat/spell/shop/chat working, but equipment selection and reconnect persistence failing. This is not a green release gate. |

The gate handoff identifies an inventory slot off-by-one at the client/server boundary and a skill-key SQL conversion error that rolls back saves. It also confirms missing faction ranks/rewards and quest persistence. Fix the bounded blockers and rerun the gate before expanding M2; this is not a decision to discard the Elixir base. The native-client gate is separate from M1's earlier classic-adapter position-persistence proof, which used a different account/fixture.

PR snapshot checked with `gh pr list -R arielcamus/ao-client --state all --limit 100` on 20 November, immediately before the hub merge:

- [#1 — M1: classic protocol, bot and verified community server](https://github.com/arielcamus/ao-client/pull/1): draft, `m1-protocol` → `main`; protocol/bot/bridge and real community-server proof.
- [#2 — M2: browser walking verified against real AO community server](https://github.com/arielcamus/ao-client/pull/2): draft, `m2-browser` → `m1-protocol`; browser rendering and movement proof.
- [#3 — Document VM server build blocked by twinBASIC licensing](https://github.com/arielcamus/ao-client/pull/3): draft, `vm-server` → `m2-browser`; VM work, with the published blocker predating the manual-build decision.
- [#4 — Project hub and research archive](https://github.com/arielcamus/ao-client/pull/4): `docs-project-hub` → `main`; this documentation-only handoff, separate from the implementation PRs.

Implementation PRs #1–#3 are stacked. Do not merge or retarget another workstream casually. **Main currently has documentation and licence files, not the runnable M1/M2 packages.** Merging this hub does not merge their implementation.

## How to run each piece

### Get a runnable checkout

Use Node **24** and pnpm **12.21.0**. Inspect existing work before choosing a checkout:

```sh
git -C "$HOME/Projects/ao-client" status --short
git -C "$HOME/Projects/ao-client" worktree list
gh pr list -R arielcamus/ao-client --state all --limit 100
```

For the currently published M1/M2 implementation, create a separate worktree with unused names; do not switch or reset the occupied checkout:

```sh
git -C "$HOME/Projects/ao-client" fetch origin
git -C "$HOME/Projects/ao-client" worktree add -b codex/next-ao \
  "$HOME/Projects/ao-client-codex" origin/m2-browser
cd "$HOME/Projects/ao-client-codex"
pnpm install --frozen-lockfile
```

The commands below run from that implementation checkout. For classic-UI work, first coordinate with its current owner and use its committed branch when available. Recheck these prerequisites after the implementation PRs reach main.

### Browser client

```sh
export AO_ASSETS="$HOME/Projects/ao-reference/Recursos"

# Local map/render/movement preview with the explicitly labelled test fixture:
AO_WEB_PORT=5187 pnpm dev:standin
# Open http://127.0.0.1:5187/

# Alternatively, against the running real lambdaclass classic adapter:
AO_TCP_HOST=127.0.0.1 AO_TCP_PORT=17666 AO_SERVER_PROFILE=elixir-classic \
  AO_WEB_PORT=5191 pnpm dev
# Open http://127.0.0.1:5191/
```

Run one launcher per terminal. Each starts its own bridge on a free port and proxies `/bridge`; a separate `pnpm bridge` is unnecessary for these launchers. Use an unused web port if another session is running. `pnpm dev` requires a real TCP backend and does not silently start the stand-in.

### Bot, stand-in and standalone bridge

```sh
# Self-contained 30-second bot proof; starts and stops its own stand-in:
pnpm bot:standin

# Standalone test fixture, TCP 127.0.0.1:7666:
pnpm standin

# Separate terminal: set AO_EMAIL and AO_PASSWORD privately for this account.
AO_HOST=127.0.0.1 AO_PORT=17666 pnpm bot

# Standalone binary WebSocket 7667 -> TCP 7666:
pnpm bridge

# Or forward to the real lambdaclass adapter on 17666:
AO_WS_PORT=17668 AO_TCP_HOST=127.0.0.1 AO_TCP_PORT=17666 pnpm bridge
```

The bot needs an existing test account and character on a real server. M1's recorded local account environment is in ignored `artifacts/server-attempts/real-server.env` in the original implementation checkout; do not print or commit it. A fresh worktree does not contain ignored local files. The stand-in has no combat, NPCs, persistence or real collision rules.

### lambdaclass locally

The reproducible **classic client** path in BUILD-LOG uses the patched reference clone, not the still-changing gameplay-gate fork. First-time dependency/clone/database instructions are in [tools/real-server/README.md on M2](https://github.com/arielcamus/ao-client/blob/m2-browser/tools/real-server/README.md). The tools are Elixir, Erlang/OTP, Rust and PostgreSQL 16.

From the runnable client checkout, for the existing local setup:

```sh
export AO_CLIENT_ROOT="$PWD"
export AO_SERVER_ROOT="$HOME/Projects/ao-reference/argentum-elixir"

# Verifies the exact upstream pin and applies/rechecks the classic adapter:
bash tools/real-server/prepare.sh "$AO_SERVER_ROOT"

AO_PG_BIN="$(brew --prefix postgresql@16)/bin"
AO_PG_DATA="$HOME/Projects/ao-reference/runtime/ao-postgres"
if ! "$AO_PG_BIN/pg_ctl" -D "$AO_PG_DATA" status; then
  "$AO_PG_BIN/pg_ctl" -D "$AO_PG_DATA" -l "$AO_PG_DATA/server.log" \
    -o '-h 127.0.0.1 -p 55432 -k /private/tmp' start
fi

cd "$AO_SERVER_ROOT/server"
mix deps.get
mix compile
mix run --no-start "$AO_CLIENT_ROOT/tools/real-server/classic_profile_test.exs"
export AO_PROTOCOL_PROFILE=classic AO_PORT=17666 AO_DB_PORT=55432
# Set AO_EMAIL and AO_PASSWORD privately before launch.
mix run --no-start "$AO_CLIENT_ROOT/tools/real-server/run.exs"
```

Do not start a second cluster/server on occupied ports or reinitialise an existing database. For a new machine, follow the linked first-time setup rather than running `initdb` over these paths. Wait for `REAL AO COMMUNITY SERVER`; initial map loading can take about a minute. The launcher migrates `ao_client_real`, creates a normal test character when needed, and preserves it on subsequent runs. Stop only your own foreground server with Ctrl-C. Stop PostgreSQL only when no other workstream is using it.

For backend changes, work in **`~/Projects/argentum-server`**, whose `origin` is Ariel's repository. Check its branch, status and `docs/GAMEPLAY-GATE-2026-11-20.md` first. The [native gate README](https://github.com/arielcamus/argentum-server/blob/20777fb9a5b55ffb9f12db06bf808b43e34513dd/tools/gameplay-gate/README.md) gives setup and reproduction commands (`run.exs`, `play.mjs`, `startup_checks.exs`); it uses TCP **18666**, HTTP/WebSocket **18667**, and a separate gate database. Those files are committed in draft server PR #1, not its main branch. Coordinate with their owner before rerunning or editing. Do not overwrite that checkout with the reference adapter preparation script.

### Windows VM

These are the local `vm-server` workflow entry points, **pending provisioning and verification**, not scripts supplied by main or the published M2 branch:

```sh
# From the checkout containing the vm-server work, after VM setup completes:
bash scripts/vm-up.sh
bash scripts/vm-ssh.sh
bash scripts/vm-down.sh
```

The local scripts target UTM VM `ao-build`, state at `~/Projects/ao-reference/runtime/ao-vm`, SSH through loopback **2222**, and proposed server TCP forwarding through loopback **7667**. `vm-ssh.sh` requires the generated `ssh_config`. VM limits are **4 GB RAM**, **40 GB thin disk**, and at least **25 GB host free space**. Read local `docs/VM-BUILD-HANDOFF.md` and the latest BUILD-LOG before first use. The bundle is staged; Windows installation, SSH and guest dependency setup remain unverified. The immediate resume steps are obtaining the official ARM64 ISO and restoring working UTM access, then following that handoff.

Ariel imports/builds the project manually in twinBASIC Community with **`PYMMO=0`** (Aurora transport, `DIRECT_PLAY=0`). There is no authorised unattended compiler command. After a successful build, record the executable, dependencies, flags and test results, then start using that executable as the differential oracle. VM TCP port 7667 overlaps the standalone bridge's default WebSocket port: choose another WebSocket port, or use the dev launcher's free-port bridge.

## Next steps in order

1. **Gameplay gate: go/no-go.** Finish and review the cookie-secret PR and its handoff in Ariel's server fork. The initial gate reports NO-GO: fix inventory slot translation (estimated **1–2 Build-hours**) and skill persistence (**0.5–1 hour**), then repeat login/walk, an NPC attack, a spell, pickup/equip, a shop purchase, chat, and reconnect/persistence with lambdaclass's frozen TypeScript client. Address the recorded faction/quest defects before calling it a relaunch base. Record evidence and revisit the server choice if the bounded fixes cannot make the gate pass.
2. **Classic UI.** Finish the original VB6 layout/art on the selected M2 base, compare screens, and retain desktop/mobile input and session regression checks. Once the gate passes, expose the same gameplay flows through the classic adapter and this client; the report estimates **4–8 Build-hours** for that slice.
3. **VB6 compile and oracle harness.** Complete the Windows VM, have Ariel manually build once, verify bot/browser interoperability, and capture deterministic scenarios. Compare packets and resulting state with the Elixir fork; pin fixtures, clock/RNG assumptions and the reference database.
4. **Close the parity backlog.** Work through the [31-system parity table](research/2026-11-20-argentum-lambdaclass-parity.md), prioritising persistence, combat/spells, inventory/commerce, quests/pets and protocol gaps. Estimate **80–150 agent hours** for server-rule/state gaps, plus **8–16 hours** for comprehensive classic packet translation. These are uncertain Build estimates, not a launch date; the report's separate Rust-client estimate is outside this project's chosen client path.
5. **Modernise the UI later**, after faithful behavior and comparison tests are established.
6. **Public launch later.** Publish the project source, settle asset provenance/permissions and the limited supporter model, add new content, validate operational recovery and real-player sessions, then open AOSpain to Spanish/European players.

## How to continue with Codex

Start with this document, then read the **latest log on the branch you will actually work on**. Read the [lambdaclass parity report](research/2026-11-20-argentum-lambdaclass-parity.md) before server work. For client work, read [PROTOCOL.md](https://github.com/arielcamus/ao-client/blob/m2-browser/docs/PROTOCOL.md), [ASSETS.md](https://github.com/arielcamus/ao-client/blob/m2-browser/docs/ASSETS.md), and the [real-server setup](https://github.com/arielcamus/ao-client/blob/m2-browser/tools/real-server/README.md). Refresh PRs in both Ariel repositories and inspect `git status` / `git worktree list` before changing anything.

Use these conventions:

- Keep tasks bounded. State the acceptance scenario and **Build vs Wait** estimate: Build is agent work; Wait names the external dependency and its owner, such as Ariel's manual IDE build or play acceptance. Report measured wall-clock separately from estimates.
- Use a separate branch/worktree when another job owns the checkout. Preserve its uncommitted work. Do not stash, reset, switch, rebase or force-push someone else's branch.
- Open **draft PRs**, push when the relevant tests are green, and update the PR with scope and evidence. Every PR gets an **independent review**; resolve findings before merge. Check the stacked base branches explicitly.
- For implementation changes, use the relevant `pnpm typecheck`, `pnpm test`, `pnpm build`, browser suite and/or server tests. For docs-only changes, check links, copied-file integrity, privacy and `git diff --check`; do not represent old runtime results as fresh tests.
- Keep artwork, screenshots containing artwork, databases, executables, credentials and local environment files out of commits. Do not reuse proprietary `ao20-shared-types`. Retain upstream code notices.
- **Never `pkill -f`.** Stop a process you launched using its recorded PID or its foreground terminal, or use the dedicated VM shutdown script. Coordinate shared PostgreSQL/server ports with other workstreams.
- Label evidence precisely: stand-in, real lambdaclass, or original VB6. An inferred move, source-level handler, or passing unit test is not a live gameplay pass. Update this hub and the branch BUILD-LOG when a decision or gate changes.

A useful starting instruction to Codex:

> Read docs/PROJECT.md, the active workstream's latest BUILD-LOG and the parity report. Refresh both repositories' PRs and inspect working trees. Continue the first unfinished next step in an isolated worktree, preserving other jobs. Give Build/Wait estimates, run the relevant checks, push a draft PR and obtain independent review.

### Research archive

These files were copied from `~/Projects/second-brain/outputs/`. Preserve their dated findings as research, not current instructions. They contain AO research only; the history report has one email address replaced with `[REDACTED EMAIL]`. No family details or phone numbers were found. The other four files are unchanged.

- [Client port assessment, 19 November](research/2026-11-19-argentum-online-client-port-assessment.md): VB6 architecture, wire protocol, assets and client effort; native-first recommendation superseded.
- [AO Forever web client, 19 November](research/2026-11-19-aoforever-web-client.md): technical browser precedent; never the visual specification. Its older blanket claim about format conversion is superseded by the licence distinction in the client assessment and the CC legal text.
- [Server port assessment, 20 November](research/2026-11-20-argentum-server-port-assessment.md): VB6 server structure and oracle strategy; proposed C# rewrite superseded by the lambdaclass decision.
- [lambdaclass parity, 20 November](research/2026-11-20-argentum-lambdaclass-parity.md): gameplay estimate, packet census, observed failures and backlog. Its pending approvals describe that audit's session, not a permanent project restriction.
- [AOSpain and WarroS history, 19 November](research/2026-11-19-argentum-area-51-server.md): evidence for the old Spanish server; the filename reflects the earlier Area 51 search, and the WarroS connection remains unconfirmed.
