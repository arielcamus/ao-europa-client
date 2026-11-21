import { describe, expect, it } from 'vitest';
import { FrameDecoder, ClientPacketId as C, SessionClientPacketId as SCP, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { legalPos, effectiveBlocked, type LegalContext } from '../src/movement.js';

const E = 2, S = 3, W = 4;
function harness() {
  let now = 1000;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const p of packets) session.receive(encodeServerFrame(p)); };
  recv(f.Connected, f.AccountCharacterList, { ...f.Intervals, walk: 100 }, f.ChangeMap,
    { ...f.CharacterCreate, speeding: 1, heading: 1, x: 50, y: 60 }, f.UserCharIndexInServer, f.Logged);
  sent.length = 0;
  const decoded = () => { const d = new FrameDecoder(); const out = sent.flatMap(b => d.push(b).map(decodeClientPacket)); sent.length = 0; return out; };
  return { session, recv, decoded, advance: (ms: number) => { now += ms; } };
}
const create = (over: Record<string, unknown>) => ({ ...f.CharacterCreate, charIndex: 77, speeding: 1, x: 51, y: 60, privileges: 0, body: 1, ...over }) as ServerPacket;

describe('walking into an occupied tile (General.MoveTo + TileEngine.LegalPos)', () => {
  it('a creature on the right: no step is predicted, no Walk goes out, the character turns and sends ChangeHeading once', () => {
    const h = harness();
    h.recv(create({}));
    h.advance(1000);
    expect(h.session.walk(E)).toBe(false);
    expect(h.session.position).toEqual({ x: 50, y: 60 });
    expect(h.session.self!.heading).toBe(E);
    expect(h.session.tracker.chars.get(h.session.charIndex!)!.heading).toBe(E);
    const out = h.decoded();
    expect(out.map(p => p.id)).toEqual([SCP.ChangeHeading]);
    expect(out[0]).toMatchObject({ heading: E });
    // already facing it: pressing again only bumps, nothing is sent (VB6: only when charlist heading <> Heading)
    h.advance(1000); expect(h.session.walk(E)).toBe(false);
    expect(h.decoded()).toEqual([]);
  });
  it('a free tile still walks (Walk + position probe, no ChangeHeading)', () => {
    const h = harness();
    h.advance(1000); expect(h.session.walk(S)).toBe(true);
    expect(h.decoded().map(p => p.id)).toEqual([C.Walk, C.RequestPositionUpdate]);
  });
  it('a dead (ghost body) character or one flagged DontBlockTile does not block', () => {
    const h = harness();
    h.recv(create({ body: 829 }));
    h.advance(1000); expect(h.session.walk(E)).toBe(true);
  });
  it('map terrain: a tile blocked from this side turns instead of walking', () => {
    const h = harness();
    h.session.terrain = (x, y) => x === 49 && y === 60 ? { blocked: 1 << (W - 1), trigger: 0 } : { blocked: 0, trigger: 0 };
    h.advance(1000); expect(h.session.walk(W)).toBe(false);
    expect(h.decoded().map(p => p.id)).toEqual([SCP.ChangeHeading]);
  });
});

const ctx = (over: Partial<LegalContext> = {}): LegalContext => ({
  tile: { blocked: 0, trigger: 0 }, occupant: undefined, ownPrivilege: 0, sailing: false, swimming: false, riding: false, dead: false, ...over,
});
const alive = { dead: false, invisible: false, privilege: 0, dontBlockTile: false };

describe('legalPos', () => {
  it('occupied: blocks unless dead, invisible with a higher privilege, or DontBlockTile', () => {
    expect(legalPos(E, ctx({ occupant: alive }))).toBe(false);
    expect(legalPos(E, ctx({ occupant: { ...alive, dead: true } }))).toBe(true);
    expect(legalPos(E, ctx({ occupant: { ...alive, dontBlockTile: true } }))).toBe(true);
    expect(legalPos(E, ctx({ occupant: { ...alive, invisible: true, privilege: 3 } }))).toBe(true);
    expect(legalPos(E, ctx({ occupant: { ...alive, invisible: true, privilege: 0 } }))).toBe(false);
    expect(legalPos(E, ctx({ occupant: { ...alive, invisible: true, privilege: 3 }, ownPrivilege: 3 }))).toBe(false);
  });
  it('blocked sides use bit Heading-1; the server override replaces only the four side bits', () => {
    expect(legalPos(E, ctx({ tile: { blocked: 2, trigger: 0 } }))).toBe(false);
    expect(legalPos(W, ctx({ tile: { blocked: 2, trigger: 0 } }))).toBe(true);
    expect(effectiveBlocked(0x20 | 15, 0)).toBe(0x20);
    expect(effectiveBlocked(0x20, 4)).toBe(0x24);
    expect(legalPos(E, ctx({ tile: { blocked: 0, trigger: 201 } }))).toBe(false);
  });
  it('water: walkers need land, boats need water (bridge excepted), swimmers need swim triggers', () => {
    const water = { blocked: 0x20, trigger: 0 }, coast = { blocked: 0x20 | 0x80, trigger: 0 };
    expect(legalPos(E, ctx({ tile: water }))).toBe(false);
    expect(legalPos(E, ctx({ tile: coast }))).toBe(true);
    expect(legalPos(E, ctx({ tile: water, sailing: true }))).toBe(true);
    expect(legalPos(E, ctx({ tile: { blocked: 0, trigger: 0 }, sailing: true }))).toBe(false);
    expect(legalPos(E, ctx({ tile: { blocked: 0x20, trigger: 17 } }))).toBe(true);
    expect(legalPos(E, ctx({ tile: { blocked: 0, trigger: 11 }, swimming: true }))).toBe(true);
    expect(legalPos(E, ctx({ tile: { blocked: 0, trigger: 0 }, swimming: true }))).toBe(false);
    expect(legalPos(E, ctx({ tile: { blocked: 0, trigger: 10 }, riding: true }))).toBe(false);
  });
});

// Recorded against the VB6 server (tools/conformance/scenario-walk-into-creature.mjs): Aotest next to its own spawned chicken.
import { readFileSync } from 'node:fs';
import { encodeClientFrame, decodeServerPacket } from '@ao/protocol';
type Row = { dir: 's2c' | 'c2s'; id: number; name?: string; hex: string };
const rows = (name: string): Row[] => readFileSync(new URL(`../../../tests/fixtures/vb6/movement/${name}`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Row);
const swings = (name: string) => rows(name).filter(r => r.dir === 's2c' && r.id === 19).map(r => decodeServerPacket(Buffer.from(r.hex, 'hex')));

describe('against the real VB6 server (walk-into-creature fixtures)', () => {
  it('without the turn the server swings at its old heading (no target, ShowText false); with ChangeHeading the swing finds the creature', () => {
    expect(swings('walk-into-creature-no-turn.jsonl').at(-1)).toMatchObject({ showText: false });
    expect(swings('walk-into-creature-turn.jsonl').at(-1)).toMatchObject({ showText: true });
  });
  it('the ChangeHeading our client sends for a blocked step is byte-identical to the recorded VB6 one', () => {
    const recorded = rows('walk-into-creature-turn.jsonl').find(r => r.dir === 'c2s' && r.id === 6)!;
    expect(Buffer.from(encodeClientFrame({ id: 6, heading: Buffer.from(recorded.hex, 'hex')[2]!, counter: 1 })).subarray(2).toString('hex')).toBe(recorded.hex);
  });
});
