import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClientPacketId as C, decodeServerPacket, CraftingClientPacketId as CC, CraftingServerPacketId as CS, ExtractionSkill, ServerPacketId as S, SpellClientPacketId as SC, SpellServerPacketId as SS, FrameDecoder, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { parseIni } from '../src/assets.js';
import { MAX_CRAFT_SLOTS, MSG_BEGIN_WORK, MSG_QUANTITY_ZERO, MSG_START_WORK, MSG_STOP_WORK } from '../src/crafting.js';
import { carpenterMaterials, smithMaterials, splitDefenses } from '../src/crafting-recipes.js';
import { Session } from '../src/session.js';
import { MSG_CLICK_FORGE, MSG_CLICK_WORK } from '../src/spells.js';

const BUILD_WORK = 1100;
function harness() {
  let now = 0;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, { ...f.Intervals, buildWork: BUILD_WORK }, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged,
    { ...f.UpdateSta, stamina: 60 } as ServerPacket);
  const clientPackets = () => { const d = new FrameDecoder(); return sent.flatMap(b => d.push(b)).map(decodeClientPacket); };
  const since = (count: number) => clientPackets().slice(count);
  return { session, recv, clientPackets, since, advance: (ms: number) => { now += ms; } };
}

describe('smith and carpenter lists (server -> state)', () => {
  it('keeps what the server may build and opens the station form it asked for', () => {
    const h = harness();
    h.recv({ id: CS.BlacksmithWeapons, objects: [387, 388] }, { id: CS.BlacksmithArmors, objects: [400, 401, 402] }, { id: CS.BlacksmithExtraObjects, objects: [9] },
      { id: CS.ShowBlacksmithForm });
    const state = h.session.craftingState;
    expect([state.smithWeapons, state.smithDefenses, state.smithRunes, state.open]).toEqual([[387, 388], [400, 401, 402], [9], 'smith']);
    h.recv({ id: CS.CarpenterObjects, objects: [198] }, { id: CS.ShowCarpenterForm });
    expect([state.carpenter, state.open]).toEqual([[198], 'carpenter']);
    h.recv({ id: CS.AlquimistaObj, objects: [5] }, { id: CS.ShowAlquimiaForm }); expect([state.alchemy, state.open]).toEqual([[5], 'alchemy']);
    h.recv({ id: CS.SastreObj, objects: [6] }, { id: CS.ShowSastreForm }); expect([state.tailor, state.open]).toEqual([[6], 'tailor']);
    h.recv(f.ChangeMap); expect(state.open).toBeUndefined();
  });
  it('a refreshed list replaces the old one (the VB6 arrays are cleared past the count)', () => {
    const h = harness();
    h.recv({ id: CS.BlacksmithWeapons, objects: [1, 2, 3] }, { id: CS.BlacksmithWeapons, objects: [7] });
    expect(h.session.craftingState.smithWeapons).toEqual([7]);
  });
  it('splits the defence list by object type like HandleBlacksmithArmors', () => {
    const types: Record<number, number> = { 1: 3, 2: 17, 3: 16, 4: 35, 5: 21, 6: 30, 7: 100, 8: 2 };
    expect(splitDefenses([1, 2, 3, 4, 5, 6, 7, 8], object => types[object] ?? 0)).toEqual({ armors: [1], helmets: [2], shields: [3, 4, 5, 6, 7] });
    expect(splitDefenses([1, 0, 2], object => types[object] ?? 0)).toEqual({ armors: [1], helmets: [], shields: [] }); // Index = 0 ends the list
  });
  it('lists only the materials an object needs, in the VB6 order, and always both woods for the carpenter', () => {
    const ini = parseIni('[OBJ387]\nLingH=100\nLingO=3\nCoal=2\nMadera=50\nMaderaElfica=0\n[OBJ9]\nWaterEssence=1\n');
    expect(smithMaterials(ini, 387)).toEqual([{ name: 'Lingote de hierro', amount: 100 }, { name: 'Lingote de oro', amount: 3 }, { name: 'Carbón', amount: 2 }]);
    expect(smithMaterials(ini, 9)).toEqual([{ name: 'Esencia de agua', amount: 1 }]);
    expect(carpenterMaterials(ini, 387)).toEqual([{ name: 'Leña', amount: 50 }, { name: 'Leña élfica', amount: 0 }]);
  });
});

describe('building', () => {
  it('a single smith build is one CraftBlacksmith; more than one starts the macro (frmHerrero.cmdConstruir_Click)', () => {
    const h = harness(), before = h.clientPackets().length;
    expect(h.session.crafting.buildSmith(387, 1)).toBe(true);
    expect(h.since(before)).toEqual([{ id: CC.CraftBlacksmith, object: 387 }]);
    h.session.crafting.buildSmith(388, 3);
    expect(h.session.crafting.macro).toMatchObject({ active: true, type: 4, object: 388, remaining: 3, intervalMs: BUILD_WORK });
    expect(h.session.ui.messages.at(-1)?.text).toBe(MSG_BEGIN_WORK);
    expect(h.since(before)).toHaveLength(1); // nothing is sent until the timer fires
  });
  it('the macro timer sends one build per BuildWork period, then stops with FlagTrabajar', () => {
    const h = harness(); h.session.crafting.buildSmith(388, 2);
    const before = h.clientPackets().length;
    h.advance(BUILD_WORK - 1); h.session.crafting.tick(); expect(h.since(before)).toHaveLength(0);
    h.advance(1); h.session.crafting.tick(); h.advance(BUILD_WORK); h.session.crafting.tick();
    expect(h.since(before)).toEqual([{ id: CC.CraftBlacksmith, object: 388 }, { id: CC.CraftBlacksmith, object: 388 }]);
    h.advance(BUILD_WORK); h.session.crafting.tick(); // amount spent: ResetearUserMacro
    expect(h.since(before).at(-1)).toEqual({ id: CC.FlagTrabajar });
    expect(h.session.crafting.macro.active).toBe(false);
    expect(h.session.ui.messages.at(-1)?.text).toBe(MSG_STOP_WORK);
  });
  it('the macro also stops when stamina is gone', () => {
    const h = harness(); h.session.crafting.buildAlchemy(5, 9);
    h.recv({ ...f.UpdateSta, stamina: 0 } as ServerPacket); h.advance(BUILD_WORK); h.session.crafting.tick();
    expect(h.clientPackets().at(-1)).toEqual({ id: CC.FlagTrabajar });
  });
  it('alchemy and tailor macros send their own packets', () => {
    const h = harness(); h.session.crafting.buildAlchemy(5, 2); h.advance(BUILD_WORK); h.session.crafting.tick();
    h.session.crafting.reset(); h.session.crafting.buildTailor(6, 2); h.advance(BUILD_WORK); h.session.crafting.tick();
    expect(h.clientPackets().filter(p => p.id === CC.CraftAlquimista || p.id === CC.CraftSastre)).toEqual([{ id: CC.CraftAlquimista, object: 5 }, { id: CC.CraftSastre, object: 6 }]);
  });
  it('the carpenter sends the amount and the server owns the repetition; 0 is refused locally', () => {
    const h = harness(), before = h.clientPackets().length;
    h.session.crafting.buildCarpenter(198, 5); h.session.crafting.buildCarpenter(198, 0);
    expect(h.since(before)).toEqual([{ id: CC.CraftCarpenter, object: 198, amount: 5 }]);
    expect(h.session.ui.messages.map(m => m.text).slice(-2)).toEqual([MSG_BEGIN_WORK, MSG_QUANTITY_ZERO]);
  });
  it('MacroTrabajoToggle on starts the type 6 macro; off is ResetearUserMacro (FlagTrabajar + message)', () => {
    const h = harness(), before = h.clientPackets().length;
    h.recv({ id: CS.MacroTrabajoToggle, active: true });
    expect(h.session.craftingState.workActive).toBe(true);
    expect(h.session.crafting.macro).toMatchObject({ active: true, type: 6, remaining: 999 });
    expect(h.session.ui.messages.at(-1)?.text).toBe(MSG_START_WORK);
    h.advance(BUILD_WORK * 3); h.session.crafting.tick(); expect(h.since(before)).toHaveLength(0); // the VB6 type 6 body is empty
    h.recv({ id: CS.MacroTrabajoToggle, active: false });
    expect(h.since(before)).toEqual([{ id: CC.FlagTrabajar }]);
    expect(h.session.crafting.macro.active).toBe(false);
  });
  it('a station form shown while the work macro key is on re-sends the last build instead of opening', () => {
    const h = harness(); h.session.crafting.macroEnabled = true; h.session.crafting.buildSmith(387, 1);
    const before = h.clientPackets().length;
    h.recv({ id: CS.BlacksmithWeapons, objects: [387] }, { id: CS.ShowBlacksmithForm });
    expect(h.session.craftingState.open).toBeUndefined();
    expect(h.since(before)).toEqual([{ id: CC.CraftBlacksmith, object: 387 }]);
  });
});

describe('work clicks (WorkRequestTarget -> StartAutomatedAction)', () => {
  it.each([[ExtractionSkill.Talar], [ExtractionSkill.Mineria], [ExtractionSkill.Pescar], [ExtractionSkill.Smelting]])('skill %i asks the server for an automated action with no counter', skill => {
    const h = harness(); h.recv({ id: SS.WorkRequestTarget, skill, area: false, radius: 0 });
    expect(h.session.ui.messages.at(-1)?.text).toBe(skill === ExtractionSkill.Smelting ? MSG_CLICK_FORGE : MSG_CLICK_WORK);
    const before = h.clientPackets().length;
    expect(h.session.spells.click(38, 71)).toBe(true);
    expect(h.since(before)).toEqual([{ id: CC.StartAutomatedAction, x: 38, y: 71, skill }]);
    expect(h.session.spells.targeting).toBeUndefined();
    expect(h.session.counters.current('workLeftClick')).toBe(0); // the shared WorkLeftClick counter was not spent
  });
  it('magic keeps WorkLeftClick and its shared counter', () => {
    const h = harness(); h.recv({ id: SS.WorkRequestTarget, skill: 1, area: false, radius: 0 });
    h.session.spells.click(5, 6);
    expect(h.clientPackets().at(-1)).toEqual({ id: SC.WorkLeftClick, x: 5, y: 6, skill: 1, counter: 1 });
  });
});

describe('the generic crafting station (frmCrafteo)', () => {
  it('OpenCrafting empties every slot; items, catalyst and result follow the server', () => {
    const h = harness();
    h.recv({ id: CS.OpenCrafting, type: 2 });
    h.recv({ id: CS.CraftingItem, slot: 1, object: 100 }, { id: CS.CraftingItem, slot: 3, object: 101 }, { id: CS.CraftingCatalyst, object: 520, amount: 3, percent: 90 },
      { id: CS.CraftingResult, object: 900, percent: 70, price: 3000 });
    const state = h.session.craftingState;
    expect([state.open, state.craftingType, [...state.craftItems]]).toEqual(['crafting', 2, [[1, 100], [3, 101]]]);
    expect([state.catalyst, state.catalystPercent, state.result]).toEqual([{ object: 520, amount: 3 }, 90, { object: 900, percent: 70, price: 3000 }]);
    h.recv({ id: CS.CraftingItem, slot: 1, object: 0 }, { id: CS.CraftingCatalyst, object: 0, amount: 0, percent: 0 }, { id: CS.CraftingResult, object: 0 });
    expect([[...state.craftItems], state.catalyst, state.result]).toEqual([[[3, 101]], undefined, undefined]);
    h.recv({ id: CS.OpenCrafting, type: 1 }); expect([state.craftItems.size, state.result]).toEqual([0, undefined]);
    expect(() => h.recv({ id: CS.CraftingItem, slot: MAX_CRAFT_SLOTS + 1, object: 1 })).toThrow(/crafting slot/);
  });
  it('sends the station packets with the VB6 field order and closes locally', () => {
    const h = harness(), before = h.clientPackets().length, c = h.session.crafting;
    h.recv({ id: CS.OpenCrafting, type: 1 });
    c.addCraftItem(4); c.removeCraftItem(2); c.moveCraftItem(1, 3); c.addCatalyst(7); c.removeCatalyst(); c.craft(); c.closeCrafting();
    expect(h.since(before)).toEqual([
      { id: CC.AddItemCrafting, inventorySlot: 4, craftSlot: 0 }, { id: CC.RemoveItemCrafting, craftSlot: 2, inventorySlot: 0 }, { id: CC.MoveCraftItem, drag: 1, drop: 3 },
      { id: CC.AddCatalyst, inventorySlot: 7 }, { id: CC.RemoveCatalyst, inventorySlot: 0 }, { id: CC.CraftItem }, { id: CC.CloseCrafting },
    ]);
    expect(h.session.craftingState.open).toBeUndefined();
  });
  it('work-only requests and the special fish', () => {
    const h = harness(), before = h.clientPackets().length, c = h.session.crafting;
    h.recv({ id: CS.PelearConPezEspecial }); expect(h.session.craftingState.specialFish).toBe(true);
    c.finishSpecialFish(); c.completeAction(3); c.breakRod(); c.repeatMacro();
    expect(h.since(before)).toEqual([{ id: CC.FinalizarPescaEspecial }, { id: CC.CompletarAccion, action: 3 }, { id: CC.RomperCania }, { id: CC.RepeatMacro }]);
    expect(h.session.craftingState.specialFish).toBe(false);
  });
  it('none of these client packets can be built with a counter, so they never touch the shared counters', () => {
    const h = harness(); const before = JSON.stringify(['castSpell', 'workLeftClick', 'leftClick', 'work'].map(f => h.session.counters.current(f as 'work')));
    h.session.crafting.buildSmith(1, 1); h.session.crafting.buildCarpenter(1, 1); h.session.crafting.craft();
    expect(JSON.stringify(['castSpell', 'workLeftClick', 'leftClick', 'work'].map(f => h.session.counters.current(f as 'work')))).toBe(before);
    expect(h.clientPackets().some(p => p.id === C.LoginAccount)).toBe(true);
  });
});

describe('client conformance against the VB6 recording tests/fixtures/vb6/crafting/build-refused', () => {
  it('replays the server side: every refused build ends the work macro with FlagTrabajar, the carpenter one first starts it', () => {
    const h = harness();
    const lines = readFileSync(new URL('../../../tests/fixtures/vb6/crafting/build-refused.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { dir: string; hex: string });
    const before = h.clientPackets().length, states: boolean[] = [];
    for (const line of lines.filter(l => l.dir === 's2c')) {
      const packet = decodeServerPacket(Uint8Array.from(Buffer.from(line.hex, 'hex')));
      if ('unknown' in packet) continue;
      try { h.session.receive(encodeServerFrame(packet)); } catch { /* unrelated packets of other features need state this harness lacks */ }
      if (packet.id === CS.MacroTrabajoToggle) states.push(h.session.crafting.macro.active);
    }
    expect(states).toEqual([false, true, false]);
    expect(h.since(before).filter(p => p.id === CC.FlagTrabajar)).toHaveLength(2); // one per "off"
  });
});
