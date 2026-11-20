/*
 * Bank and trade actions: each builds the exact VB6 Write* packet (Protocol_Writes.bas). None of these packets carries a
 * sequence counter, so nothing here touches PacketCounters. AGPL-3.0-or-later; see NOTICE.
 */
import { BankTradeClientPacketId as BC, TRADE_GOLD_SLOT, BANK_SLOTS } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import type { BankTradeState } from './bank-trade-state.js';

export interface BankTradeDeps {
  send: (packet: ClientPacket) => void;
  ready: () => boolean;
}
const MAX_INVENTORY_OBJS = 10000;
const clampAmount = (amount: number, max = MAX_INVENTORY_OBJS) => Math.min(Math.max(Math.trunc(amount), 0), max);

export class BankTradeController {
  constructor(private readonly deps: BankTradeDeps, private readonly state: BankTradeState) {}

  // ---- frmBancoObj -------------------------------------------------------------------------------------------------
  /** cmdDepositar / double click / drop onto the vault: WriteBankDeposit(slot, amount, destination). */
  deposit(slot: number, amount: number, destination = 0) {
    if (!this.deps.ready() || !this.state.bankOpen || amount < 1) return;
    this.deps.send({ id: BC.BankDeposit, slot, amount: clampAmount(amount, 32767), destination });
  }
  /** cmdRetirar / double click / drop onto the inventory: WriteBankExtractItem(slot, amount, destination). */
  extract(slot: number, amount: number, destination = 0) {
    if (!this.deps.ready() || !this.state.bankOpen || amount < 1) return;
    this.deps.send({ id: BC.BankExtractItem, slot, amount: clampAmount(amount, 32767), destination });
  }
  /** InvBoveda_ItemDropped inside the vault: WriteBovedaItemMove. */
  moveVault(from: number, to: number) {
    if (!this.deps.ready() || !this.state.bankOpen || from === to || from < 1 || to < 1 || from > BANK_SLOTS || to > BANK_SLOTS) return;
    this.deps.send({ id: BC.BovedaMoveItem, from, to });
  }
  /** Form_Unload of frmBancoObj: WriteBankEnd. */
  closeBank() {
    if (!this.state.bankOpen) return;
    this.state.bankOpen = false; this.state.revision++;
    if (this.deps.ready()) this.deps.send({ id: BC.BankEnd });
  }

  // ---- frmGoliath --------------------------------------------------------------------------------------------------
  depositGold(amount: number) { if (this.deps.ready() && amount >= 1) this.deps.send({ id: BC.BankDepositGold, amount: clampAmount(amount, 2147483647) }); }
  extractGold(amount: number) { if (this.deps.ready() && amount >= 1) this.deps.send({ id: BC.BankExtractGold, amount: clampAmount(amount, 2147483647) }); }
  /** cmdBoveda_Click: WriteBankStart, then the Goliath window unloads. */
  openVault() { if (this.deps.ready()) this.deps.send({ id: BC.BankStart }); this.closeGoliath(); }
  closeGoliath() { if (this.state.goliathOpen) { this.state.goliathOpen = false; this.state.revision++; } }
  requestBalance() { if (this.deps.ready()) this.deps.send({ id: BC.RequestAccountState }); }

  // ---- frmComerciarUsu / frmUserRequest ----------------------------------------------------------------------------
  /** The /COMERCIAR command. */
  startTrade() { if (this.deps.ready()) this.deps.send({ id: BC.CommerceStart }); }
  /** cmdOfrecer: WriteUserCommerceOffer(slot, amount). */
  offerItem(slot: number, amount: number) {
    if (!this.deps.ready() || !this.state.tradeOpen || slot < 1 || amount < 1) return;
    this.deps.send({ id: BC.UserCommerceOffer, slot, amount: clampAmount(amount, 2147483647) });
  }
  /** cmdOfrecerOro: FLAGORO as the slot. */
  offerGold(amount: number) {
    if (!this.deps.ready() || !this.state.tradeOpen || amount < 1) return;
    this.deps.send({ id: BC.UserCommerceOffer, slot: TRADE_GOLD_SLOT, amount: clampAmount(amount, 2147483647) });
  }
  acceptTrade() { if (this.deps.ready() && this.state.tradeOpen) this.deps.send({ id: BC.UserCommerceOk }); }
  /** cmdRechazar and the window's close button: WriteUserCommerceReject. */
  rejectTrade() { if (this.deps.ready() && this.state.tradeOpen) this.deps.send({ id: BC.UserCommerceReject }); }
  /** WriteUserCommerceEnd: leaving the window with Escape. */
  endTrade() { if (this.deps.ready() && this.state.tradeOpen) this.deps.send({ id: BC.UserCommerceEnd }); }
  sendTradeChat(message: string) {
    const text = message.trim();
    if (!this.deps.ready() || !this.state.tradeOpen || !text || new TextEncoder().encode(text).length > 255) return false;
    this.deps.send({ id: BC.CommerceSendChatMessage, message: text }); return true;
  }
  /** Click on Sí / No of the in-world question: WriteResponderPregunta. */
  answerQuestion(accept: boolean) {
    if (!this.state.question) return;
    this.state.answered();
    if (this.deps.ready()) this.deps.send({ id: BC.ResponderPregunta, accept });
  }
}
