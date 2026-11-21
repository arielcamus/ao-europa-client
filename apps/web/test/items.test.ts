import { describe, expect, it } from 'vitest';
import {
  ServerPacketId as S, ClientPacketId as C, ItemsServerPacketId as IS, ItemsClientPacketId as IC, DoorClientPacketId as DC, DoorServerPacketId as DS, GOLD_SLOT,
  FrameDecoder, decodeClientPacket, encodeServerFrame,
} from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { ItemsState } from '../src/items-state.js';
import { Session } from '../src/session.js';
import { ObjectCatalog, itemInfo, usableSuffix } from '../src/object-catalog.js';
import { parseIni } from '../src/assets.js';
import { buffColor, withDots } from '../src/items-ui.js';

const ini = parseIni([
  '[OBJ1]', 'Name=Manzana Roja', 'GrhIndex=10', 'ObjType=1',
  '[OBJ2]', 'Name=Espada Larga', 'GrhIndex=11', 'ObjType=2', 'MinHit=6', 'MaxHit=12',
  '[OBJ3]', 'Name=Arco', 'GrhIndex=12', 'ObjType=2', 'proyectil=1', 'MinHit=2', 'MaxHit=5',
  '[OBJ4]', 'Name=Armadura', 'GrhIndex=13', 'ObjType=3', 'MinDef=4', 'MaxDef=8',
  '[OBJ5]', 'Name=Poción Roja', 'GrhIndex=14', 'ObjType=11',
  '[OBJ6]', 'Name=Llama', 'GrhIndex=15', 'ObjType=1', 'Destruye=1',
  '[OBJ7]', 'Name=Árbol', 'GrhIndex=16', 'ObjType=4',
  '[OBJ8]', 'Name=Carta del Dragón', 'GrhIndex=17', 'ObjType=57', 'CollectibleCardImgPathing=Cartas\\450.png',
].join('\n'));
const catalog = new ObjectCatalog(ini);
const slot = (n: number, object: number, amount: number, equipped = false, value = 10) =>
  ({ ...f.ChangeInventorySlot, slot: n, object, amount, equipped, value });

function playing() {
  let now = 1000;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  session.catalog = catalog;
  for (const packet of [f.Connected, f.AccountCharacterList, { ...f.Intervals, useItemKey: 100, useItemClick: 100, dropItem: 100, leftClick: 100 }, f.ChangeMap, f.CharacterCreate, f.UserCharIndexInServer, f.Logged]) {
    session.receive(encodeServerFrame(packet as ServerPacket));
  }
  sent.length = 0;
  const feed = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  const out = (): ClientPacket[] => {
    const decoder = new FrameDecoder(), packets = sent.flatMap(bytes => decoder.push(bytes)).map(decodeClientPacket) as ClientPacket[];
    sent.length = 0; return packets;
  };
  return { session, feed, out, advance: (ms: number) => { now += ms; } };
}

describe('ground objects (the doors store: session.mapObjects)', () => {
  it('creates, replaces and deletes objects by tile, clears them on a map change and ignores off-map tiles', () => {
    const { session, feed } = playing();
    feed({ id: DS.ObjectCreate, x: 50, y: 60, objIndex: 7, amount: 1, elementalTags: 0 }, { id: DS.ObjectCreate, x: 51, y: 60, objIndex: 1, amount: 9, elementalTags: 4 });
    expect(session.mapObjects.objectAt(50, 60)).toEqual({ id: DS.ObjectCreate, x: 50, y: 60, objIndex: 7, amount: 1, elementalTags: 0 });
    feed({ id: DS.ObjectCreate, x: 51, y: 60, objIndex: 1, amount: 3, elementalTags: 4 });
    expect(session.mapObjects.objectAt(51, 60)?.amount).toBe(3);
    feed({ id: DS.ObjectDelete, x: 50, y: 60 });
    expect(session.mapObjects.objectAt(50, 60)).toBeUndefined();
    feed({ id: DS.ObjectCreate, x: 0, y: 1, objIndex: 1, amount: 1, elementalTags: 0 }); // the VB6 client would index outside MapData: ignored
    expect(session.mapObjects.objects.size).toBe(1);
    feed(f.ChangeMap);
    expect(session.mapObjects.objects.size).toBe(0);
  });
});

describe('shop state', () => {
  it('collects NPC slots before CommerceInit opens the window and clears on CommerceEnd', () => {
    const state = new ItemsState();
    state.receive({ id: IS.ChangeNPCInventorySlot, slot: 1, object: 5, amount: 20, value: 150, elementalTags: 0, canUse: 0 });
    state.receive({ id: IS.ChangeNPCInventorySlot, slot: 2, object: 0, amount: 0, value: 0, elementalTags: 0, canUse: 0 });
    expect(state.shopOpen).toBe(false);
    state.receive({ id: IS.CommerceInit, npcName: 'Comerciante' });
    expect(state.shopOpen).toBe(true); expect(state.shopName).toBe('Comerciante');
    expect([...state.shopSlots.keys()]).toEqual([1]);
    state.receive({ id: IS.CommerceEnd });
    expect(state.shopOpen).toBe(false); expect(state.shopSlots.size).toBe(0);
  });
  it('tracks strength/agility, bonuses and the action intervals', () => {
    const state = new ItemsState();
    state.receive({ id: IS.FYA, strength: 20, agility: 18, drugCounter: 120, strengthBase: 18, agilityBase: 18 });
    state.receive({ id: IS.UpdateDM, value: 7 }); state.receive({ id: IS.UpdateRM, value: 3 });
    state.receive({ ...f.Intervals, dropItem: 1, useItemKey: 2, useItemClick: 3, leftClick: 4 });
    expect(state.attributes).toMatchObject({ strength: 20, agilityBase: 18, drugCounter: 120 });
    expect([state.damageBonus, state.resistanceBonus, state.intervals]).toEqual([7, 3, { dropItem: 1, useItemKey: 2, useItemClick: 3 }]); // LeftClick pacing is the session's (shared with doors/look-at)
  });
});

describe('item actions', () => {
  it('uses the selected slot with the key (UseItemU) and a click (UseItem), each with its own increasing counter', () => {
    const { session, feed, out, advance } = playing();
    feed(slot(1, 5, 3));
    expect(session.itemActions.useKey(1)).toBe(true);
    expect(session.itemActions.useKey(1)).toBe(false); // paced by the server interval
    advance(150);
    expect(session.itemActions.useKey(1)).toBe(true);
    expect(session.itemActions.activate(1)).toBe(true); // a potion is just used
    expect(out()).toEqual([
      { id: IC.UseItemU, slot: 1, counter: 1 }, { id: IC.UseItemU, slot: 1, counter: 2 },
      { id: IC.UseItem, slot: 1, fromInventory: true, counter: 1 },
    ]);
    expect(session.itemActions.useKey(9)).toBe(false); // empty slot
  });
  it('double click equips gear and uses it again when equipped, like UserOrEquipItem', () => {
    const { session, feed, out, advance } = playing();
    feed(slot(1, 4, 1), slot(2, 2, 1, true), slot(3, 3, 1, true), slot(4, 3, 1, false));
    expect(session.itemActions.activate(1)).toBe(true);   // armour not equipped -> equip
    expect(session.itemActions.activate(2)).toBe(false);  // equipped melee weapon -> nothing
    advance(150); expect(session.itemActions.activate(3)).toBe(true); // equipped bow -> UseItem (target request)
    expect(session.itemActions.activate(4)).toBe(true);   // a bow in the pack is equipped
    expect(out()).toEqual([
      { id: IC.EquipItem, slot: 1, skin: false, counter: 1 },
      { id: IC.UseItem, slot: 3, fromInventory: true, counter: 1 },
      { id: IC.EquipItem, slot: 4, skin: false, counter: 2 },
    ]);
  });
  it('a collectible card only opens the viewer; "add to collection" (not the double click) sends UseItem, cancel sends nothing (frmCollectibleCard)', () => {
    const { session, feed, out, advance } = playing();
    feed(slot(1, 8, 1));
    expect(catalog.get(8)?.cardImage).toBe('Cartas\\450.png');
    expect(session.itemActions.activate(1)).toBe(true);
    expect(session.items.card).toEqual({ slot: 1 }); expect(out()).toEqual([]);
    session.itemActions.cancelCard(); expect(session.items.card).toBeUndefined(); expect(out()).toEqual([]);
    session.itemActions.activate(1); advance(150);
    expect(session.itemActions.acceptCard()).toBe(true); expect(session.items.card).toBeUndefined();
    expect(out()).toEqual([{ id: IC.UseItem, slot: 1, fromInventory: true, counter: 1 }]);
  });
  it('drops at the user tile, gold through pseudo slot 200, and asks before sending in a shop or when dead', () => {
    const { session, feed, out, advance } = playing();
    feed(slot(1, 1, 5), { id: S.UpdateGold, gold: 500, goldPerLevel: 100 });
    expect(session.itemActions.dropNeedsAmount(1)).toBe(true);
    expect(session.itemActions.dropNeedsAmount(GOLD_SLOT)).toBe(true);
    const { x, y } = session.position!;
    expect(session.itemActions.drop(1, 2)).toBe(true);
    advance(150); expect(session.itemActions.drop(GOLD_SLOT, 100)).toBe(true);
    expect(out()).toEqual([
      { id: IC.Drop, slot: 1, amount: 2, counter: 1, x, y }, { id: IC.Drop, slot: GOLD_SLOT, amount: 100, counter: 2, x, y },
    ]);
    advance(150); feed({ id: S.UpdateHP, hp: 0, shield: 0 });
    expect(session.itemActions.drop(1, 1)).toBe(false);
    expect(session.ui.messages.at(-1)?.text).toBe('¡Estás muerto!');
    expect(out()).toEqual([]);
  });
  it('knows which objects are destroyed when dropped', () => {
    const { session, feed } = playing();
    feed(slot(1, 6, 1), slot(2, 1, 1));
    expect(session.itemActions.destroys(1)).toBe(true); expect(session.itemActions.destroys(2)).toBe(false);
    expect(session.itemActions.destroys(GOLD_SLOT)).toBe(false);
  });
  it('picks up at the user tile with destination slot 0', () => {
    const { session, out } = playing();
    const { x, y } = session.position!;
    expect(session.itemActions.pickUp()).toBe(true);
    expect(out()).toEqual([{ id: IC.PickUp, x, y, slot: 0 }]);
  });
});

describe('NPC commerce', () => {
  const open = () => {
    const ctx = playing();
    ctx.feed(slot(1, 1, 8, false, 4), { id: S.UpdateGold, gold: 300, goldPerLevel: 100 },
      { id: IS.ChangeNPCInventorySlot, slot: 1, object: 5, amount: 20, value: 150, elementalTags: 0, canUse: 0 }, { id: IS.CommerceInit, npcName: 'Boticario' });
    return ctx;
  };
  it('clicks the NPC with a LeftClick counter, then buys, sells, and closes with CommerceEnd', () => {
    const { session, out, advance } = playing();
    // The shop opens on the session's LeftClick (one map-click handler, shared counter).
    expect(session.leftClick(60, 61)).toBe(true);
    advance(250); expect(session.leftClick(60, 61)).toBe(true);
    expect(out()).toEqual([{ id: DC.LeftClick, x: 60, y: 61, counter: 1 }, { id: DC.LeftClick, x: 60, y: 61, counter: 2 }]);
    const shop = open();
    expect(shop.session.items.shopOpen).toBe(true);
    expect(shop.session.itemActions.buy(1, 2)).toBe(true);        // 300 gold covers 2 x 150
    expect(shop.session.itemActions.buy(1, 3)).toBe(false);       // 450 is too much
    expect(shop.session.ui.messages.at(-1)?.text).toBe('No tienes suficiente oro.');
    expect(shop.session.itemActions.sell(1, 99)).toBe(true);      // clamps to the stack, like cmdVender
    shop.advance(1000); expect(shop.session.leftClick(1, 1)).toBe(false); // no map clicks while trading
    expect(shop.session.itemActions.pickUp()).toBe(false);
    expect(shop.session.itemActions.closeShop()).toBe(true);
    expect(shop.session.items.shopOpen).toBe(false);
    expect(shop.out()).toEqual([{ id: IC.CommerceBuy, slot: 1, amount: 2 }, { id: IC.CommerceSell, slot: 1, amount: 8 }, { id: IC.CommerceEnd }]);
  });
  it('double click inside the shop still equips or uses', () => {
    const { session, feed, out } = open();
    feed(slot(2, 4, 1));
    expect(session.itemActions.activate(2)).toBe(false);
    expect(session.itemActions.activate(2, true)).toBe(true);
    expect(out()).toEqual([{ id: IC.EquipItem, slot: 2, skin: false, counter: 1 }]);
  });
});

describe('catalog and display helpers', () => {
  it('reads object data and the shop description lines', () => {
    expect(catalog.get(2)).toMatchObject({ name: 'Espada Larga', type: 2, minHit: 6, maxHit: 12 });
    expect(catalog.get(99)).toBeUndefined();
    expect(itemInfo(catalog.get(2))).toBe('Golpe: 6/12'); expect(itemInfo(catalog.get(4))).toBe('Defensa: 4/8');
    expect(usableSuffix(0)).toBe(' (Usable)'); expect(usableSuffix(6)).toBe(' (No usa: Nivel)');
  });
  it('formats gold with dots and colours buffed attributes like GetBuffColor', () => {
    expect(withDots(1234567)).toBe('1.234.567'); expect(withDots(12)).toBe('12');
    expect(buffColor(18, 18)).toBe('#fff'); expect(buffColor(36, 18)).toBe('rgb(204,0,0)');
  });
});

import { elementalTagIcons } from '../src/classic-ui.js';
describe('elemental tag icons (clsGrapchicalInventory.DrawInventory)', () => {
  it('draws the set tags in the fixed order Fire, Water, Earth, Wind with their icon graphics', () => {
    expect(elementalTagIcons(0)).toEqual([]);
    expect(elementalTagIcons(1 | 8).map(i => i.grh)).toEqual([10484, 10485]);
    expect(elementalTagIcons(15).map(i => i.grh)).toEqual([10484, 10486, 10483, 10485]);
  });
});
