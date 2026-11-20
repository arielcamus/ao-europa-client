# bank and trade fixtures (real VB6 server)

Recorded 2026-11-20 with `tools/real-server/bank-trade-record.mjs` (bank, `items@local.test` / TItems) and
`tools/real-server/bank-trade-trade-record.mjs` (trade, two sessions: `banktrade@local.test` / Tbank and TItems) against the
classic VB6 server (127.0.0.1:7667). Format: see `docs/CONFORMANCE.md`. Both characters end each recording as they started.

## Entering the bank hall

Ullathorpe's building interiors carry castle-entry map triggers; until the map patch in `docs/DATA-PATCHES.md` (applied to the server 2026-11-20 22:2x,
loaded by its restart) a level-1 character was bounced at the doorway (`tests/fixtures/vb6/buildings/bank-castle-trigger-bounce.jsonl`). `far-from-banker` and
`deposit-move-extract` were recorded before that, from the street (77,56), 9 tiles from the banker Krix (77,47): `BankDeposit`, `BankExtractItem`,
`BovedaMoveItem` and the gold commands reach the server from there (limit 10 tiles; `BovedaMoveItem` has none). `goliath-and-vault` was recorded after, inside the hall
(77,51) with `tools/real-server/bank-trade-vault-record.mjs`: `Goliath` (124), `BankStart` -> 42 `ChangeBankSlot` + `BankInit` (11), deposit, move, extract, `BankEnd` -> `BankEnd` (9).

## What could NOT be recorded, and why

- **`UpdateBankGld` (175) with a real balance, a real gold deposit/withdrawal.** The characters are level 1 with no gold (`BankDepositGold` answers `LocaleChatOverHead` 1395) and
  nothing they can sell is tradeable. The `UpdateBankGld` golden is written from `WriteUpdateBankGld`.
- **Item and gold offers in a trade (`ChangeUserTradeSlot`, 100).** Every starter item is either newbie (locale 1141) or
  intransferible (1140) and the characters have no gold (1138), so the server refuses each offer; the fixtures record those refusals.
  The `ChangeUserTradeSlot` golden is written from `WriteChangeUserTradeSlot`, and `tools/bank-trade-mock-server.mjs` (NOT the oracle) shows offers in the UI.
- **The account vault (`frmBancoCuenta`: `TraerBoveda`, `CuentaExtractItem`, `CuentaDeposit`).** The server's `HandleCuentaExtractItem` and
  `HandleCuentaDeposit` are empty stubs and `HandleTraerBoveda` only resends the inventory, so there is nothing to record or show.
