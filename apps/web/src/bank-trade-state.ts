/*
 * Bank and player-trade state, following the classic client Handle* procedures (Protocol.bas): HandleBankInit/End,
 * HandleGoliath, HandleUpdateBankGld, HandleChangeBankSlot, HandleUserCommerceInit/End, HandleChangeUserTradeSlot,
 * HandleCommerceRecieveChatMessage, HandleShowUserRequest and HandleShowPregunta.
 * AGPL-3.0-or-later; see NOTICE.
 */
import { ServerPacketId as S, BankTradeServerPacketId as BS, BANK_SLOTS, TRADE_OFFER_SLOTS } from '@ao/protocol';
import type { ServerPacket, TradeOfferItem } from '@ao/protocol';

export interface BankSlot { object: number; elementalTags: number; amount: number; value: number; canUse: number }
export interface TradeOffer { gold: number; items: TradeOfferItem[] }
const emptyItem = (): TradeOfferItem => ({ object: 0, name: '', grh: 0, amount: 0, elementalTags: 0 });
export const emptyOffer = (): TradeOffer => ({ gold: 0, items: Array.from({ length: TRADE_OFFER_SLOTS }, emptyItem) });

export class BankTradeState {
  revision = 0;
  /** BancoInvent: the vault, filled slot by slot (the server sends all 42 before BankInit). */
  bankSlots = new Map<number, BankSlot>();
  bankOpen = false;
  /** frmGoliath is up (the Goliath packet) and the gold held in the bank (Stats.Banco). */
  goliathOpen = false;
  bankGold = 0;
  bankItems = 0;
  tradeOpen = false;
  /** What I offered / what the other player offered. Gold of the other player is lblOro. */
  mine: TradeOffer = emptyOffer();
  other: TradeOffer = emptyOffer();
  /** Server-written chat lines of the trade window (RecTxt), without the local warning. */
  tradeChat: string[] = [];
  /** frmUserRequest texts, oldest first. */
  requests: string[] = [];
  /** The in-world yes/no question (PreguntaScreen): a locale message id and its parameter. Answered with ResponderPregunta. */
  question: { messageId: number; param: string; at: number } | undefined;
  private questions = 0;

  /** Comerciando: any window that holds the player in a transaction. */
  get trading() { return this.bankOpen || this.tradeOpen; }
  /** IsDialogOpen: movement and world input pause while one of these is up. */
  get dialogOpen() { return this.bankOpen || this.goliathOpen || this.tradeOpen; }

  receive(packet: ServerPacket) {
    switch (packet.id) {
      case S.ChangeMap: this.closeAll(); break;
      case S.Logged: this.question = undefined; break;
      case BS.ChangeBankSlot:
        if (packet.slot < 1 || packet.slot > BANK_SLOTS) throw new Error('Invalid bank slot');
        if (packet.object > 0 && packet.amount > 0) this.bankSlots.set(packet.slot, { object: packet.object, elementalTags: packet.elementalTags, amount: packet.amount, value: packet.value, canUse: packet.canUse });
        else this.bankSlots.delete(packet.slot);
        break;
      case BS.BankInit: this.bankOpen = true; break;
      case BS.BankEnd: this.bankOpen = false; break;
      case BS.Goliath: this.goliathOpen = true; this.bankGold = packet.gold; this.bankItems = packet.items; break;
      case BS.UpdateBankGld: this.bankGold = packet.gold; break;
      case BS.UserCommerceInit:
        this.tradeOpen = true; this.mine = emptyOffer(); this.other = emptyOffer(); this.tradeChat = [];
        break;
      case BS.UserCommerceEnd: this.tradeOpen = false; break;
      case BS.ChangeUserTradeSlot: {
        // HandleChangeUserTradeSlot only writes slots whose amount is above zero; the server always resends all six.
        const offer: TradeOffer = { gold: packet.gold, items: packet.items.map(item => item.amount > 0 ? { ...item } : emptyItem()) };
        if (packet.mine) this.mine = offer; else this.other = offer;
        break;
      }
      case BS.CommerceRecieveChatMessage:
        this.tradeChat.push(packet.message);
        if (this.tradeChat.length > 200) this.tradeChat.shift();
        break;
      case BS.ShowUserRequest: this.requests.push(packet.details.replaceAll('·', '\n')); break;
      case BS.ShowPregunta: this.question = { messageId: packet.messageId, param: packet.param, at: ++this.questions }; break;
      default: return;
    }
    this.revision++;
  }
  /** The player answered, or a ResponderPregunta was sent: the box goes away. */
  answered() { if (this.question) { this.question = undefined; this.revision++; } }
  closeAll() {
    this.bankOpen = false; this.goliathOpen = false; this.tradeOpen = false; this.question = undefined;
    this.mine = emptyOffer(); this.other = emptyOffer(); this.tradeChat = [];
  }
}
