# In-game bug reports

Beta players report a bug from inside the game. The report carries a screenshot, the recent logs and the character, so a
"me trabé en la puerta" arrives with the map, the position and the packets around it.

## How a player sends one

- **F8** anywhere in the client (login screen included), unless the player has bound F8 to an action in the key editor
  (the binding wins). F8 has no binding in `DefaultKey.ini` and no browser action. On a Mac laptop it is `fn` + F8.
- Or the **"Bugs"** button of frmMain's MENU tab (`imgBugReport`). In the VB6 client that button opens FrmGmAyuda, the message
  to the GMs online. It now opens the reporter, and the reporter's **"Escribir a un GM"** button opens FrmGmAyuda, so the old
  path is still one click away. `/GM` still opens FrmGmAyuda directly.

The window asks **¿Qué pasó?** (required) and **¿Qué esperabas que pasara?** (optional), shows the screenshot with a checkbox to
leave it out, and says in one line what else is sent. Enviar → "¡Gracias! Reporte `<id>` enviado." plus a console line, and the
window closes after 2.5 s. Escape closes it like every window (`window-stack.ts`).

It is drawn on FrmGmAyuda's picture, the classic "MENSAJE AL STAFF" window (Ariel, 22 Nov: the first version was a plain white form; he
sent that window as the reference). `es_ventanagm` (470x434) as `ui-captions.ts` hands it out, every baked caption painted out, then a canvas
copy of our own (`reporterArt`) with the seven reason circles and the CANCELAR / ENVIAR frames covered by the plain texture beside them.
Over it: "REPORTAR UN BUG" in Cinzel after the message icon, "¿QUÉ PASÓ?" on the scroll banner, and under it the message box, as large as
the left panel allows (182x224: the GM form's black box widened and raised to the banner, over where that form has its intro). The right
panel, its reason circles covered, says what is sent (a status or error replaces that line), then "Incluir captura de pantalla"
(`check-amarillo`) with the thumbnail and "¿Qué esperabas? (opcional)". At the bottom "Escribir a un GM" (a text button drawn like the
bitmap ones) and the game's CANCELAR / ENVIAR pictures. The window is opaque (FrmGmAyuda is 240/255: the world
showed through the message box). If the picture cannot load, the window stays black with a plain frame.

Code: `apps/web/src/bug-report-ui.ts` (window), `bug-report-data.ts` (rings, redaction, payload), `bug-report-capture.ts`
(console/error capture, screenshot), wiring in `main.ts`, the protocol hook `Session.onTrace`. Server: `tools/bug-reports.mjs`,
mounted by `tools/dev-web.mjs` (dev and `--preview`, so `play.sh` gets it).

### Beta: the red bug button and the console line

While the game is in alpha/beta the reporter has to be impossible to miss, so two aids sit on one flag, `AO_BETA` (on by default; the
server passes it to the page as ao-config.json `beta`; `AO_BETA=0` removes both when the beta ends). `?beta=1` / `?beta=0` in the address
overrides it for one page (the Playwright suite runs with `AO_BETA=0` so the layout specs see the bare game). Code: `apps/web/src/beta.ts`.

- **A red "🐞 Reportar bug (F8)" button** fixed to the page's top-right corner, outside the 1024x768 game window, above every window, on
  every screen (login, account, world, combat). It opens the same reporter and never takes the keyboard focus (Enter and Space stay with
  the game). It never covers the game: with room beside or above the game it shows the full label; when the window is just too narrow
  the layout keeps a gutter for it if that costs the game at most 10% of its size, otherwise it shows the bug icon alone, in a gutter of
  exactly its width if needed (`betaButtonPlacement`, `setLayoutGutter` in `classic-layout.ts`). The cost: in a window with no room beside
  or above the game (a 4:3 window, 1440x1000), the game is drawn up to 112 px narrower than without the flag, so a whole-number scale can
  become a fractional one.
- **Desktop only.** On a touch device (no hover, coarse pointer) the button is not created; the MENU tab's "Bugs" button is the way in.
- **One console line per entry into the world** (a login, or another character from the account screen): "Beta: si ves algo raro, F8 o el
  botón 🐞 arriba a la derecha". Client-only, nothing goes to the server.

## What is collected

| Part | Contents |
|---|---|
| Text | what happened, what was expected (≤ 4000 / 2000 characters) |
| Screenshot | the game canvas only (the world view; frmMain's HUD is HTML and not in the picture), taken when the window opens, ≤ 1280 px wide, PNG or JPEG under 900 KB. The player can untick it. |
| Character | name, level, class, map, map name, x/y, HP, mana, dead, privilege level |
| Client | commit and branch of the server's checkout, build time, asset version, wire profile, server profile, mode (classic / standin), page path |
| Environment | user agent, platform, language, time zone, window size, devicePixelRatio, screen size, screen scale option, touch |
| Stats | FPS, JS heap (Chrome), seconds on the page / connected / in the world, walks sent / confirmed / corrected, unknown frames, decode problems (last 20), seconds since an unanswered position probe, clipped graphics |
| UI | ids of the open windows |
| Game console | the last 200 console lines (what the player saw) |
| Browser console | the last 200 `console.*` lines |
| Protocol | the last 300 packets, **id, name, direction and time only, never a payload** |
| Errors | the last 50 `window.onerror` / `unhandledrejection` / client error lines, with stacks |

There is no ping in the client yet, so latency is not measured directly; the protocol times and `serverSilentMs` show stalls.

## Privacy

- **Never the account e-mail or password.** The protocol trace stores no payloads, so `LoginAccount` is a name and a time.
  The page passes the account e-mail and password it knows as secrets; every exact occurrence is replaced by `[redactado]` in
  every string (the player's text included, in case they typed it).
- Then every string, in the browser and again on the server, loses: e-mail addresses (`[email]`), `password=` / `clave:` /
  `token:`-style pairs, `Bearer` tokens, GitHub / Slack / AWS / `sk-` keys, JWTs, and the password argument of `/PARTICIPAR` / `/PARTICIPATE` anywhere in a line.
- The server keeps no IP address in the report (the IP is only a rate-limit key in memory). Files are written `0600` in a
  `0700` directory.
- The GitHub token lives only in the server process; it never reaches the browser and never appears in a log or error line.

## Server: `POST /api/bug-report`

- JSON only (415 otherwise), body ≤ 3 MB (413), decoded screenshot ≤ 1.5 MB and really a PNG/JPEG (magic bytes checked, 415).
- Unknown fields are dropped; lists and strings are cut to fixed ceilings; strings are redacted again.
- ⚠️ **Behind a proxy (Cloudflare tunnel, nginx), set `AO_BUG_REPORT_TRUST_PROXY=1`.** Otherwise every request comes from the proxy's
  address and ALL players share one per-IP bucket: five reports an hour for the whole beta.
- **Strings are cut before they are redacted:** each one to its limit plus 512 characters, then redacted, then clipped, so the patterns
  never run over the megabyte a 3 MB body allows (an unauthenticated 100 KB chat line used to block the server ~17 s; now ~1 ms). The
  e-mail pattern has bounded parts (local ≤ 64, domain ≤ 255) on both sides.
- **Rate limits:** 5 reports per IP per hour and 3 per page session per 10 minutes (429 with `Retry-After`; the window says when to
  try again). Every POST counts against the IP from the moment it arrives (so a parallel burst cannot slip past the check, and
  a malformed 3 MB body costs a slot like a good one), except one the server itself failed to store. The page-session limit counts
  accepted reports only.
- Answers `201 {"id": "...", "github": "queued" | "off"}`, then (if configured) opens the GitHub issue in the background.

### Configuration (environment of `tools/dev-web.mjs` / `play.sh`)

| Variable | Default | Meaning |
|---|---|---|
| `AO_BUG_REPORT_DIR` | `~/.ao-client/bug-reports` | where `<id>.json` and `<id>.png`/`.jpg` land. Keep it outside the repo (`bug-reports/` is gitignored in case). |
| `AO_BUG_REPORT_IP_LIMIT` | `5` | reports per IP per hour |
| `AO_BUG_REPORT_SESSION_LIMIT` | `3` | reports per page session per 10 minutes |
| `AO_BUG_REPORT_TRUST_PROXY` | off | `1` = take the client IP from the LAST `X-Forwarded-For` entry, the one your proxy appended (earlier entries are client-supplied and ignored). Set it only behind exactly one proxy you run (e.g. one Cloudflare tunnel); without it every player behind that proxy shares one IP limit |
| `AO_BUG_REPORT_GITHUB_TOKEN` | none | turns GitHub on together with the repo |
| `AO_BUG_REPORT_GITHUB_REPO` | none | `owner/name`; live: `arielcamus/ao-bug-reports` |
| `AO_BUG_REPORT_GITHUB_BRANCH` | `bug-reports` | the branch the screenshots and JSON are committed to |
| `AO_BUG_REPORT_GITHUB_LABEL` | `bug-report` | the issue label |
| `AO_BETA` | on | the beta aids above (ao-config.json `beta`); `0` / `false` / `off` / `no` turns them off |

Without a token and repo the server stores locally and logs one line per report:
`[bug-report] <id> stored at <path>: <title>`.

### GitHub issues, and why the screenshot goes to a branch

The issue (title `[bug] <first line> · <character> · mapa <n>`, label `bug-report`) has the text, the screenshot, a table
(character, map and position, HP/MP, client commit, browser, screen, FPS, walks, open windows), a link to the full JSON and
collapsed sections with the errors, the last 40 game and browser console lines and the last 80 packets. Player text cannot
@-mention anyone or break out of a code block.

GitHub's API has no upload for issue attachments, so the picture has to live somewhere the issue can link. The options were:

- **A gist:** the gist API takes text only, and a "secret" gist is public to anyone with the link. Rejected.
- **Keep it local and attach by hand:** no picture in the issue, the triager has to ask for it. Rejected as the default (it is
  still what happens without a token).
- **Commit it to a branch of the repo (chosen):** `reports/YYYY-MM/<id>.png` and `<id>.json` on the `bug-reports` branch, which the
  server creates once as an orphan branch (no shared history with the code; never merge it). The issue embeds
  `https://github.com/<repo>/blob/bug-reports/<path>?raw=true`, which GitHub renders for anyone who can read the repo, private repos
  included, and nobody else.

If GitHub fails (token expired, no permission, network), the report is already stored; the failure is logged as
`[bug-report] GITHUB FAILED for <id> ...` and written to `<id>.github.json` as `{"error": ...}`. Every report without an issue is
pushed again on the next server start, or on demand: `node tools/bug-reports.mjs push-pending` (same environment variables).
A successful push writes `<id>.github.json` with the issue number and URL.

### The live setup (22 Nov 2026)

- **Repo:** [`arielcamus/ao-bug-reports`](https://github.com/arielcamus/ao-bug-reports), **private**, separate from the code. Reports carry
  players' chat lines, character names and screenshots, so only collaborators see them. Its `main` holds a README; the server creates the
  `bug-reports` orphan branch on the first report. Label `bug-report` created up front.
- **Token:** a fine-grained personal access token on Ariel's account, named `ao-bug-reporter`, resource owner `arielcamus`, **only** the
  `ao-bug-reports` repository, permissions **Contents: read and write** (the screenshots and JSON pushed to the branch), **Issues: read and
  write**, Metadata read-only (automatic). Nothing else: it cannot see `ao-client` or any other repo. Issues open in Ariel's name (no bot
  account: creating one needs an e-mail and a captcha only he can do).
- **Expires 22 Nov 2027.** A Todoist reminder fires on 8 Nov 2027 to rotate it.
- **Where it lives:** the macOS Keychain of the play Mac, generic password, service `ao-bug-report-github-token`, account `ao-bug-reporter`.
  Never in git, never in a file.
- **How the server reads it:** the play server's environment, set by whatever starts `tools/dev-web.mjs` (`play.sh`):

  ```sh
  AO_BUG_REPORT_GITHUB_TOKEN="$(security find-generic-password -s ao-bug-report-github-token -w)" \
  AO_BUG_REPORT_GITHUB_REPO=arielcamus/ao-bug-reports \
  node tools/dev-web.mjs --preview
  ```

  The startup line then says `Bug reports: <dir> + GitHub issues in arielcamus/ao-bug-reports`.
- **Verified end to end** on 22 Nov against the VB6 server (own dev server, account `bugreport@local.test`): report
  `20261122-125258-b62a7b` became issue #1 with the screenshot rendered (736x608), the table, the logs and the JSON link; the issue was then
  closed.

**Rotating the token** (before 22 Nov 2027, or at once if it leaks): github.com → Settings → Developer settings → Fine-grained tokens →
`ao-bug-reporter` → Regenerate (same scope), then
`security add-generic-password -a ao-bug-reporter -s ao-bug-report-github-token -w '<new token>' -U` and restart the play server. Reports
sent while the token was dead are stored locally with `<id>.github.json` = `{"error": ...}` and are pushed on the next start (or
`node tools/bug-reports.mjs push-pending`). Revoke the old token if it leaked.

GitHub creates the label the first time an issue uses it; if a repo setting prevents that, create `bug-report` once under the repo's labels.

## Triage

1. Locally: `ls -t $AO_BUG_REPORT_DIR` (newest first); each `<id>.json` is one report, `<id>.png`/`.jpg` its picture.
   `jq '{text, character, client, errors}' <id>.json` is the quick read.
2. On GitHub: filter by label `bug-report`. The issue links the full JSON.
3. Reproduce from the JSON: `client.commit` says which build, `character.map/x/y` where, `protocol` what the server and client
   said just before (look for the last `out:` packet and what came back), `errors` and `console` for client exceptions,
   `stats.decodeProblems` / `unknownFrames` for codec trouble (docs/CONFORMANCE.md).
4. Close the loop: label, fix, link the PR. The branch copy of the JSON stays as the record.

## Tests

- `apps/web/test/bug-report.test.ts`: redaction, the ring buffer, the payload builder (limits, no credentials), packet names.
- `apps/web/test/bug-report-server.test.ts`: validation, rate limits, the endpoint over HTTP into a temp dir, the GitHub calls
  against a fake API (branch creation, uploads, issue, token never in errors), push-pending.
- `apps/web/test/beta.test.ts`: the `AO_BETA` flag (server default on, client only on `beta: true`), touch detection, the button placement
  over common window sizes (never on the game).
- `apps/web/e2e/bug-report.spec.ts`: F8 → fill → Enviar against the stand-in; reads the stored JSON and picture back from the run's
  temp dir (`playwright.config.ts` sets `AO_BUG_REPORT_DIR`) and checks the credentials are absent; the Bugs button → "Escribir a un GM"; the beta button (outside the game at 1440x1000 and 1920x1080, opens the reporter, no focus kept) and the
  console line once per login (screenshot `artifacts/screenshots/bug-report-beta-button.png`).
- Live: `tools/bug-report-real-shot.mjs` against the VB6 server (screenshots `artifacts/screenshots/bug-report-live-*.png`).
