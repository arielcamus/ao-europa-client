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
});
