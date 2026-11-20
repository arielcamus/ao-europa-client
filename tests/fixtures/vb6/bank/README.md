# bank and trade fixtures (real VB6 server)

Recorded 2026-11-20 with `tools/real-server/bank-trade-record.mjs` (bank, `items@local.test` / TItems) and
`tools/real-server/bank-trade-trade-record.mjs` (trade, two sessions: `banktrade@local.test` / Tbank and TItems) against the
classic VB6 server (127.0.0.1:7667). Format: see `docs/CONFORMANCE.md`. Both characters end each recording as they started.

## What could NOT be recorded, and why

- **Opening the vault (`BankInit`, 11) and the Goliath window (`Goliath`, 124), `UpdateBankGld` (175) with a real balance.**
  The banker Krix (77,47) stands in Ullathorpe's bank hall. Its doorway tiles carry map trigger 26 (`EMPEROR_CASTLE_ENTRY_6`);
  `GameLogic.bas` bounces every character that is not on a castle white list (`CheckCastleEntryWhiteList`, no castle exists on this
  build), so a level-1 character cannot come within the 4 tiles `HandleNpcInteractionByType` needs for `Goliath`, nor the 6 that
  `BankStart` needs. These three are covered by hand-written goldens from the VB6 writers (`WriteGoliathInit`, `WriteBankInit`,
  `WriteUpdateBankGld`) and by `tools/bank-trade-mock-server.mjs`, which is NOT the oracle.
- **Item and gold offers in a trade (`ChangeUserTradeSlot`, 100).** Every starter item is either newbie (locale 1141) or
  intransferible (1140) and the characters have no gold (1138), so the server refuses each offer; `fixtures` record those refusals.
  The `ChangeUserTradeSlot` golden is written from `WriteChangeUserTradeSlot`.
- **The account vault (`frmBancoCuenta`: `TraerBoveda`, `CuentaExtractItem`, `CuentaDeposit`).** The server's `HandleCuentaExtractItem` and
  `HandleCuentaDeposit` are empty stubs and `HandleTraerBoveda` only resends the inventory, so there is nothing to record or show.

## What was verified from the street

From (77,56), 9 tiles from Krix, `BankDeposit`, `BankExtractItem`, `BovedaMoveItem` and the gold commands reach the server (their limit is 10
tiles, and `BovedaMoveItem` has none), so `ChangeBankSlot` is recorded for real, including the explicit destination slot and a swap.
