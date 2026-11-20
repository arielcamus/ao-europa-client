import { describe, expect, it } from 'vitest';
import {
  BankTradeClientPacketId as BC, BankTradeServerPacketId as BS, decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const emptyEntry = '0000' + '00' + '00000000'.repeat(3);

/** Goldens marked (real VB6) are bytes captured from the VB6 server on 2026-11-20 (tests/fixtures/vb6/bank, tests/fixtures/vb6/trade); the rest follow the writer field order. */
const server = [
  ['ChangeBankSlot (real VB6)', '410001cf0e000000000200e803000000', { id: BS.ChangeBankSlot, slot: 1, object: 3791, elementalTags: 0, amount: 2, value: 1000, canUse: 0 }],
  ['ChangeBankSlot emptied (real VB6)', '41000500000000000000000000000000', { id: BS.ChangeBankSlot, slot: 5, object: 0, elementalTags: 0, amount: 0, value: 0, canUse: 0 }],
  ['UserCommerceInit (real VB6)', '0c00', { id: BS.UserCommerceInit }],
  ['UserCommerceEnd (real VB6)', '0d00', { id: BS.UserCommerceEnd }],
  ['ShowPregunta (real VB6)', '8e003a06055462616e6b', { id: BS.ShowPregunta, messageId: 1594, param: 'Tbank' }],
  ['CommerceRecieveChatMessage (real VB6)', 'a6000c5b5462616e6b5d20686f6c61', { id: BS.CommerceRecieveChatMessage, message: '[Tbank] hola' }],
  ['BankInit', '0b00', { id: BS.BankInit }],
  ['BankEnd', '0900', { id: BS.BankEnd }],
  ['Goliath: gold int32, items byte', '7c00' + '40420f00' + '07', { id: BS.Goliath, gold: 1_000_000, items: 7 }],
  ['UpdateBankGld', 'af00' + 'e8030000', { id: BS.UpdateBankGld, gold: 1000 }],
  ['ShowUserRequest', '6300' + '06' + '4f6665727461', { id: BS.ShowUserRequest, details: 'Oferta' }],
] as const;

describe('bank and trade server packets', () => {
  for (const [name, golden, packet] of server) {
    it(`${name} decodes and re-encodes to the golden bytes`, () => {
      expect(decodeServerPacket(bytes(golden))).toEqual(packet);
      expect(hex(encodeServerPacket(packet as never))).toBe(golden);
    });
  }
  it('ChangeUserTradeSlot follows WriteChangeUserTradeSlot: mine, gold, then six entries of object, name, grh, amount, tags', () => {
    const golden = '6400' + '00' + 'f4010000' + 'cf0e' + '044974656d' + '64000000' + '01000000' + '00000000' + emptyEntry.repeat(5);
    const items = [{ object: 3791, name: 'Item', grh: 100, amount: 1, elementalTags: 0 }, ...Array.from({ length: 5 }, () => ({ object: 0, name: '', grh: 0, amount: 0, elementalTags: 0 }))];
    const packet = { id: BS.ChangeUserTradeSlot, mine: false, gold: 500, items };
    expect(decodeServerPacket(bytes(golden))).toEqual(packet);
    expect(hex(encodeServerPacket(packet as never))).toBe(golden);
    const mine = golden.replace('64000000', '64000000').replace('6400' + '00', '6400' + '01');
    expect(decodeServerPacket(bytes(mine))).toMatchObject({ mine: true });
  });
  it('ChangeUserTradeSlot rejects a short offer and a truncated frame', () => {
    expect(() => encodeServerPacket({ id: BS.ChangeUserTradeSlot, mine: true, gold: 0, items: [] } as never)).toThrow('6 slots');
    expect(() => decodeServerPacket(bytes('6400' + '00' + 'f4010000' + emptyEntry.repeat(5)))).toThrow('id=100');
  });
  it('rejects trailing bytes', () => { expect(() => decodeServerPacket(bytes('0b0000'))).toThrow('id=11'); });
});

const client = [
  ['BankDeposit (real VB6)', '0c0003010000', { id: BC.BankDeposit, slot: 3, amount: 1, destination: 0 }],
  ['BankDeposit to a slot (real VB6)', '0c0003010007', { id: BC.BankDeposit, slot: 3, amount: 1, destination: 7 }],
  ['BankExtractItem (real VB6)', '0a0005010000', { id: BC.BankExtractItem, slot: 5, amount: 1, destination: 0 }],
  ['BovedaMoveItem (real VB6)', 'fd000105', { id: BC.BovedaMoveItem, from: 1, to: 5 }],
  ['BankStart (real VB6)', '3600', { id: BC.BankStart }],
  ['BankDepositGold (real VB6)', '470064000000', { id: BC.BankDepositGold, amount: 100 }],
  ['BankExtractGold (real VB6)', '460064000000', { id: BC.BankExtractGold, amount: 100 }],
  ['RequestAccountState (real VB6)', '2900', { id: BC.RequestAccountState }],
  ['BankEnd (real VB6)', '5a00', { id: BC.BankEnd }],
  ['CommerceStart (real VB6)', '3500', { id: BC.CommerceStart }],
  ['UserCommerceOffer item (real VB6)', '10000301000000', { id: BC.UserCommerceOffer, slot: 3, amount: 1 }],
  ['UserCommerceOffer gold slot (real VB6)', '1000c805000000', { id: BC.UserCommerceOffer, slot: 200, amount: 5 }],
  ['CommerceSendChatMessage (real VB6)', '110104686f6c61', { id: BC.CommerceSendChatMessage, message: 'hola' }],
  ['UserCommerceOk (real VB6)', '5b00', { id: BC.UserCommerceOk }],
  ['ResponderPregunta yes (real VB6)', 'eb0001', { id: BC.ResponderPregunta, accept: true }],
  ['ResponderPregunta no (real VB6)', 'eb0000', { id: BC.ResponderPregunta, accept: false }],
  ['UserCommerceReject', '5c00', { id: BC.UserCommerceReject }],
  ['UserCommerceEnd (real VB6)', '5900', { id: BC.UserCommerceEnd }],
  ['TraerBoveda', 'e800', { id: BC.TraerBoveda }],
  ['CuentaExtractItem', '0e01' + '02' + '0500' + '00', { id: BC.CuentaExtractItem, slot: 2, amount: 5, destination: 0 }],
  ['CuentaDeposit', '0f01' + '02' + '0500' + '09', { id: BC.CuentaDeposit, slot: 2, amount: 5, destination: 9 }],
] as const;

describe('bank and trade client packets', () => {
  for (const [name, golden, packet] of client) {
    it(`${name} decodes and re-encodes to the golden bytes`, () => {
      expect(decodeClientPacket(bytes(golden))).toEqual(packet);
      expect(hex(encodeClientPacket(packet as never))).toBe(golden);
    });
  }
});
