import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StatusServerPacketId as SS, decodeServerPacket } from '@ao/protocol';
import { Session } from '../src/session.js';
import { STATUS_TEXT } from '../src/status.js';

const root = new URL('../../../tests/fixtures/vb6/combat-spells-2/', import.meta.url);
type Row = { t_ms: number; dir: 's2c' | 'c2s'; id: number; hex: string };
const rows = (name: string): Row[] => readFileSync(new URL(name, root), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Row);
/** Feed the recorded server stream to a Session as the bridge would (length prefix + body). */
function replay(name: string) {
  let now = 0;
  const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
  for (const row of rows(name)) {
    if (row.dir !== 's2c') continue;
    now = row.t_ms;
    const body = Buffer.from(row.hex, 'hex'), frame = Buffer.alloc(body.length + 2);
    frame.writeUInt16LE(body.length, 0); body.copy(frame, 2);
    session.receive(frame);
  }
  return session;
}

describe('real VB6 recordings (tests/fixtures/vb6/combat-spells-2)', () => {
  it('every recorded status packet decodes with the status codecs', () => {
    const known = new Set<number>(Object.values(SS));
    let seen = 0;
    for (const name of ['hide-key', 'safe-toggles', 'bow-shoot-snake', 'cast-dart-snake', 'snake-poison-antidote']) {
      for (const row of rows(`${name}.jsonl`)) {
        if (row.dir !== 's2c' || !known.has(row.id)) continue;
        expect('unknown' in decodeServerPacket(Buffer.from(row.hex, 'hex'))).toBe(false); seen++;
      }
    }
    expect(seen).toBeGreaterThan(8);
  });
  it('hiding: the server makes the character invisible, the viewer still draws it at alpha 100/255', () => {
    const s = replay('hide-key.jsonl');
    expect(s.status.invisible.has(s.charIndex!)).toBe(true);
    expect(s.status.alphaOf(s.charIndex!, s.charIndex, true)).toBeCloseTo(100 / 255);
  });
  it('safe toggles: each pair flips back, and the console prints the VB6 lines', () => {
    const s = replay('safe-toggles.jsonl');
    expect(s.status.clanSafe).toBe(true); expect(s.status.resuSafe).toBe(true); expect(s.status.partySafe).toBe(true);
    const lines = s.ui.messages.map(m => m.text);
    for (const text of [STATUS_TEXT.clanOff, STATUS_TEXT.clanOn, STATUS_TEXT.resuOff, STATUS_TEXT.resuOn, STATUS_TEXT.partyOff, STATUS_TEXT.partyOn]) expect(lines).toContain(text);
  });
  it('a snake kills the archer: NPCKillUser prints the creature line and the character ends dead', () => {
    const s = replay('bow-shoot-snake.jsonl');
    expect(s.ui.messages.map(m => m.text)).toContain(STATUS_TEXT.npcKill);
    expect(s.dead).toBe(true);
  });
});
