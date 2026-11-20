// AGPL-3.0-or-later. Offline stand-in for the bank / trade UI ONLY (NOT the VB6 oracle): the real server cannot be made to open the
// vault or Goliath for a level-1 character (see tests/fixtures/vb6/bank/README.md), and every starter item is non-tradeable, so item
// offers cannot happen there. This TCP server logs one account in, holds a banker, a vault and an "other player" and answers the bank
// and trade packets with the same packets the VB6 server writes (modBanco.bas, mdlCOmercioConUsuario.bas), field for field.
// Usage: AO_ASSETS=~/Projects/ao-reference/Recursos AO_MOCK_PORT=7745 node tools/bank-trade-mock-server.mjs
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { FrameDecoder, decodeClientPacket, encodeServerFrame, ServerPacketId as S, NpcsServerPacketId as N, BankTradeServerPacketId as BS, BankTradeClientPacketId as BC } from '../packages/protocol/dist/index.js';

const port = Number(process.env.AO_MOCK_PORT ?? 7745);
const assets = process.env.AO_ASSETS ?? `${process.env.HOME}/Projects/ao-reference/Recursos`;
const obj = readFileSync(`${assets}/Dat/Obj.dat`, 'latin1');
const info = id => { const m = new RegExp(`\\[OBJ${id}\\]([^\\[]*)`, 'i').exec(obj); const g = k => new RegExp(`^${k}=(.*)$`, 'im').exec(m?.[1] ?? '')?.[1]?.trim(); return { name: g('Name') ?? `Objeto ${id}`, grh: Number(g('GrhIndex') ?? 0) }; };
const base = { cart: 0, backpack: 0, fx: 0, fxLoops: 0, particleFx: 0, headAura: '', weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '',
  speeding: 1, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0, minHp: 100, maxHp: 100, minMana: 0, maxMana: 0, symbol: 0, flags: 1, userType: 0, team: 0, flag: 0, clanAlignment: 0, privileges: 0 };
const char = (charIndex, name, x, y, extra) => ({ id: S.CharacterCreate, charIndex, name, x, y, heading: 3, weapon: 0, shield: 0, helmet: 0, status: 1, npc: 0, npcNumber: 0, ...base, ...extra });
const me = char(1, 'TBank', 58, 44, { body: 107, head: 1 });
const banker = char(20, 'Krix <Finanzas Goliath>', 60, 42, { body: 117, head: 3, npc: 1, npcNumber: 3 });
const sendAll = (socket, ...packets) => packets.forEach(packet => socket.write(encodeServerFrame(packet)));

net.createServer(socket => {
  const decoder = new FrameDecoder(); let stage = 0;
  let gold = 12500, bankGold = 340000, inBank = false, inTrade = false, accepted = false, asked = false;
  const inventory = new Map([[1, [4335, 500]], [2, [4334, 35]], [3, [3791, 4]], [4, [3684, 95]], [5, [3685, 50]], [6, [4337, 98]], [7, [4338, 117]], [8, [3487, 1]], [9, [3500, 1]]]);
  const vault = new Map([[1, [3492, 650]], [2, [3489, 1]], [10, [3791, 2]]]);
  const offer = { gold: 0, items: Array.from({ length: 6 }, () => ({ object: 0, name: '', grh: 0, amount: 0, elementalTags: 0 })) };
  const invPacket = slot => { const [object, amount] = inventory.get(slot) ?? [0, 0]; return { id: S.ChangeInventorySlot, slot, object, amount, equipped: slot === 8, value: object ? 333.33 : 0, canUse: 0, elementalTags: 0, bindable: false }; };
  const bankPacket = slot => { const [object, amount] = vault.get(slot) ?? [0, 0]; return { id: BS.ChangeBankSlot, slot, object, elementalTags: 0, amount, value: object ? 1000 : 0, canUse: object === 3487 ? 2 : 0 }; };
  const take = (map, slot, amount) => { const e = map.get(slot); if (!e) return undefined; const n = Math.min(amount, e[1]); e[1] -= n; if (e[1] <= 0) map.delete(slot); return [e[0], n]; };
  const put = (map, object, amount, dest, max) => {
    const slot = (dest && (!map.has(dest) || map.get(dest)[0] === object) ? dest : undefined) ?? [...map].find(([, e]) => e[0] === object)?.[0] ?? Array.from({ length: max }, (_, i) => i + 1).find(i => !map.has(i));
    if (!slot) return 0; const e = map.get(slot) ?? [object, 0]; e[1] += amount; map.set(slot, e); return slot;
  };
  sendAll(socket, { id: S.Connected, debugging: true });
  const start = () => {
    sendAll(socket, { id: S.Intervals, hit: 1000, bow: 1000, magic: 1000, extractWork: 1000, buildWork: 1000, walk: 300, dropItem: 100, useItemKey: 100, useItemClick: 100, hitMagic: 1000, magicHit: 1000, hitUseItem: 1000, hide: 1000, talk: 500, leftClick: 100, meditate: 100 },
      { id: S.ChangeMap, map: 1, resourceMap: 1 }, me, banker, { id: S.UserCharIndexInServer, charIndex: 1 },
      { id: S.InventoryUnlockSlots, rows: 0 }, { id: S.UpdateGold, gold, goldPerLevel: 100 }, ...[...inventory.keys()].map(invPacket), { id: S.Logged, newUser: false });
  };
  const sendOffer = () => {
    sendAll(socket, { id: BS.ChangeUserTradeSlot, mine: true, gold: offer.gold, items: offer.items });
    const theirs = [[4337, 'Poción verde', 20], [3489, 'Anillo', 1]].map(([object, , amount]) => ({ object, name: info(object).name, grh: info(object).grh, amount, elementalTags: 0 }));
    sendAll(socket, { id: BS.ChangeUserTradeSlot, mine: false, gold: 250, items: [...theirs, ...Array.from({ length: 4 }, () => ({ object: 0, name: '', grh: 0, amount: 0, elementalTags: 0 }))] });
  };
  socket.on('data', bytes => {
    for (const body of decoder.push(new Uint8Array(bytes))) {
      const p = decodeClientPacket(body); if (process.env.AO_MOCK_LOG) console.log(JSON.stringify(p));
      if (p.id === 305) sendAll(socket, { id: S.AccountCharacterList, characters: [{ id: 1, name: 'TBank', body: 107, head: 1, characterClass: 3, map: 1, x: 58, y: 44, level: 1, status: 1, helmet: 0, shield: 0, weapon: 0, backpack: 0 }] });
      else if (p.id === 73 && !stage++) start();
      else if (p.id === 79) sendAll(socket, { id: S.PosUpdate, x: me.x, y: me.y });   // the client probes its position every 5 s
      else if (p.id === 95) { if (p.x === banker.x && (p.y === banker.y || p.y === banker.y + 1)) sendAll(socket, { id: BS.Goliath, gold: bankGold, items: vault.size }); }
      else if (p.id === BC.BankStart) { for (let i = 1; i <= 42; i++) sendAll(socket, bankPacket(i)); inBank = true; sendAll(socket, { id: BS.BankInit }); }
      else if (p.id === BC.BankEnd && inBank) { inBank = false; sendAll(socket, { id: BS.BankEnd }); }
      else if (p.id === BC.BankDeposit) { const t = take(inventory, p.slot, p.amount); if (t) { const dest = put(vault, t[0], t[1], p.destination, 42); sendAll(socket, invPacket(p.slot), bankPacket(dest)); } }
      else if (p.id === BC.BankExtractItem) { const t = take(vault, p.slot, p.amount); if (t) { const dest = put(inventory, t[0], t[1], p.destination, 24); sendAll(socket, invPacket(dest), bankPacket(p.slot)); } }
      else if (p.id === BC.BovedaMoveItem) { const a = vault.get(p.from), b = vault.get(p.to); a ? vault.set(p.to, a) : vault.delete(p.to); b ? vault.set(p.from, b) : vault.delete(p.from); sendAll(socket, bankPacket(p.from), bankPacket(p.to)); }
      else if (p.id === BC.BankDepositGold) { if (p.amount <= gold) { gold -= p.amount; bankGold += p.amount; sendAll(socket, { id: S.UpdateGold, gold, goldPerLevel: 100 }, { id: BS.UpdateBankGld, gold: bankGold }); } }
      else if (p.id === BC.BankExtractGold) { if (p.amount <= bankGold) { gold += p.amount; bankGold -= p.amount; sendAll(socket, { id: S.UpdateGold, gold, goldPerLevel: 100 }, { id: BS.UpdateBankGld, gold: bankGold }); } }
      else if (p.id === BC.CommerceStart && !asked) { asked = true; sendAll(socket, { id: BS.ShowPregunta, messageId: 1594, param: 'Mock Trader' }); }
      else if (p.id === BC.ResponderPregunta && asked) { asked = false; if (p.accept) { inTrade = true; accepted = false; offer.gold = 0; offer.items.forEach((_, i) => { offer.items[i] = { object: 0, name: '', grh: 0, amount: 0, elementalTags: 0 }; }); sendAll(socket, ...[...inventory.keys()].map(invPacket), { id: BS.UserCommerceInit }); } }
      else if (p.id === BC.UserCommerceOffer && inTrade) {
        if (p.slot === 200) { if (p.amount <= gold) offer.gold += p.amount; }
        else { const e = inventory.get(p.slot); if (e && p.amount <= e[1]) { const free = offer.items.findIndex(i => !i.object); if (free >= 0) offer.items[free] = { object: e[0], name: info(e[0]).name, grh: info(e[0]).grh, amount: p.amount, elementalTags: 0 }; } }
        sendOffer();
      }
      else if (p.id === BC.CommerceSendChatMessage && inTrade) { const text = `[TBank] ${p.message}`; sendAll(socket, { id: BS.CommerceRecieveChatMessage, message: text }, { id: BS.CommerceRecieveChatMessage, message: '[Mock Trader] ¿Te parece bien?' }); }
      else if (p.id === BC.UserCommerceOk && inTrade) { if (accepted) { inTrade = false; sendAll(socket, { id: BS.UserCommerceEnd }); } else { accepted = true; sendAll(socket, { id: N.LocaleMsg, messageId: 1596, text: '', font: 8, channel: 0 }); } }
      else if ((p.id === BC.UserCommerceReject || p.id === BC.UserCommerceEnd) && inTrade) { inTrade = false; sendAll(socket, { id: BS.UserCommerceEnd }); }
    }
  });
  socket.on('error', () => {});
}).listen(port, '127.0.0.1', () => console.log(`bank/trade mock server (NOT the VB6 oracle) on 127.0.0.1:${port}`));
