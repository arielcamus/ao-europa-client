import { describe, expect, it } from 'vitest';
import { encodeServerFrame } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { PACKET_FAMILIES, PacketCounters } from '../src/packet-counters.js';
import { Session } from '../src/session.js';

describe('packet counters (VB6 PacketNames families)', () => {
  it('lists the VB6 families and counts each independently from 1', () => {
    expect(PACKET_FAMILIES).toContain('leftClick'); expect(PACKET_FAMILIES).toContain('castSpell'); expect(PACKET_FAMILIES).toHaveLength(16); // Declares.bas PacketNames at the pre-HOO pin (no HOO TargetedSpellCast)
    const c = new PacketCounters();
    expect([c.next('walk'), c.next('walk'), c.next('leftClick'), c.next('walk')]).toEqual([1, 2, 1, 3]);
    expect(c.current('talk')).toBe(0);
  });
  it('lives as long as the Session: a ChangeMap does not reset them and a refused click does not advance them', () => {
    let now = 0; const sent: Uint8Array[] = [];
    const s = new Session({ email: 'a', password: 'b' }, b => sent.push(b), () => now);
    for (const p of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged]) s.receive(encodeServerFrame(p));
    now = 1000; expect(s.leftClick(10, 10)).toBe(true); expect(s.counters.current('leftClick')).toBe(1);
    now = 1010; expect(s.leftClick(10, 10)).toBe(false); expect(s.counters.current('leftClick')).toBe(1); // paced: nothing sent, no increment
    s.receive(encodeServerFrame({ ...f.ChangeMap, map: 7, resourceMap: 7 }));
    expect(s.counters.current('leftClick')).toBe(1);
    now = 2000; s.receive(encodeServerFrame({ ...f.CharacterCreate, speeding: 1 }));
    expect(s.next('walk')).toBe(1); expect(s.next('walk')).toBe(2);
  });
});
