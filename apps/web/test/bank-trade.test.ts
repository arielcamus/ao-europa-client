import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BankTradeClientPacketId as BC, BankTradeServerPacketId as BS, FrameDecoder, ServerPacketId as S, decodeClientPacket, decodeServerPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { BankTradeState, emptyOffer } from '../src/bank-trade-state.js';
import { ChatInput } from '../src/chat-input.js';
import { QUESTION_HIT } from '../src/trade-ui.js';

function harness() {
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => 1000);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1, heading: 2, body: 107, head: 1 }, f.UserCharIndexInServer, f.Logged);
  sent.length = 0; // login packets
  const decoded = () => { const d = new FrameDecoder(); return sent.flatMap(bytes => d.push(bytes).map(decodeClientPacket)); };
  return { session, recv, decoded };
}
const slot = (n: number, object: number, amount: number) => ({ id: BS.ChangeBankSlot, slot: n, object, elementalTags: 0, amount, value: 1000, canUse: 0 }) as const;

describe('bank state (Handle* procedures)', () => {
  it('fills the vault slot by slot, empties a slot with amount 0, and rejects a slot outside 1..42', () => {
    const state = new BankTradeState();
    state.receive(slot(1, 3791, 2)); state.receive(slot(7, 3791, 1));
    expect(state.bankSlots.get(1)).toMatchObject({ object: 3791, amount: 2, value: 1000 });
    state.receive(slot(1, 0, 0)); expect([...state.bankSlots.keys()]).toEqual([7]);
    expect(() => state.receive(slot(43, 1, 1))).toThrow('Invalid bank slot');
    expect(() => state.receive(slot(0, 1, 1))).toThrow('Invalid bank slot');
  });
  it('BankInit opens the vault, BankEnd closes it; Goliath opens the gold window with the bank gold and UpdateBankGld refreshes it', () => {
    const state = new BankTradeState();
    state.receive({ id: BS.Goliath, gold: 1500, items: 3 });
    expect(state).toMatchObject({ goliathOpen: true, bankGold: 1500, bankItems: 3, bankOpen: false, dialogOpen: true, trading: false });
    state.receive({ id: BS.UpdateBankGld, gold: 900 }); expect(state.bankGold).toBe(900);
    state.receive({ id: BS.BankInit }); expect(state).toMatchObject({ bankOpen: true, trading: true });
    state.receive({ id: BS.BankEnd }); expect(state.bankOpen).toBe(false);
  });
  it('keeps the vault contents across BankInit (the server sends all 42 slots first)', () => {
    const state = new BankTradeState();
    state.receive(slot(3, 4335, 10)); state.receive({ id: BS.BankInit });
    expect(state.bankSlots.get(3)?.amount).toBe(10);
  });
});

describe('trade state', () => {
  const entry = (object: number, name: string, amount: number) => ({ object, name, grh: 100 + object, amount, elementalTags: 0 });
  const offer = (mine: boolean, gold: number, ...items: ReturnType<typeof entry>[]) => ({
    id: BS.ChangeUserTradeSlot, mine, gold, items: [...items, ...Array.from({ length: 6 - items.length }, () => entry(0, '', 0))],
  }) as unknown as ServerPacket;
  it('UserCommerceInit clears both offers and the chat, ChangeUserTradeSlot sets mine or the other side, End closes', () => {
    const state = new BankTradeState();
    state.receive({ id: BS.CommerceRecieveChatMessage, message: 'old' });
    state.receive({ id: BS.UserCommerceInit });
    expect(state).toMatchObject({ tradeOpen: true, tradeChat: [], trading: true });
    expect(state.mine).toEqual(emptyOffer());
    state.receive(offer(true, 5, entry(3791, 'Espada', 2)));
    state.receive(offer(false, 70, entry(10, 'Poción', 4), entry(11, 'Manzana', 1)));
    expect(state.mine.gold).toBe(5); expect(state.mine.items[0]).toMatchObject({ object: 3791, amount: 2 });
    expect(state.other.gold).toBe(70); expect(state.other.items.filter(i => i.amount > 0).map(i => i.name)).toEqual(['Poción', 'Manzana']);
    state.receive({ id: BS.UserCommerceEnd }); expect(state.tradeOpen).toBe(false);
  });
  it('an entry with amount 0 stays empty (HandleChangeUserTradeSlot only sets slots above zero)', () => {
    const state = new BankTradeState();
    state.receive(offer(false, 0, { ...entry(5, 'Hacha', 0) }));
    expect(state.other.items[0]).toMatchObject({ object: 0, amount: 0, name: '' });
  });
  it('chat lines accumulate; ShowUserRequest keeps the text with U+00B7 as line breaks; ShowPregunta raises one question, answered once', () => {
    const state = new BankTradeState();
    state.receive({ id: BS.CommerceRecieveChatMessage, message: '[Ana] hola' });
    state.receive({ id: BS.ShowUserRequest, details: 'a·b' });
    state.receive({ id: BS.ShowPregunta, messageId: 1594, param: 'Ana' });
    expect(state.tradeChat).toEqual(['[Ana] hola']); expect(state.requests).toEqual(['a\nb']);
    expect(state.question).toMatchObject({ messageId: 1594, param: 'Ana' });
    state.answered(); expect(state.question).toBeUndefined();
  });
  it('a map change and a fresh login drop every window and the question', () => {
    const state = new BankTradeState();
    state.receive({ id: BS.BankInit }); state.receive({ id: BS.UserCommerceInit }); state.receive({ id: BS.ShowPregunta, messageId: 1, param: '' });
    state.receive({ id: S.ChangeMap, map: 2, resourceMap: 2 } as ServerPacket);
    expect(state).toMatchObject({ bankOpen: false, tradeOpen: false, question: undefined });
    state.receive({ id: BS.ShowPregunta, messageId: 1, param: '' }); state.receive({ id: S.Logged, newUser: false });
    expect(state.question).toBeUndefined();
  });
});

describe('bank and trade actions (Write* packets)', () => {
  it('bank actions are sent only while the vault is open, with the VB6 field order and no sequence counter', () => {
    const h = harness(); const a = h.session.bankTradeActions;
    a.deposit(3, 1); a.extract(1, 1); expect(h.decoded()).toEqual([]);
    h.recv({ id: BS.BankInit });
    a.deposit(3, 5); a.extract(2, 4, 9); a.moveVault(1, 5); a.moveVault(5, 5); a.moveVault(0, 3); a.deposit(3, 0);
    expect(h.decoded()).toEqual([
      { id: BC.BankDeposit, slot: 3, amount: 5, destination: 0 },
      { id: BC.BankExtractItem, slot: 2, amount: 4, destination: 9 },
      { id: BC.BovedaMoveItem, from: 1, to: 5 },
    ]);
  });
  it('closing the vault sends BankEnd once and hides it locally', () => {
    const h = harness(); h.recv({ id: BS.BankInit });
    h.session.bankTradeActions.closeBank(); h.session.bankTradeActions.closeBank();
    expect(h.decoded()).toEqual([{ id: BC.BankEnd }]); expect(h.session.bankTrade.bankOpen).toBe(false);
  });
  it('gold commands: Ver bóveda sends BankStart and unloads Goliath; deposit/extract need a positive amount', () => {
    const h = harness(); h.recv({ id: BS.Goliath, gold: 50, items: 0 });
    const a = h.session.bankTradeActions;
    a.depositGold(0); a.extractGold(-3); a.depositGold(100); a.extractGold(50); a.requestBalance(); a.openVault();
    expect(h.decoded()).toEqual([
      { id: BC.BankDepositGold, amount: 100 }, { id: BC.BankExtractGold, amount: 50 }, { id: BC.RequestAccountState }, { id: BC.BankStart },
    ]);
    expect(h.session.bankTrade.goliathOpen).toBe(false);
  });
  it('trade: offers need an open trade; gold uses slot 200; accept, reject and cancel are the bare packets; chat is capped at 255 bytes', () => {
    const h = harness(); const a = h.session.bankTradeActions;
    a.offerItem(3, 1); a.acceptTrade(); expect(h.decoded()).toEqual([]);
    h.recv({ id: BS.UserCommerceInit });
    a.offerItem(3, 2); a.offerItem(0, 2); a.offerItem(4, 0); a.offerGold(150); a.acceptTrade(); a.rejectTrade(); a.endTrade();
    expect(a.sendTradeChat('hola')).toBe(true); expect(a.sendTradeChat('   ')).toBe(false); expect(a.sendTradeChat('x'.repeat(256))).toBe(false);
    expect(h.decoded()).toEqual([
      { id: BC.UserCommerceOffer, slot: 3, amount: 2 }, { id: BC.UserCommerceOffer, slot: 200, amount: 150 },
      { id: BC.UserCommerceOk }, { id: BC.UserCommerceReject }, { id: BC.UserCommerceEnd }, { id: BC.CommerceSendChatMessage, message: 'hola' },
    ]);
  });
  it('answering the question sends ResponderPregunta once and clears it; with no question nothing is sent', () => {
    const h = harness(); const a = h.session.bankTradeActions;
    a.answerQuestion(true); expect(h.decoded()).toEqual([]);
    h.recv({ id: BS.ShowPregunta, messageId: 1594, param: 'Tbank' });
    a.answerQuestion(true); a.answerQuestion(false);
    expect(h.decoded()).toEqual([{ id: BC.ResponderPregunta, accept: true }]); expect(h.session.bankTrade.question).toBeUndefined();
  });
  it('the question hit areas are the VB6 regions of frmMain.renderer_MouseDown', () => {
    expect(QUESTION_HIT).toEqual({ no: [419, 243, 434, 261], yes: [443, 243, 459, 261] });
  });
});

describe('chat commands for the bank and trade (ProtocolCmdParse)', () => {
  const run = (text: string, context = {}) => new ChatInput().submit(text, context);
  it('/COMERCIAR and /TRADE start a trade unless dead or already trading', () => {
    expect(run('/comerciar').packet).toEqual({ id: BC.CommerceStart }); expect(run('/TRADE').packet).toEqual({ id: BC.CommerceStart });
    expect(run('/COMERCIAR', { dead: true })).toMatchObject({ notes: [{ text: '¡¡Estás muerto!!' }] });
    expect(run('/COMERCIAR', { trading: true })).toMatchObject({ notes: [{ text: 'Ya estás comerciando' }] });
  });
  it('/BOVEDA, /VAULT and /BALANCE send the bare packets', () => {
    expect(run('/BOVEDA').packet).toEqual({ id: BC.BankStart }); expect(run('/vault').packet).toEqual({ id: BC.BankStart });
    expect(run('/BALANCE').packet).toEqual({ id: BC.RequestAccountState });
    expect(run('/BALANCE', { dead: true }).packet).toBeUndefined();
  });
  it('/RETIRAR n and /DEPOSITAR n send the gold amount, anything else prints the VB6 hint', () => {
    expect(run('/RETIRAR 250').packet).toEqual({ id: BC.BankExtractGold, amount: 250 });
    expect(run('/DEPOSITAR 1000').packet).toEqual({ id: BC.BankDepositGold, amount: 1000 });
    expect(run('/RETIRAR').notes[0]!.text).toBe('Ingrese la cantidad que desea retirar');
    expect(run('/DEPOSITAR').notes[0]!.text).toMatch(/Faltan parámetros/);
    expect(run('/DEPOSITAR abc').packet).toBeUndefined(); expect(run('/DEPOSITAR abc').notes[0]!.text).toMatch(/Cantidad incorrecta/);
    expect(run('/DEPOSITAR 99999999999').packet).toBeUndefined();
  });
});

describe('real VB6 recordings drive the state', () => {
  const load = (name: string) => {
    const path = new URL(`../../../tests/fixtures/vb6/${name}.jsonl`, import.meta.url);
    return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: string; hex: string }) : [];
  };
  const replay = (rows: { dir: string; hex: string }[]) => {
    const state = new BankTradeState();
    for (const row of rows) if (row.dir === 's2c') { const p = decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex'))); if (!('unknown' in p)) state.receive(p); }
    return state;
  };
  it('bank/deposit-move-extract: the vault ends empty after depositing, moving, swapping and withdrawing', () => {
    const rows = load('bank/deposit-move-extract'); expect(rows.length).toBeGreaterThan(10);
    expect(replay(rows).bankSlots.size).toBe(0);
  });
  it('bank/goliath-and-vault: Goliath opens the gold window, BankStart fills 42 vault slots then opens the vault, the round trip leaves it empty and BankEnd closes it', () => {
    const rows = load('bank/goliath-and-vault'); expect(rows.length).toBeGreaterThan(50);
    const state = new BankTradeState(); const seen: string[] = [];
    for (const row of rows) if (row.dir === 's2c') {
      const p = decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex'))); if ('unknown' in p) continue;
      state.receive(p);
      if (p.id === BS.Goliath) seen.push(`goliath:${state.goliathOpen}:${state.bankGold}`);
      if (p.id === BS.BankInit) seen.push(`init:${state.bankOpen}`);
      if (p.id === BS.BankEnd) seen.push(`end:${!state.bankOpen}`);
    }
    expect(seen).toEqual(['goliath:true:0', 'init:true', 'end:true']); expect(state.bankSlots.size).toBe(0);
  });
  it('trade/offer-and-accept (responder): the invitation arrives as a question, the window opens, and the trade closes after both accept', () => {
    const rows = load('trade/offer-and-accept-responder'); expect(rows.length).toBeGreaterThan(10);
    const state = new BankTradeState(); const seen: string[] = [];
    for (const row of rows) if (row.dir === 's2c') {
      const p = decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex'))); if ('unknown' in p) continue;
      state.receive(p); if (p.id === BS.ShowPregunta) seen.push(`question:${p.param}`);
      if (p.id === BS.UserCommerceInit) seen.push(`open:${state.tradeOpen}`); if (p.id === BS.UserCommerceEnd) seen.push(`closed:${!state.tradeOpen}`);
    }
    expect(seen).toEqual(['question:Tbank', 'open:true', 'closed:true']); expect(state.tradeChat).toEqual(['[Tbank] hola']);
  });
  it('trade/invitation-declined (responder): only the question arrives, no window', () => {
    const state = replay(load('trade/invitation-declined-responder'));
    expect(state).toMatchObject({ tradeOpen: false }); expect(state.question).toBeDefined();
  });
});
