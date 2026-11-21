/*
 * The frame a character shows when it is not walking (Ariel, 21 Nov: "the wolf stopped next to me and turned to attack, but it
 * looks like a running position"). Pinned client 619e69d: Char_Render (engine.bas 1340-1349) freezes a stopped body with
 * Walk(heading).started = 0 when the body has no AnimateOnIdle, and Draw_Grh (engine.bas 451-466) then draws Frames(1).
 * A heading-only HandleCharacterChange stops it at once for an idle character (Protocol.bas 2593-2598) and on the next
 * Char_Render for a non-idle one (engine.bas 1459-1476). The renderer's `layer.walks && moving ? elapsed : 0` is that rule,
 * so these tests pin the tracker state it reads.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NpcsServerPacketId as N, ServerPacketId as S, Heading } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { CharacterTracker, TILE_MS } from '../src/characters.js';
import { parseGraphics, parseIni, readBody } from '../src/assets.js';

const WOLF = 4276; // NPC558 Lobo Salvaje (Dat/npcs.dat Body=4276; its BodyIdle=4277 is server-side only, the pinned localindex.dat has none)
const create = (charIndex: number): ServerPacket =>
  ({ ...f.CharacterCreate, charIndex, x: 10, y: 10, heading: Heading.South, speeding: 1, npc: 1, body: WOLF, name: 'Lobo Salvaje' }) as ServerPacket;
const turn = (charIndex: number, heading: Heading): ServerPacket =>
  ({ id: N.CharacterChange, charIndex, flags: 0, body: WOLF, head: 0, heading, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0 });

describe('the walk frame of a character that is not walking', () => {
  it('a creature that arrives stops walking: no walk clock once the slide is over (Char_Render: Moving -> Idle -> started = 0)', () => {
    const t = new CharacterTracker();
    t.receive(create(9), 0);
    t.receive({ id: S.CharacterMove, charIndex: 9, x: 11, y: 10 }, 1000);
    const wolf = t.chars.get(9)!;
    expect(t.visualPosition(wolf, 1000 + TILE_MS / 2)).toMatchObject({ moving: true });
    expect(t.visualPosition(wolf, 1000 + TILE_MS + 1)).toEqual({ x: 11, y: 10, moving: false, elapsed: 0 });
    // Standing there it stays on frame 1 however long it waits.
    expect(t.visualPosition(wolf, 60_000)).toEqual({ x: 11, y: 10, moving: false, elapsed: 0 });
  });
  it('turning to attack without moving shows the standing frame of the NEW heading (HandleCharacterChange, idle branch)', () => {
    const t = new CharacterTracker();
    t.receive(create(9), 0);
    t.receive({ id: S.CharacterMove, charIndex: 9, x: 11, y: 10 }, 1000);
    t.receive(turn(9, Heading.West), 5000);
    const wolf = t.chars.get(9)!;
    expect(wolf.heading).toBe(Heading.West);
    expect(t.visualPosition(wolf, 5000)).toEqual({ x: 11, y: 10, moving: false, elapsed: 0 });
    expect(t.visualPosition(wolf, 5200)).toEqual({ x: 11, y: 10, moving: false, elapsed: 0 });
  });
  it('a turn during a slide keeps walking in phase (HandleCharacterChange, not-idle branch: SyncGrhPhase keeps the start)', () => {
    const t = new CharacterTracker();
    t.receive(create(9), 0);
    t.receive({ id: S.CharacterMove, charIndex: 9, x: 11, y: 10 }, 1000);
    t.receive(turn(9, Heading.North), 1100);
    const wolf = t.chars.get(9)!;
    expect(wolf.heading).toBe(Heading.North);
    expect(t.visualPosition(wolf, 1150)).toMatchObject({ moving: true, elapsed: 150 });
    expect(t.visualPosition(wolf, 1000 + TILE_MS + 1)).toMatchObject({ moving: false, elapsed: 0 });
  });
  it('an attack (CharAtaca) starts no walk: pinned localindex.dat has no Ataque1 body, so HandleCharAtaca only swings the weapon', () => {
    const t = new CharacterTracker();
    t.receive(create(9), 0);
    t.receive({ id: 182, charIndex: 9, victimIndex: 1, damage: 12 } as unknown as ServerPacket, 100);
    expect(t.visualPosition(t.chars.get(9)!, 100)).toEqual({ x: 10, y: 10, moving: false, elapsed: 0 });
  });
});

const root = process.env.AO_ASSETS;
describe('the pinned wolf body (Recursos-prehoo)', () => {
  it.skipIf(!root || !existsSync(`${root}/init/cuerpos.dat`))('frame 1 of each heading is the first cell of its mold row, like CargarCuerpos builds Frames(1)', () => {
    const graphics = parseGraphics(readFileSync(`${root}/init/graficos.ini`, 'latin1'));
    const bodies = parseIni(readFileSync(`${root}/init/cuerpos.dat`, 'latin1'));
    const molds = parseIni(readFileSync(`${root}/init/moldes.ini`, 'latin1'));
    const body = readBody(bodies, molds, graphics, WOLF);
    // Molde94: X=0 Y=256, 96x64, six frames per row; rows run South, North, West, East (CargarMoldes BodiesHeading).
    const first = (heading: Heading) => body.walk[heading - 1]!.frames[0]!;
    expect(first(Heading.South)).toMatchObject({ file: 4772, x: 0, y: 256, width: 96, height: 64 });
    expect(first(Heading.North)).toMatchObject({ x: 0, y: 320 });
    expect(first(Heading.West)).toMatchObject({ x: 0, y: 384 });
    expect(first(Heading.East)).toMatchObject({ x: 0, y: 448 });
    expect(body.walk.every(walk => walk!.frames.length === 6)).toBe(true);
    // No standing pose exists for it on the client: no AnimateOnIdle/IdleBody in cuerpos.dat, no BodyIdle in localindex.dat.
    expect(bodies.get(`body${WOLF}`)?.has('idlebody')).toBe(false);
    expect(bodies.get(`body${WOLF}`)?.has('animateonidle')).toBe(false);
    for (const name of ['localindex.dat', 'sp_localindex.dat', 'en_localindex.dat']) {
      if (!existsSync(`${root}/init/${name}`)) continue;
      expect(parseIni(readFileSync(`${root}/init/${name}`, 'latin1')).get('npc558')?.has('bodyidle') ?? false).toBe(false);
    }
  });
});
