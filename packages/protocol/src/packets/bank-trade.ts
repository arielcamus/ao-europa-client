/*
 * Bank and player-to-player trade packets, 2026-11-20, from the classic VB6 PacketId.bas (PYMMO=0),
 * the client Protocol.bas Handle* / Protocol_Writes.bas Write* and the server Protocol_Writes.bas.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 * Own file so parallel feature branches do not conflict; packets.ts only lists the two tables below.
 */
import { Reader, Writer } from '../binary.js';

/** ServerPacketID values (eMinPacket = 0). ShowPregunta (142) answers the trade invitation and belongs to the party/guild package too: one codec per id. */
export enum BankTradeServerPacketId {
  BankEnd = 9,
  BankInit = 11,
  UserCommerceInit = 12,
  UserCommerceEnd = 13,
  ChangeBankSlot = 65,
  ShowUserRequest = 99,
  ChangeUserTradeSlot = 100,
  ShowPregunta = 142,
  Goliath = 124,
  CommerceRecieveChatMessage = 166,
  UpdateBankGld = 175,
}
/** ClientPacketID values. */
export enum BankTradeClientPacketId {
  BankExtractItem = 10,
  BankDeposit = 12,
  UserCommerceOffer = 16,
  RequestAccountState = 41,
  CommerceStart = 53,
  BankStart = 54,
  BankExtractGold = 70,
  BankDepositGold = 71,
  UserCommerceEnd = 89,
  BankEnd = 90,
  UserCommerceOk = 91,
  UserCommerceReject = 92,
  TraerBoveda = 232,
  ResponderPregunta = 235,
  BovedaMoveItem = 253,
  CuentaExtractItem = 270,
  CuentaDeposit = 271,
  CommerceSendChatMessage = 273,
}
/** FLAGORO: the pseudo slot that means "my gold" in UserCommerceOffer. */
export const TRADE_GOLD_SLOT = 200;
/** itemsAenviar(1 To 6): the offer has six slots. */
export const TRADE_OFFER_SLOTS = 6;
/** MAX_BANCOINVENTORY_SLOTS. */
export const BANK_SLOTS = 42;

export interface BtCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Shape<S> = { [K in keyof S]: S[K] extends BtCodec<infer T> ? T : never };
const byte: BtCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: BtCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: BtCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: BtCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: BtCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };
function struct<const S extends Record<string, BtCodec<unknown>>>(fields: S): BtCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) {
      for (const [key, codec] of Object.entries(fields)) codec.write(writer, (value as Record<string, unknown>)[key]);
    },
  };
}

export interface TradeOfferItem { object: number; name: string; grh: number; amount: number; elementalTags: number }
/**
 * Server WriteChangeUserTradeSlot / client HandleChangeUserTradeSlot: mine (bool), gold (int32), then six entries of
 * object (int16), name (string), grh (int32), amount (int32), elementalTags (int32). `mine` true is MY offer as the
 * server holds it; false is the OTHER player's offer.
 */
export interface ChangeUserTradeSlot { mine: boolean; gold: number; items: TradeOfferItem[] }
const changeUserTradeSlot: BtCodec<ChangeUserTradeSlot> = {
  read(reader) {
    const mine = reader.readBool(), gold = reader.readInt32(), items: TradeOfferItem[] = [];
    for (let i = 0; i < TRADE_OFFER_SLOTS; i++) {
      items.push({ object: reader.readInt16(), name: reader.readString(), grh: reader.readInt32(), amount: reader.readInt32(), elementalTags: reader.readInt32() });
    }
    return { mine, gold, items };
  },
  write(writer, value) {
    if (value.items.length !== TRADE_OFFER_SLOTS) throw new Error(`A trade offer has ${TRADE_OFFER_SLOTS} slots`);
    writer.writeBool(value.mine); writer.writeInt32(value.gold);
    for (const item of value.items) {
      writer.writeInt16(item.object); writer.writeString(item.name); writer.writeInt32(item.grh);
      writer.writeInt32(item.amount); writer.writeInt32(item.elementalTags);
    }
  },
};

const S = BankTradeServerPacketId, C = BankTradeClientPacketId;
export const bankTradeServerCodecs = {
  [S.BankEnd]: struct({}),
  [S.BankInit]: struct({}),
  [S.UserCommerceInit]: struct({}),
  [S.UserCommerceEnd]: struct({}),
  // WriteChangeBankSlot: slot, object, elementalTags, amount, value, canUse (PuedeUsar).
  [S.ChangeBankSlot]: struct({ slot: byte, object: int16, elementalTags: int32, amount: int16, value: int32, canUse: byte }),
  // WriteShowUserRequest: the request text, lines joined by U+00B7.
  [S.ShowUserRequest]: struct({ details: string }),
  [S.ChangeUserTradeSlot]: changeUserTradeSlot,
  // WritePreguntaBox: locale message id and its parameter (`·` separated).
  [S.ShowPregunta]: struct({ messageId: int16, param: string }),
  // WriteGoliathInit: gold held in the bank, number of items in the vault.
  [S.Goliath]: struct({ gold: int32, items: byte }),
  [S.CommerceRecieveChatMessage]: struct({ message: string }),
  [S.UpdateBankGld]: struct({ gold: int32 }),
};
export const bankTradeClientCodecs = {
  // WriteBankExtractItem / WriteBankDeposit / WriteCuentaExtractItem / WriteCuentaDeposit: slot, amount, destination slot (0 = first free).
  [C.BankExtractItem]: struct({ slot: byte, amount: int16, destination: byte }),
  [C.BankDeposit]: struct({ slot: byte, amount: int16, destination: byte }),
  [C.UserCommerceOffer]: struct({ slot: byte, amount: int32 }),
  [C.RequestAccountState]: struct({}),
  [C.CommerceStart]: struct({}),
  [C.BankStart]: struct({}),
  [C.BankExtractGold]: struct({ amount: int32 }),
  [C.BankDepositGold]: struct({ amount: int32 }),
  [C.UserCommerceEnd]: struct({}),
  [C.BankEnd]: struct({}),
  [C.UserCommerceOk]: struct({}),
  [C.UserCommerceReject]: struct({}),
  [C.TraerBoveda]: struct({}),
  [C.ResponderPregunta]: struct({ accept: bool }),
  // WriteBovedaItemMove: moves/swaps two vault slots.
  [C.BovedaMoveItem]: struct({ from: byte, to: byte }),
  [C.CuentaExtractItem]: struct({ slot: byte, amount: int16, destination: byte }),
  [C.CuentaDeposit]: struct({ slot: byte, amount: int16, destination: byte }),
  [C.CommerceSendChatMessage]: struct({ message: string }),
};
