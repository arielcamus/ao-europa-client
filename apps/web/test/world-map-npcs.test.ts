import { describe, expect, it } from 'vitest';
import { dropPercent, npcInfo, npcRows, parseNpcSections, previewStart, previewStep, vbVal } from '../src/world-map-npcs.js';

const table = parseNpcSections(`[NPC1]
Name=Sacerdote
NpcType=1
Body=117
Head=3
[NPC500]
Name=Lobo
Body=4372
Hp=100
Exp=30
Oro=6
MinHit=9
MaxHit=15
NROITEMS=2
Obj1=26-1
Obj2=27-3
[NPC501]
Name=Mercader
NpcType=0
Comercia=1
NROITEMS=1
Obj1=30-1
[NPC502]
Name=Oculto
NoMapInfo=1
[NPC503]
Name=Jefe
DropCount=2
Drop1=100-4-1-1
Drop2=101-0-1-1
GiveEXPClan=500
`);

describe('frmMapaGrande creature data', () => {
  it('reads stats and guaranteed drops with VB6 Val semantics', () => {
    expect(vbVal('26-1')).toBe(26);
    const wolf = npcInfo(table, undefined, 500)!;
    expect(wolf).toMatchObject({ name: 'Lobo', hp: 100, exp: 30, gold: 6, minHit: 9, maxHit: 15 });
    expect(wolf.drops).toEqual([{ object: 26, percent: 100 }, { object: 27, percent: 100 }]);
  });
  it('does not drop a seller\'s stock, and converts a denominator to a percentage', () => {
    expect(npcInfo(table, undefined, 501)!.drops).toEqual([]);
    expect(npcInfo(table, undefined, 503)!.drops).toEqual([{ object: 100, percent: 25 }, { object: 101, percent: 0 }]);
    expect(npcInfo(table, undefined, 503)!.expClan).toBe(500);
    expect(dropPercent(3)).toBe(33.33);
  });
  it('lists the creatures of a map once each, ascending, without the NoMapInfo ones', () => {
    const npcs = [500, 1, 500, 502, 500].map((npcIndex, i) => ({ x: i + 1, y: 1, npcIndex }));
    expect(npcRows(npcs, table)).toEqual([{ index: 1, name: 'Sacerdote', count: 1 }, { index: 500, name: 'Lobo', count: 3 }]);
  });
  it('turns the preview south, west, north, east every 18 ticks', () => {
    let state = previewStart();
    expect(state.heading).toBe(3);
    for (let i = 0; i < 18; i++) state = previewStep(state, 4, 1);
    expect(state).toEqual({ heading: 4, frame: 1, tick: 0 });
    state = previewStep(state, 4, 1); expect(state.frame).toBe(2);
    for (let i = 0; i < 35; i++) state = previewStep(state, 4, 1);
    expect(state.heading).toBe(2);
  });
});

describe('NPC section parsing and the drop-key fallback', () => {
  it('keeps a section header with a trailing comment apart from the previous NPC', () => {
    const ini = parseNpcSections("[NPC559]\nName=Lobo Negro\n\n[NPC560] 'Ogro\nName=Ogro\n");
    expect(ini.get('npc559')!.get('name')).toBe('Lobo Negro');
    expect(ini.get('npc560')!.get('name')).toBe('Ogro');
  });
  it('takes NroItems from the server table when the client file has no drop keys', () => {
    const local = parseNpcSections('[NPC559]\nNAME=Lobo Negro\nHP=400\nEXP=220\n');
    const server = parseNpcSections('[NPC559]\nName=Lobo Negro\nComercia=0\nNROITEMS=1\nObj1=1146-1\n');
    expect(npcInfo(local, server, 559)).toMatchObject({ name: 'Lobo Negro', hp: 400, exp: 220, drops: [{ object: 1146, percent: 100 }] });
    expect(npcInfo(local, undefined, 559)!.drops).toEqual([]);
  });
});
