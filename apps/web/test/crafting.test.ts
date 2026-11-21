import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ClientPacketId as C, decodeServerPacket, CraftingClientPacketId as CC, CraftingServerPacketId as CS, ExtractionSkill, ServerPacketId as S, SpellClientPacketId as SC, SpellServerPacketId as SS, FrameDecoder, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { parseIni } from '../src/assets.js';
import { MAX_CRAFT_SLOTS, MSG_BEGIN_WORK, MSG_QUANTITY_ZERO, MSG_START_WORK, MSG_STOP_WORK } from '../src/crafting.js';
import { alchemyMaterials, carpenterMaterials, smithMaterials, splitDefenses, splitTailor, tailorMaterials } from '../src/crafting-recipes.js';
import { MSG_FISH_BROKE } from '../src/fishing.js';
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
  it('a station form shown after a build opens again: frmMain.macrotrabajo is never enabled in the pinned client, so nothing is re-sent', () => {
    const h = harness(); h.session.crafting.buildSmith(387, 1); h.session.crafting.buildAlchemy(5, 1);
    const before = h.clientPackets().length;
    h.recv({ id: CS.BlacksmithWeapons, objects: [387] }, { id: CS.ShowBlacksmithForm });
    expect(h.session.craftingState.open).toBe('smith');
    h.recv({ id: CS.AlquimistaObj, objects: [5] }, { id: CS.ShowAlquimiaForm });
    expect(h.session.craftingState.open).toBe('alchemy');
    expect(h.since(before)).toEqual([]);
  });
  it('a tailor build with no row selected sends object 0 like FrmSastre (SastreRopas(0).Index); smith and alchemy refuse it locally', () => {
    const h = harness(), before = h.clientPackets().length;
    expect(h.session.crafting.buildTailor(0, 1)).toBe(true);
    expect(h.session.crafting.buildAlchemy(0, 1)).toBe(false);
    expect(h.since(before)).toEqual([{ id: CC.CraftSastre, object: 0 }]);
  });
  it('the tailor clothes macro prints the empty line of its misspelt language key; hats print the real message', () => {
    const h = harness();
    h.session.crafting.buildTailor(6, 3, ''); expect(h.session.ui.messages.at(-1)?.text).toBe('');
    h.session.crafting.reset(); h.session.crafting.buildTailor(7, 3); expect(h.session.ui.messages.at(-1)?.text).toBe(MSG_BEGIN_WORK);
  });
});

describe('work macro and movement', () => {
  it('a step cancels a running macro first: FlagTrabajar, the stop message, then Walk (MoveTo -> ResetearUserMacro)', () => {
    const h = harness(); h.session.crafting.buildSmith(388, 3);
    h.advance(1000); expect(h.session.walk(2)).toBe(true);
    const sent = h.clientPackets().slice(-3).map(p => p.id);
    expect(sent).toEqual([CC.FlagTrabajar, C.Walk, C.RequestPositionUpdate]);
    expect(h.session.crafting.macro.active).toBe(false);
    expect(h.session.ui.messages.at(-1)?.text).toBe(MSG_STOP_WORK);
  });
  it('the server-driven work macro (MacroTrabajoToggle on) is cancelled by a step too', () => {
    const h = harness(); h.recv({ id: CS.MacroTrabajoToggle, active: true });
    h.advance(1000); h.session.walk(2);
    expect(h.clientPackets().filter(p => p.id === CC.FlagTrabajar)).toHaveLength(1);
  });
  it('a step with no macro sends no FlagTrabajar', () => {
    const h = harness(); h.advance(1000); h.session.walk(2);
    expect(h.clientPackets().some(p => p.id === CC.FlagTrabajar)).toBe(false);
  });
  it('BuildWork 0 (a VB6 Timer with Interval 0) never sends', () => {
    const h = harness(); h.recv({ ...f.Intervals, buildWork: 0 }); h.session.crafting.buildSmith(388, 3);
    const before = h.clientPackets().length; h.advance(100000); h.session.crafting.tick();
    expect(h.clientPackets().slice(before)).toEqual([]); expect(h.session.crafting.macro.remaining).toBe(3);
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const revision = state.revision;
    for (const slot of [0, MAX_CRAFT_SLOTS + 1]) h.recv({ id: CS.CraftingItem, slot, object: 1 }); // logged and ignored, the session survives
    expect(warn).toHaveBeenCalledTimes(2); expect([state.craftItems.size, state.revision]).toEqual([0, revision]); warn.mockRestore();
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

describe('client conformance against the real smith / alchemy / tailor / carpenter recordings', () => {
  const replay = (name: string) => {
    const h = harness(), seen: (string | undefined)[] = [];
    const lines = readFileSync(new URL(`../../../tests/fixtures/vb6/crafting/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { dir: string; hex: string });
    for (const line of lines.filter(l => l.dir === 's2c')) {
      const packet = decodeServerPacket(Uint8Array.from(Buffer.from(line.hex, 'hex')));
      if ('unknown' in packet) continue;
      try { h.session.receive(encodeServerFrame(packet)); } catch { /* login-time packets this harness has no state for */ }
      if ([CS.ShowBlacksmithForm, CS.ShowCarpenterForm, CS.ShowAlquimiaForm, CS.ShowSastreForm].includes(packet.id as never)) seen.push(h.session.craftingState.open);
    }
    return { h, seen };
  };
  it('the lists and the four forms land in state as the server sent them', () => {
    const { h, seen } = replay('smith-alchemy-tailor-build'), state = h.session.craftingState;
    expect([state.smithWeapons.length, state.smithDefenses.length, state.smithRunes.length, state.alchemy.length, state.tailor.length]).toEqual([33, 37, 4, 7, 33]);
    expect(state.smithWeapons.slice(0, 3)).toEqual([3980, 165, 365]);
    expect(seen).toEqual(['smith', 'alchemy', 'tailor']);
  });
  it('the carpenter list (Byte count) and form', () => {
    const { h, seen } = replay('smith-refused-carpenter-build');
    expect([h.session.craftingState.carpenter.length, seen]).toEqual([31, ['smith', 'carpenter']]);
    expect(h.session.craftingState.carpenter.slice(0, 2)).toEqual([163, 479]);
  });
  it('a carpenter build recording turns the macro on, and the server ending it sends FlagTrabajar from the client', () => {
    const { h } = replay('carpenter-craft-walk-south');
    expect(h.session.crafting.macro.active).toBe(false);
    expect(h.clientPackets().filter(p => p.id === CC.FlagTrabajar)).toHaveLength(1);
  });
});

describe('alchemy and tailor recipes (Obj.dat)', () => {
  const ini = parseIni('[OBJ50]\nRaices=2\nBotella=1\nFlorOceano=3\nPimiento=0\n[OBJ60]\nPielLobo=4\nPielTigre=1\nPielLoboNegro=2\n');
  it('lists only the ingredients an alchemy object needs, in the form order, with FlorOceano by its own key', () => {
    expect(alchemyMaterials(ini, 50)).toEqual([{ name: 'Raices', amount: 2 }, { name: 'Botella', amount: 1 }, { name: 'FlorOceano', amount: 3 }]);
  });
  it('always lists all six skins for the tailor, zero amounts included', () => {
    expect(tailorMaterials(ini, 60)).toEqual([
      { name: 'Piel de Lobo', amount: 4 }, { name: 'Piel de Oso Pardo', amount: 0 }, { name: 'Piel de Oso Polar', amount: 0 }, { name: 'Piel de Lobo Negro', amount: 2 },
      { name: 'Piel de Tigre', amount: 1 }, { name: 'Piel de Tigre Bengala', amount: 0 }]);
  });
  it('splits clothes (types 3 and 100) from hats (17) and stops at the first 0, like HandleSastreObjects', () => {
    const types: Record<number, number> = { 1: 3, 2: 17, 3: 100, 4: 2 };
    expect(splitTailor([1, 2, 3, 4, 0, 1], object => types[object] ?? 0)).toEqual({ clothes: [1, 3], hats: [2] });
  });
});

describe('work prompts print with the explicit RGB the VB6 client uses', () => {
  const rgbLines = (h: ReturnType<typeof harness>) => h.session.ui.messages.filter(m => m.line?.kind === 'rgb').map(m => m.line);
  it('server work on (green bold), off (red bold) and a build macro (blue bold italic)', () => {
    const h = harness();
    h.recv({ id: CS.MacroTrabajoToggle, active: true }, { id: CS.MacroTrabajoToggle, active: false });
    h.session.crafting.buildSmith(5, 3);
    expect(rgbLines(h)).toEqual([
      { kind: 'rgb', message: MSG_START_WORK, color: [2, 223, 51], bold: true, italic: false },
      { kind: 'rgb', message: MSG_STOP_WORK, color: [223, 51, 2], bold: true, italic: false },
      { kind: 'rgb', message: MSG_BEGIN_WORK, color: [2, 51, 223], bold: true, italic: true },
    ]);
  });
});

describe('the special fish fight', () => {
  const start = () => { const h = harness(); h.recv({ id: CS.PelearConPezEspecial }); return h; };
  it('starts with the marker at 1, no tries and the overhead line over the player', () => {
    const h = start(), fishing = h.session.craftingState.fishing;
    expect([fishing.active, fishing.position, fishing.direction, fishing.attempts]).toEqual([true, 1, 1, [0, 0, 0, 0, 0, 0]]);
    expect(h.session.ui.chat.visibleDialogs().some(d => d.dialog.text.includes('presiona la tecla P'))).toBe(true);
  });
  it('the marker sweeps 0.2 px per ms, turns at 199 and only then allows a try', () => {
    const fishing = start().session.craftingState.fishing;
    fishing.frame(0, 500); expect(fishing.position).toBeCloseTo(101); expect(fishing.press()).toBeUndefined(); // no end reached yet
    for (let i = 0; i < 10; i++) fishing.frame(i * 100, 100);
    expect(fishing.direction).toBe(-1); expect(fishing.canTry).toBe(true);
  });
  it('three hits land the fish with FinalizarPescaEspecial; the green zone is 75..126', () => {
    const h = start(), fishing = h.session.craftingState.fishing, before = h.clientPackets().length;
    for (const position of [75, 100, 126]) { fishing.canTry = true; fishing.position = position; h.session.crafting.fishingKey(); }
    expect(fishing.attempts.slice(1, 4)).toEqual([1, 1, 1]);
    expect(h.since(before)).toEqual([{ id: CC.FinalizarPescaEspecial }]);
    expect(fishing.active).toBe(false);
  });
  it('three misses break the line: message in red and RomperCania', () => {
    const h = start(), fishing = h.session.craftingState.fishing, before = h.clientPackets().length;
    for (const position of [10, 74, 127]) { fishing.canTry = true; fishing.position = position; h.session.crafting.fishingKey(); }
    expect(fishing.attempts.slice(1, 4)).toEqual([2, 2, 2]);
    expect(h.since(before)).toEqual([{ id: CC.RomperCania }]);
    expect(h.session.ui.messages.at(-1)?.line).toMatchObject({ kind: 'rgb', message: MSG_FISH_BROKE, color: [255, 0, 0], bold: true });
  });
  it('five tries with fewer than three of either end with FinalizarPescaEspecial (the first branch of the VB6 test wins)', () => {
    const h = start(), fishing = h.session.craftingState.fishing, before = h.clientPackets().length;
    for (const position of [100, 10, 100, 10, 10]) { fishing.canTry = true; fishing.position = position; h.session.crafting.fishingKey(); }
    // the third miss comes on the fifth try, when 5 tries already finish it
    expect(h.since(before)).toEqual([{ id: CC.FinalizarPescaEspecial }]);
  });
  it('20 seconds break the line', () => {
    const h = start(), before = h.clientPackets().length;
    h.advance(20_000); h.session.crafting.tickFishing(16);
    expect(h.since(before)).toEqual([{ id: CC.RomperCania }]); expect(h.session.craftingState.specialFish).toBe(false);
  });
  it('walking away breaks the line first (message and RomperCania before the Walk)', () => {
    const h = start(); h.advance(1000);
    h.recv({ id: S.PosUpdate, x: 50, y: 50 } as ServerPacket);
    const before = h.clientPackets().length;
    h.session.walk(1 as never);
    const sent = h.since(before).map(p => p.id);
    if (sent.includes(C.Walk)) expect(sent.indexOf(CC.RomperCania)).toBeLessThan(sent.indexOf(C.Walk));
    expect(h.session.craftingState.specialFish).toBe(false);
  });
});
