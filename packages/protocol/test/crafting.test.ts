import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NpcsServerPacketId as NS } from '../src/index.js';
import { CraftingClientPacketId as CC, CraftingServerPacketId as CS, decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, ProtocolError } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

// Hand-built from the VB6 writers' field order (server Protocol_Writes.bas, client Protocol_Writes.bas): id Int16 little endian, then the fields.
const server: [string, string, object][] = [
  ['ShowBlacksmithForm', '0e00', { id: CS.ShowBlacksmithForm }],
  ['ShowCarpenterForm', '0f00', { id: CS.ShowCarpenterForm }],
  ['BlacksmithWeapons (Int16 count, Int16 objects)', '440002008301' + '0010', { id: CS.BlacksmithWeapons, objects: [387, 4096] }],
  ['BlacksmithArmors', '45000100e803', { id: CS.BlacksmithArmors, objects: [1000] }],
  ['BlacksmithExtraObjects (empty list)', '46000000', { id: CS.BlacksmithExtraObjects, objects: [] }],
  ['CarpenterObjects (Byte count, unlike the others)', '4700' + '02' + 'c6000300', { id: CS.CarpenterObjects, objects: [198, 3] }],
  ['AlquimistaObj', '82000100' + '0b00', { id: CS.AlquimistaObj, objects: [11] }],
  ['ShowAlquimiaForm', '8300', { id: CS.ShowAlquimiaForm }],
  ['SastreObj', '84000200010002' + '00', { id: CS.SastreObj, objects: [1, 2] }],
  ['ShowSastreForm', '8500', { id: CS.ShowSastreForm }],
  ['MacroTrabajoToggle on', '870001', { id: CS.MacroTrabajoToggle, active: true }],
  ['MacroTrabajoToggle off', '870000', { id: CS.MacroTrabajoToggle, active: false }],
  ['OpenCrafting', 'a80002', { id: CS.OpenCrafting, type: 2 }],
  ['CraftingItem (slot Byte, object Int16)', 'a90002ef10', { id: CS.CraftingItem, slot: 2, object: 4335 }],
  ['CraftingCatalyst', 'aa00' + '0802' + '0300' + '5a', { id: CS.CraftingCatalyst, object: 520, amount: 3, percent: 90 }],
  ['CraftingResult with an object: percent and price follow', 'ab00' + 'e803' + '46' + 'b80b0000', { id: CS.CraftingResult, object: 1000, percent: 70, price: 3000 }],
  ['CraftingResult 0 stops after the object', 'ab000000', { id: CS.CraftingResult, object: 0 }],
  ['PelearConPezEspecial', 'b000', { id: CS.PelearConPezEspecial }],
];
const client: [string, string, object][] = [
  ['CraftCarpenter (Int16 object, Int32 amount)', '0100' + 'c600' + '05000000', { id: CC.CraftCarpenter, object: 198, amount: 5 }],
  ['CraftBlacksmith', '6400' + '8301', { id: CC.CraftBlacksmith, object: 387 }],
  ['CraftAlquimista', 'e400' + '0b00', { id: CC.CraftAlquimista, object: 11 }],
  ['FlagTrabajar', 'e500', { id: CC.FlagTrabajar }],
  ['CraftSastre', 'e600' + '0100', { id: CC.CraftSastre, object: 1 }],
  ['CompletarAccion', 'e90003', { id: CC.CompletarAccion, action: 3 }],
  ['AddItemCrafting (inventory slot first)', '13010400', { id: CC.AddItemCrafting, inventorySlot: 4, craftSlot: 0 }],
  ['RemoveItemCrafting (craft slot first)', '14010200', { id: CC.RemoveItemCrafting, craftSlot: 2, inventorySlot: 0 }],
  ['AddCatalyst', '150107', { id: CC.AddCatalyst, inventorySlot: 7 }],
  ['RemoveCatalyst', '160100', { id: CC.RemoveCatalyst, inventorySlot: 0 }],
  ['CraftItem', '1701', { id: CC.CraftItem }],
  ['CloseCrafting', '1801', { id: CC.CloseCrafting }],
  ['MoveCraftItem (drag, drop)', '190101' + '03', { id: CC.MoveCraftItem, drag: 1, drop: 3 }],
  ['FinalizarPescaEspecial', '1e01', { id: CC.FinalizarPescaEspecial }],
  ['RomperCania', '1f01', { id: CC.RomperCania }],
  ['RepeatMacro', '2101', { id: CC.RepeatMacro }],
  ['StartAutomatedAction (x, y, skill; no counter)', '3401' + '26' + '47' + '11', { id: CC.StartAutomatedAction, x: 38, y: 71, skill: 17 }],
];

describe('crafting packets: hex goldens from the VB6 writer order', () => {
  for (const [name, wire, packet] of server) {
    it(`server ${name}`, () => {
      expect(decodeServerPacket(bytes(wire))).toEqual(packet);
      expect(hex(encodeServerPacket(packet as never))).toBe(wire);
    });
  }
  for (const [name, wire, packet] of client) {
    it(`client ${name}`, () => {
      expect(decodeClientPacket(bytes(wire))).toEqual(packet);
      expect(hex(encodeClientPacket(packet as never))).toBe(wire);
    });
  }
  it('a list count larger than the frame is refused, never allocated', () => {
    expect(() => decodeServerPacket(bytes('4400ffff'))).toThrow(ProtocolError);
    expect(() => decodeServerPacket(bytes('4700ff'))).toThrow(ProtocolError);
  });
});

// Recordings of the real classic VB6 server (tests/fixtures/vb6/crafting). A level-1 character cannot build or extract, so these hold
// the requests and the server's refusals; the success replies are the hand-built goldens above.
const dir = new URL('../../../tests/fixtures/vb6/crafting/', import.meta.url);
interface Line { t_ms: number; dir: 'c2s' | 's2c'; id: number; name: string; hex: string }
const recordings = readdirSync(dir).filter(name => name.endsWith('.jsonl')).map(name => ({
  name, lines: readFileSync(new URL(name, dir), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Line),
}));
const owned = { s2c: new Set<number>(Object.values(CS)), c2s: new Set<number>(Object.values(CC)) };
const lines = (id: number, side: Line['dir']) => recordings.flatMap(r => r.lines).filter(l => l.id === id && l.dir === side);

describe('crafting packets against real VB6 recordings', () => {
  it('has every scenario', () => {
    expect(recordings.map(r => r.name).sort()).toEqual(['anvil-no-hammer.jsonl', 'automated-action-refused.jsonl', 'build-refused.jsonl', 'complete-action-none.jsonl', 'login.jsonl', 'station-not-open.jsonl']);
  });
  for (const recording of recordings) {
    it(`${recording.name}: every owned packet decodes and re-encodes to the same bytes`, () => {
      for (const line of recording.lines.filter(l => owned[l.dir].has(l.id))) {
        if (line.dir === 's2c') { const p = decodeServerPacket(bytes(line.hex)); expect('unknown' in p).toBe(false); expect(hex(encodeServerPacket(p as never))).toBe(line.hex); }
        else { const p = decodeClientPacket(bytes(line.hex)); expect('unknown' in p).toBe(false); expect(hex(encodeClientPacket(p as never))).toBe(line.hex); }
      }
    });
  }
  it('every recorded client request is one of ours and decodes to the values the scenario sent', () => {
    const sent = (id: number) => lines(id, 'c2s').map(l => decodeClientPacket(bytes(l.hex)));
    expect(sent(CC.CraftCarpenter)).toEqual([{ id: CC.CraftCarpenter, object: 163, amount: 1 }]);
    expect(sent(CC.CraftBlacksmith)).toEqual([{ id: CC.CraftBlacksmith, object: 165 }]);
    expect(sent(CC.CraftAlquimista)).toEqual([{ id: CC.CraftAlquimista, object: 5997 }]);
    expect(sent(CC.CraftSastre)).toEqual([{ id: CC.CraftSastre, object: 3578 }]);
    expect(sent(CC.StartAutomatedAction).map(p => (p as { skill: number }).skill)).toEqual([17, 19, 26, 18]);
    expect(sent(CC.StartAutomatedAction)[0]).toEqual({ id: CC.StartAutomatedAction, x: 38, y: 71, skill: 17 });
    expect(sent(CC.CompletarAccion)).toEqual([{ id: CC.CompletarAccion, action: 1 }]);
    expect(sent(CC.AddItemCrafting)).toEqual([{ id: CC.AddItemCrafting, inventorySlot: 4, craftSlot: 0 }]);
  });
  it('the server answers CraftCarpenter by turning the work macro on, then off when it finds no tool', () => {
    const toggles = recordings.find(r => r.name === 'build-refused.jsonl')!.lines.filter(l => l.id === CS.MacroTrabajoToggle).map(l => decodeServerPacket(bytes(l.hex)));
    expect(toggles).toEqual([{ id: CS.MacroTrabajoToggle, active: false }, { id: CS.MacroTrabajoToggle, active: true }, { id: CS.MacroTrabajoToggle, active: false }]);
  });
  it('refusals come as locale messages: no hammer at the anvil (1071) and no pending action (750)', () => {
    const locale = (name: string) => recordings.find(r => r.name === name)!.lines.filter(l => l.id === NS.LocaleMsg).map(l => decodeServerPacket(bytes(l.hex)));
    expect(locale('anvil-no-hammer.jsonl')).toContainEqual(expect.objectContaining({ id: NS.LocaleMsg, messageId: 1071 }));
    expect(locale('complete-action-none.jsonl')).toContainEqual(expect.objectContaining({ id: NS.LocaleMsg, messageId: 750 }));
  });
  it('a closed station answers nothing to its window packets: no crafting packet comes back', () => {
    const lines = recordings.find(r => r.name === 'station-not-open.jsonl')!.lines;
    expect(lines.filter(l => l.dir === 's2c' && owned.s2c.has(l.id))).toEqual([]);
    expect(lines.filter(l => l.dir === 'c2s').map(l => l.id)).toEqual([CC.AddItemCrafting, CC.RemoveItemCrafting, CC.AddCatalyst, CC.RemoveCatalyst, CC.MoveCraftItem, CC.CraftItem, CC.CloseCrafting, CC.FlagTrabajar, CC.RepeatMacro]);
  });
});
