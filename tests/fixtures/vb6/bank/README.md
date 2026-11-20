# bank and trade fixtures (real VB6 server)

Recorded 2026-11-20 with `tools/real-server/bank-trade-record.mjs` (bank, one level-1 test account) and
`tools/real-server/bank-trade-trade-record.mjs` (trade, two sessions on two level-1 test accounts) against the
classic VB6 server (127.0.0.1:7667). Credentials come from the environment (`AO_EMAIL`/`AO_PASSWORD`, `AO_A_*`/`AO_B_*`), never from the files. Format: see `docs/CONFORMANCE.md`. Both characters end each recording as they started.

## Entering the bank hall

Ullathorpe's building interiors carry castle-entry map triggers; until the map patch in `docs/DATA-PATCHES.md` (applied to the server 2026-11-20 22:2x,
loaded by its restart) a level-1 character was bounced at the doorway (`tests/fixtures/vb6/buildings/bank-castle-trigger-bounce.jsonl`). `far-from-banker` and
`deposit-move-extract` were recorded before that, from the street (77,56), 9 tiles from the banker Krix (77,47): `BankDeposit`, `BankExtractItem`,
`BovedaMoveItem` and the gold commands reach the server from there (limit 10 tiles; `BovedaMoveItem` has none). `goliath-and-vault` was recorded after, inside the hall
(77,51) with `tools/real-server/bank-trade-vault-record.mjs`: `Goliath` (124), `BankStart` -> 42 `ChangeBankSlot` + `BankInit` (11), deposit, move, extract, `BankEnd` -> `BankEnd` (9).

## Real gold and item offers (added from the PR #26 review recordings)

`bank/gold-deposit-extract` (a Goliath balance moving 2000 -> 1500 -> 0, `UpdateBankGld` 175 real) and `trade/item-offer-*` (a 5-apple offer, `ChangeUserTradeSlot` 100 real, mine and other side;
a second offer in the same trade is refused with locale **1142** "No podés cambiar tu oferta": the server keeps ONE offer per side, an item or gold, see `HandleUserCommerceOffer`) and
`trade/gold-offer-*` (a 1000-gold offer, six empty item entries). The window shows 1142 in its log and states the rule.

## What could NOT be recorded, and why

- **Item offers from the starter inventory**: every starter item is newbie (1141) or intransferible (1140); the real offers above used items the review characters were given.
- **The account vault (`frmBancoCuenta`: `TraerBoveda`, `CuentaExtractItem`, `CuentaDeposit`).** The server's `HandleCuentaExtractItem` and
  `HandleCuentaDeposit` are empty stubs and `HandleTraerBoveda` only resends the inventory, so there is nothing to record or show.
