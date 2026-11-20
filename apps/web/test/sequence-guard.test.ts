import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { PACKET_FAMILIES, SEQUENCED_CLIENT_PACKETS } from '../src/packet-counters.js';
import { Session } from '../src/session.js';

// VB6 server Protocol.bas: handlers that read a client Int32 counter (VerifyPacketSequence / verifyTimeStamp, or read only).
// Ids from server PacketId.bas ClientPacketID. Adding a sequenced packet to the client means adding it here and to the map.
const VB6_SEQUENCED = {
  WorkLeftClick: 2, EquipItem: 5, ChangeHeading: 6, GuildMessage: 59, Talk: 75, Walk: 78, Attack: 80, Drop: 93, CastSpell: 94,
  LeftClick: 95, Work: 97, UseItem: 99, QuestionGM: 215, UseItemU: 288, HooTargetedSpellCast: 314,
};

function playing() {
  let now = 0; const sent: Uint8Array[] = [];
  const s = new Session({ email: 'a', password: 'b' }, b => sent.push(b), () => now);
  for (const p of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged]) s.receive(encodeServerFrame(p));
  return { s, sent, at: (ms: number) => { now = ms; } };
}
const send = (s: Session, packet: object) => (s as unknown as { send(p: object): void }).send(packet);

describe('shared packet sequence guard', () => {
  it('every VB6 sequence-checked client id maps to a PacketCounters family, and nothing else does', () => {
    expect(Object.keys(SEQUENCED_CLIENT_PACKETS).map(Number).sort((a, b) => a - b))
      .toEqual(Object.values(VB6_SEQUENCED).sort((a, b) => a - b));
    for (const family of Object.values(SEQUENCED_CLIENT_PACKETS)) expect(PACKET_FAMILIES).toContain(family);
  });
  it('Session.send refuses a sequenced packet whose counter did not come from session.next', () => {
    const { s } = playing();
    expect(() => send(s, { id: 95, x: 10, y: 10, counter: 1 })).toThrow(/session\.next\('leftClick'\)/); // own counter, shared is 0
    const counter = s.next('leftClick');
    send(s, { id: 95, x: 10, y: 10, counter });
    expect(() => send(s, { id: 95, x: 10, y: 10, counter })).toThrow(); // the same value twice
    expect(() => send(s, { id: 78, heading: 1, counter: 7 })).toThrow(/walk/);
  });
  it('mixed features share one counter per family and every sent counter strictly increases', () => {
    const { s, sent, at } = playing();
    at(1000); expect(s.leftClick(10, 10)).toBe(true);
    at(1500); expect(s.walk(1)).toBe(true);
    at(3000); expect(s.leftClick(11, 10)).toBe(true);
    at(3500); expect(s.talk('hola')).toBe(true);
    const last = new Map<number, number>();
    for (const frame of sent) {
      const p = decodeClientPacket(frame.subarray(2));
      if ('unknown' in p || !('counter' in p)) continue;
      expect(p.counter).toBeGreaterThan(last.get(p.id) ?? 0); last.set(p.id, p.counter as number);
    }
    expect(last.get(95)).toBe(2);
  });
  it('no source file outside packet-counters.ts keeps its own packet counter', () => {
    const dir = new URL('../src/', import.meta.url);
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name === 'packet-counters.ts') continue;
      const lines = readFileSync(new URL(name, dir), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/counter\s*:\s*(?!this\.next\(|session\.next\(|s\.next\(|counter\b)[^,}]*\+\+|\+\+\s*this\.\w*[cC]ounter|[cC]ounter\w*\s*(=\s*0\b|\+\+|\+=\s*1)/.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
