import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeServerPacket } from '@ao/protocol';

interface Row { t_ms: number; dir: 's2c' | 'c2s'; id: number; name: string; hex: string }
const load = (name: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/buildings/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Row);
const positions = (rows: Row[]) => rows.filter(r => r.name === 'PosUpdate').map(r => { const d = decodeServerPacket(Buffer.from(r.hex, 'hex')); return d as { x: number; y: number }; });

describe('recorded VB6 sessions: why Ullathorpe buildings stay closed', () => {
  it('church interior (trigger 20, ONLY_PATREON_TILE): every step north is refused with locale message 776', () => {
    const rows = load('church-patron-tile');
    const msgs = rows.filter(r => r.name === 'LocaleMsg' && Buffer.from(r.hex, 'hex').readInt16LE(2) === 776);
    expect(msgs.length).toBeGreaterThan(0);
    const last = positions(rows).slice(-4);
    expect(new Set(last.map(p => `${p.x},${p.y}`)).size).toBe(1);   // never moved
    expect(last[0]).toMatchObject({ x: 78, y: 74 });
  });
  it('bank (Finanzas) south gate: the player reaches (77,56) and (77,55) refuses northward entry (closed door flags)', () => {
    const last = positions(load('bank-doors-closed')).slice(-4);
    expect(last.every(p => p.x === 77 && p.y === 56)).toBe(true);
  });
  // MSG_NOT_IN_THE_CASTLE_WHITELIST = 2215: GameLogic.DoTileEvents warps the walker back to (x, y+1) on trigger 21..40 unless a castle with that trigger exists.
  const castleBounces = (rows: Row[]) => rows.filter(r => r.name === 'LocaleMsg' && Buffer.from(r.hex, 'hex').readInt16LE(2) === 2215);
  it('carpentry (trigger 32, EMPEROR_CASTLE_ENTRY_12): with the door open the doorway step is bounced back to (65,80) by the castle whitelist', () => {
    const rows = load('carpentry-castle-trigger-bounce');
    expect(castleBounces(rows).length).toBeGreaterThanOrEqual(3);
    // The door at (65,79) was open (obj 2333) when the session started: the refusal is not a door or key problem.
    const door = rows.filter(r => r.name === 'ObjectCreate').map(r => Buffer.from(r.hex, 'hex')).filter(b => b[2] === 65 && b[3] === 79);
    expect(door.at(-1)!.readUInt16LE(4)).toBe(2333);
    expect(positions(rows).slice(-2)).toEqual([expect.objectContaining({ x: 65, y: 80 }), expect.objectContaining({ x: 65, y: 80 })]);
  });
  it('bank (trigger 29, EMPEROR_CASTLE_ENTRY_9): the opened west door (77,55) is bounced back to (77,56) by the same rule', () => {
    const rows = load('bank-castle-trigger-bounce');
    expect(castleBounces(rows).length).toBeGreaterThanOrEqual(3);
    const last = positions(rows).slice(-2);
    expect(last.every(p => p.x === 77 && p.y === 56)).toBe(true);
  });
<<<<<<< HEAD
  it('Nix building (trigger 24) under the server fix: the walk north is accepted and never bounced', () => {
    const rows = load('nix-building-castle-trigger-enters');
    expect(castleBounces(rows)).toHaveLength(0);
    const ys = positions(rows).map(p => p.y);
    expect(Math.min(...ys)).toBeLessThanOrEqual(45);
  });
=======
>>>>>>> origin/main
});
