import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldServerPacketId as W, ServerPacketId as S, SpellServerPacketId as SS, AudioServerPacketId as AU } from '@ao/protocol';
import { ParticleGroup, averageTint, groupTint, parseParticles, randomNumber } from '../src/fx-particles.js';
import type { Stream } from '../src/fx-particles.js';
import { DAY_COLORS, LightGrid, WorldClock, ambientLight } from '../src/fx-lights.js';
import { WorldFx, areaBounds, fixAngle, fxTables, getAngle, makeProjectile, parseProjectiles, stepProjectile } from '../src/fx-world.js';
import { parseIni } from '../src/assets.js';

/** A deterministic Rnd. */
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const stream = (over: Partial<Stream> = {}): Stream => ({
  name: 'test', numParticles: 4, x1: 0, y1: 0, x2: 0, y2: 0, angle: 0, vecX1: 0, vecX2: 0, vecY1: 20, vecY2: 20, life1: 5, life2: 5, friction: 2,
  spin: false, spinL: 0, spinH: 0, alphaBlend: true, gravity: false, gravStrength: 0, bounceStrength: 0, xMove: false, yMove: false,
  moveX1: 0, moveX2: 0, moveY1: 0, moveY2: 0, grhList: [100], tint: [{ r: 255, g: 127, b: 128 }, { r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }, { r: 7, g: 8, b: 9 }],
  speed: 0.5, lifeCounter: -1, resize: false, resizeX: 0, resizeY: 0, ...over,
});

describe('particles.ind', () => {
  const file = `${process.env.HOME}/Projects/ao-reference/Recursos/init/particles.ind`;
  it.skipIf(!existsSync(file))('parses the real file to its last byte (325 streams, rain 58 and snow 57 as recorded)', () => {
    const streams = parseParticles(new Uint8Array(readFileSync(file)));
    expect(streams).toHaveLength(325);
    expect(streams[57]).toMatchObject({ name: 'lluvia 14', numParticles: 200, grhList: [29562], resize: true, resizeX: 5, speed: 0.5, friction: 12, alphaBlend: true });
    expect(streams[56]).toMatchObject({ name: 'Nieve I', numParticles: 90, grhList: [32374], vecY2: 30, lifeCounter: -1 });
  });
  it('rejects truncated data', () => { expect(() => parseParticles(new Uint8Array([1, 0, 4, 0, 65]))).toThrow(/Truncated/); });
});

describe('particle simulation (Particle_Group_Render / Particle_Render)', () => {
  it('RandomNumber is inclusive and accepts swapped bounds', () => {
    const rnd = seeded(3), seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(randomNumber(rnd, 3, -2));
    expect([...seen].sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]); // Int((U-L+1)*Rnd+L) with L > U: (U, L), as the VB6 formula
  });
  it('steps only when the frame counter passes the stream speed, then spawns and moves with integer division', () => {
    const group = new ParticleGroup(1, stream());
    expect(group.tick(0.3, 0, seeded())).toBe(false);          // 0.3 <= 0.5
    expect(group.tick(0.3, 0, seeded())).toBe(true);           // 0.6 > 0.5, counter resets
    // The first step spawns (alive 5 -> 4 after its own decrement) and applies one vector: 20 \ 2 = 10 px; x1=y1=0 gives -16.
    expect(group.particles[0]).toMatchObject({ x: -16, y: -16 + 10, alive: 4, grh: 100 });
    for (let i = 0; i < 4; i++) { group.tick(0.6, 0, seeded()); }
    expect(group.particles[0]!.alive).toBe(0);                 // lived 5 steps
    group.tick(0.6, 0, seeded());
    expect(group.particles[0]!.alive).toBe(4);                 // alive 0 and not draining: respawn
  });
  it('a removed group drains: no respawn, hidden at 0, destroyed when two or fewer remain', () => {
    const group = new ParticleGroup(1, stream());
    for (let i = 0; i < 3; i++) group.tick(0.6, 0, seeded());
    group.remove();
    for (let i = 0; i < 20 && !group.done; i++) group.tick(0.6, 0, seeded());
    expect(group.done).toBe(true);
  });
  it('a finite life counts down on steps only and ends the group', () => {
    const group = new ParticleGroup(1, stream({ lifeCounter: 3 }));
    let steps = 0;
    for (let i = 0; i < 40 && !group.done; i++) if (group.tick(0.6, 0, seeded())) steps++;
    expect(group.done).toBe(true);
    expect(steps).toBeGreaterThanOrEqual(3);
  });
  it('tints swap red and blue like General_Particle_Create; char groups use (R, G, R) for vertex 0; a Grh goes white and not additive', () => {
    const s = stream();
    expect(groupTint(s, false, false)[0]).toEqual({ r: 128, g: 127, b: 255 });
    expect(groupTint(s, true, false)[0]).toEqual({ r: 255, g: 127, b: 255 });
    expect(groupTint(s, true, false)[1]).toEqual({ r: 3, g: 2, b: 1 });
    const white = new ParticleGroup(1, s, { grh: 777, forChar: true });
    expect(white.draw.alphaBlend).toBe(false);
    expect(white.grhList).toEqual([777]);
    expect(averageTint(white.draw.tint)).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('warm-up fills the weather field and a live start lifts every particle by vecy2 * 30', () => {
    const rain = new ParticleGroup(58, stream({ numParticles: 20, life1: 25, life2: 40, vecY1: 100, vecY2: 200, friction: 12 }));
    rain.warmUp(seeded(), 0);
    expect(rain.particles.every(p => p.grh === 100)).toBe(true);
    const before = rain.particles[0]!.y;
    rain.liftForLiveStart();
    expect(rain.particles[0]!.y).toBe(before - 200 * 30);
  });
});

describe('time of day and light', () => {
  it('Hora anchors the day; hour colours lerp from the previous hour (LerpRGB, byte rounding)', () => {
    const clock = new WorldClock();
    expect(clock.hourLight(0)).toEqual(DAY_COLORS[23]);          // before the first Hora: hour 0, nothing elapsed
    clock.onHora(3_900_000, 7_200_000, 1000);                     // 13:00 of a 2 h day = 54.17%... elapsed/dayLen*24
    const t = clock.time(1000);
    expect(t.hour).toBe(13); expect(t.label).toBe('13:00');
    expect(clock.time(1000 + 150_000).label).toBe('13:30');       // 5 s of real time = 1 in-game hour is 300 s
    clock.onHora(7_200_000 * 5 + 300_000 * 5, 7_200_000, 0);      // wraps
    expect(clock.time(0).hour).toBe(5);
    expect(clock.hourLight(0)).toEqual({ r: 138, g: 138, b: 138 }); // fraction 0: DayColors(4)? hour 5 -> lerp(prev=DAY[4], DAY[5], 0)
  });
  it('ambient order is dead, blind, dungeon, then the clock; dayLight/nightLight pin it', () => {
    const clock = new WorldClock(); clock.onHora(3_900_000, 7_200_000, 0);
    const base = { dead: false, blind: false, dungeon: false, mode: 'hour' as const, disableDungeonLighting: false };
    expect(ambientLight(clock, 0, base)).toEqual({ r: 255, g: 255, b: 255 });
    expect(ambientLight(clock, 0, { ...base, dungeon: true })).toEqual({ r: 190, g: 190, b: 190 });
    expect(ambientLight(clock, 0, { ...base, dungeon: true, disableDungeonLighting: true })).toEqual({ r: 255, g: 255, b: 255 });
    expect(ambientLight(clock, 0, { ...base, blind: true, dungeon: true })).toEqual({ r: 4, g: 4, b: 4 });
    expect(ambientLight(clock, 0, { ...base, dead: true, blind: true })).toEqual({ r: 120, g: 120, b: 120 });
    expect(ambientLight(clock, 0, { ...base, mode: 'night' })).toEqual({ r: 120, g: 120, b: 120 });
  });
  const vertex = (grid: LightGrid, x: number, y: number, v: number) => { const at = ((y - 1) * 100 + x - 1) * 12 + v * 3; return [grid.data[at], grid.data[at + 1], grid.data[at + 2]]; };
  it('a square light paints its box and only the facing vertices of the outer ring (Light_Render)', () => {
    const grid = new LightGrid();
    grid.addMapLight({ x: 10, y: 10, color: { r: 200, g: 10, b: 20 }, range: 2 });
    grid.recompute({ r: 100, g: 100, b: 100 });
    expect(vertex(grid, 10, 10, 0)).toEqual([200, 10, 20]);       // centre tile, every vertex
    expect(vertex(grid, 11, 11, 3)).toEqual([200, 10, 20]);       // interior of the box
    expect(vertex(grid, 8, 10, 2)).toEqual([200, 10, 20]);        // west ring tile: its right-hand vertices
    expect(vertex(grid, 8, 10, 0)).toEqual([100, 100, 100]);      // ... but not its left-hand ones
    expect(vertex(grid, 13, 10, 0)).toEqual([100, 100, 100]);     // outside
  });
  it('a round light (range >= 100) blends from its colour at the centre to the ambient at range * 32 + 16 px', () => {
    const grid = new LightGrid();
    grid.addMapLight({ x: 50, y: 50, color: { r: 255, g: 0, b: 0 }, range: 103 }); // range 4
    grid.recompute({ r: 100, g: 100, b: 100 });
    const centre = vertex(grid, 50, 50, 1)!;                      // top-left vertex of the light's tile: 16 px away in x and y
    expect(centre[0]).toBeGreaterThan(100); expect(centre[1]).toBeLessThan(100);
    expect(vertex(grid, 56, 50, 1)).toEqual([100, 100, 100]);     // beyond the radius
  });
  it('LightToFloor: colour 0 removes (round only when its recorded range is above 100); a second square light on a tile is ignored', () => {
    const grid = new LightGrid();
    grid.lightToFloor(20, 20, 0x00ff0000, 3); grid.lightToFloor(20, 20, 0x0000ff00, 3);
    expect(grid.lightCount).toBe(1);
    grid.lightToFloor(30, 30, 0x000000ff, 104);
    expect(grid.lightCount).toBe(2);
    grid.lightToFloor(30, 30, 0, 0); grid.lightToFloor(20, 20, 0, 0);
    expect(grid.lightCount).toBe(0);
    grid.lightToFloor(40, 40, 0x00ffffff, 100);                   // round, range 1, recorded as exactly 100
    grid.lightToFloor(40, 40, 0, 0);
    expect(grid.lightCount).toBe(1);                              // VB6 tests "> 100": it stays (documented quirk)
  });
  it('tileTint is the vertex mean, white outside the map', () => {
    const grid = new LightGrid(); grid.recompute({ r: 80, g: 90, b: 100 });
    expect(grid.tileTint(5, 5)).toEqual({ r: 80, g: 90, b: 100 }); expect(grid.tileTint(0, 5)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('projectiles (InitializeProjectile / UpdateProjectile)', () => {
  const ini = parseIni('[INIT]\nNumProjectile=2\n[PROJECTILE1]\nSPEED=3000\nGRH=26203\nOFFSETROTATION=0\nROTATIONSPEED=0\n[PROJECTILE2]\nSPEED=2000\nGRH=26192\nGRHRigth=26191\nOFFSETROTATION=0\nROTATIONSPEED=-1\n');
  it('reads ProjectileDef.dat with SPEED / 1000 px per ms', () => {
    const defs = parseProjectiles(ini);
    expect(defs).toHaveLength(2);
    expect(defs[1]).toEqual({ grh: 26192, rightGrh: 26191, speed: 2, offsetRotation: 0, rotationSpeed: -1 });
  });
  it('GetAngle: east is 0, GetAngle(StartX, endY, endX, StartY) orients the sprite; moving right swaps in the right Grh and spin', () => {
    expect(getAngle(0, 0, 5, 0)).toBe(0); expect(getAngle(5, 0, 0, 0)).toBeCloseTo(Math.PI);
    const def = parseProjectiles(ini)[1]!;
    const right = makeProjectile(def, 10, 10, 14, 10), left = makeProjectile(def, 10, 10, 6, 10);
    expect(right.grh).toBe(26191); expect(right.rotationSpeed).toBe(1); expect(left.grh).toBe(26192); expect(left.rotationSpeed).toBe(-1);
    expect(right.x).toBe(320); expect(right.targetX).toBe(448);
    expect(fixAngle(-10)).toBe(350); expect(fixAngle(725)).toBe(5);
  });
  it('flies speed * dt per frame and ends when closer than one step', () => {
    const p = makeProjectile(parseProjectiles(ini)[0]!, 10, 10, 10, 20);   // 320 px down at 3 px/ms
    let frames = 0;
    while (!stepProjectile(p, 16) && frames < 100) frames++;
    expect(frames).toBe(6);                                                  // 48 px per 16 ms frame
    expect(p.y).toBeGreaterThan(560);
  });
});

describe('area bounds (CambioDeArea, classic 36 x 36 window)', () => {
  it('centres on the 12 tile area of the reference tile and clamps to the map', () => {
    expect(areaBounds(72, 38)).toEqual({ minX: 60, maxX: 95, minY: 24, maxY: 59 });
    expect(areaBounds(5, 5)).toEqual({ minX: 1, maxX: 23, minY: 1, maxY: 23 }); // max is computed from the unclamped min, as in the VB6
    expect(areaBounds(99, 99)).toEqual({ minX: 84, maxX: 100, minY: 84, maxY: 100 });
  });
});

describe('WorldFx packets', () => {
  let now = 0;
  let world: WorldFx;
  const added: unknown[] = [];
  const frame = (over = {}) => ({ dt: 16, view: { minX: 1, maxX: 100, minY: 1, maxY: 100 }, charPixel: (i: number) => (i === 7 ? { x: 320, y: 320 } : i === 8 ? { x: 640, y: 320 } : undefined), selfDead: false, ...over });
  beforeEach(() => {
    now = 0; added.length = 0;
    fxTables.streams = Array.from({ length: 70 }, () => stream({ numParticles: 6 }));
    fxTables.projectiles = parseProjectiles(parseIni('[INIT]\nNumProjectile=1\n[PROJECTILE1]\nSPEED=1000\nGRH=1\n'));
    world = new WorldFx(() => now, { addFx: fx => added.push(fx) }, seeded(5));
  });
  const map = (rain = true, snow = false, fog = false, zone = '') => ({ zone, baseLight: 0, rain, snow, fog });

  it('rain: the toggle is remembered, a map with the flag starts it, and ChangeMap re-applies it (SwitchMap)', () => {
    world.setMap(map(), [], []);
    world.receive({ id: AU.RainToggle, raining: true });
    expect(world.raining).toBe(true); expect(world.meteo).toBeDefined();
    world.receive({ id: AU.RainToggle, raining: false });
    expect(world.meteo!.destruir).toBe(true);
    world.receive({ id: S.ChangeMap, map: 2, resourceMap: 2 } as never);
    expect(world.meteo).toBeUndefined(); expect(world.generation).toBe(1);
    world.receive({ id: AU.RainToggle, raining: true });          // map not applied yet: no particles, flag kept
    expect(world.meteo).toBeUndefined();
    world.setMap(map(), [], []);
    expect(world.meteo).toBeDefined();
  });
  it('rain on a map without the flag only records bRain; snow replaces rain', () => {
    world.setMap(map(false, true), [], []);
    world.receive({ id: AU.RainToggle, raining: true });
    expect(world.raining).toBe(true); expect(world.meteo).toBeUndefined();
    world.receive({ id: AU.NieveToggle, snowing: true });
    expect(world.meteo?.streamId).toBe(57);
  });
  it('fog fades in one alpha step per 100 ms up to MaxAlphaNiebla, and out again on the second toggle', () => {
    world.setMap(map(false, false, true), [], []);
    world.receive({ id: W.NieblaToggle, maxAlpha: 20 });
    for (let t = 0; t < 1000; t += 100) { now += 100; world.update(now, frame({ dt: 100 })); }
    expect(world.fogAlpha).toBe(10);
    for (let t = 0; t < 2000; t += 100) { now += 100; world.update(now, frame({ dt: 100 })); }
    expect(world.fogAlpha).toBe(20);
    world.receive({ id: W.NieblaToggle, maxAlpha: 20 });
    expect(world.fogOn).toBe(false);
    for (let t = 0; t < 3000; t += 100) { now += 100; world.update(now, frame({ dt: 100 })); }
    expect(world.fogAlpha).toBe(0);
    expect(world.fog.x1).toBeLessThanOrEqual(0); expect(world.fog.x1).toBeGreaterThanOrEqual(-512);
  });
  it('map particles and lights come from the CSM and the tile must be free; ParticleFXToFloor creates, removes, or attaches to the occupant', () => {
    world.setMap(map(false), [{ x: 5, y: 5, r: 1, g: 2, b: 3, range: 3 }], [{ x: 10, y: 10, stream: 3 }, { x: 10, y: 10, stream: 4 }]);
    expect(world.tileGroups.size).toBe(1); expect(world.lights.lightCount).toBe(1);
    world.receive({ id: SS.ParticleFXToFloor, x: 20, y: 20, particle: 5, time: 1 });
    expect(world.tileGroups.get(19 * 100 + 19)!.neverDie).toBe(true);  // Time 1 means for ever
    world.setHooks({ charAt: () => 7 });
    world.receive({ id: SS.ParticleFXToFloor, x: 20, y: 20, particle: 6, time: 40 });
    expect(world.charGroups.get(7)).toHaveLength(1);
    world.receive({ id: SS.ParticleFXToFloor, x: 20, y: 20, particle: 5, time: 0 });
    expect(world.tileGroups.get(19 * 100 + 19)!.destruir).toBe(true);
  });
  it('ParticleFX on a character: create with a life, remove drains the first live group of that stream', () => {
    world.receive({ id: SS.ParticleFX, charIndex: 7, particle: 9, time: -1, remove: false, grh: 0, x: 0, y: 0 });
    world.receive({ id: SS.ParticleFX, charIndex: 7, particle: 9, time: 0, remove: true, grh: 0, x: 0, y: 0 });
    expect(world.charGroups.get(7)![0]!.destruir).toBe(true);
    world.receive({ id: SS.ParticleFX, charIndex: 7, particle: 9, time: 30, remove: false, grh: 4000, x: 0, y: 0 });
    expect(world.charGroups.get(7)![1]!.grhList).toEqual([4000]);
  });
  it('a travelling spell particle flies at speed 9 * 9 * ticks, explodes on the target and asks for an FXs.ini effect when fx = 1', () => {
    world.receive({ id: SS.ParticleFXWithDestino, sender: 7, receiver: 8, travelParticle: 2, finalParticle: 33, time: 2, wave: 0, fx: 1, x: 0, y: 0 });
    let frames = 0;
    while (world.travelers.length && frames < 400) { now += 16; frames++; world.update(now, frame()); }
    expect(world.travelers).toHaveLength(0);
    expect(added).toEqual([{ fx: 33, charIndex: 8, x: 0, y: 0, loops: 2 }]);
    world.receive({ id: SS.ParticleFXWithDestinoXY, sender: 7, travelParticle: 2, finalParticle: 4, time: 10, wave: 0, fx: 0, x: 12, y: 10 });
    for (let i = 0; i < 80 && world.travelers.length; i++) { now += 16; world.update(now, frame()); }
    expect(world.tileGroups.get(9 * 100 + 11)!.streamId).toBe(4);
  });
  it('a traveller whose sender is gone is dropped; projectiles fly and are released', () => {
    world.receive({ id: SS.ParticleFXWithDestino, sender: 99, receiver: 8, travelParticle: 2, finalParticle: 0, time: 0, wave: 0, fx: 0, x: 0, y: 0 });
    world.update(16, frame()); expect(world.travelers).toHaveLength(0);
    world.receive({ id: SS.CreateProjectile, startX: 5, startY: 5, targetX: 5, targetY: 7, projectileType: 1 });
    world.receive({ id: SS.CreateProjectile, startX: 5, startY: 5, targetX: 5, targetY: 7, projectileType: 9 }); // unknown type: ignored
    expect(world.projectiles).toHaveLength(1);
    for (let i = 0; i < 20; i++) world.update(i * 16, frame());
    expect(world.projectiles).toHaveLength(0);
  });
  it('ChangeMap clears lights, groups and projectiles; pause toggles; area changes reach the hook; aura strings are stored as sent', () => {
    let bounds: unknown; world.setHooks({ areaChanged: b => { bounds = b; } });
    world.setMap(map(false), [{ x: 5, y: 5, r: 1, g: 2, b: 3, range: 3 }], [{ x: 10, y: 10, stream: 3 }]);
    world.receive({ id: W.PauseToggle } as never); expect(world.paused).toBe(true);
    world.receive({ id: W.PauseToggle } as never); expect(world.paused).toBe(false);
    world.receive({ id: W.AreaChanged, x: 72, y: 38 }); expect(bounds).toEqual({ minX: 60, maxX: 95, minY: 24, maxY: 59 });
    world.receive({ id: W.AuraToChar, charIndex: 7, aura: '12:255:5:0', remove: false, type: 4 });
    expect(world.auras.get(7)!.get(4)).toBe('12:255:5:0');
    world.receive({ id: S.ChangeMap, map: 3, resourceMap: 3 } as never);
    expect(world.tileGroups.size).toBe(0); expect(world.lights.lightCount).toBe(0); expect(world.auras.size).toBe(0);
  });
  it('the light follows the clock and death: dead is the flat 120, the grid recomputes when the ambient changes', () => {
    world.receive({ id: W.Hora, elapsedMs: 3_900_000, dayLenMs: 7_200_000 });
    world.setMap(map(false), [], []);
    world.update(0, frame());
    expect(world.ambient).toEqual({ r: 255, g: 255, b: 255 });
    world.update(16, frame({ selfDead: true }));
    expect(world.ambient).toEqual({ r: 120, g: 120, b: 120 });
    expect(world.lights.tileTint(10, 10)).toEqual({ r: 120, g: 120, b: 120 });
    world.setMap({ ...map(false), zone: 'DUNGEON' }, [], []);
    world.update(40, frame());
    expect(world.ambient).toEqual({ r: 190, g: 190, b: 190 });
  });
  it('before the first Hora the light is white (RestaurarLuz with TimeIndex = -1); RevisarHoraMundo then sets TimeIndex = hour \\ 2', () => {
    world.setMap(map(false), [], []);
    world.update(0, frame());
    expect(world.ambient).toEqual({ r: 255, g: 255, b: 255 }); expect(world.timeIndex).toBe(-1); expect(world.isNight).toBe(false);
    now = 1000; world.receive({ id: W.Hora, elapsedMs: 3_900_000, dayLenMs: 7_200_000 }); // 13:00
    world.update(1000, frame());
    expect(world.timeIndex).toBe(6);
  });
  it('EsNoche is TimeIndex 0..2 (hours 0..5): the wolf and the rooster play on the 500 ms tick that changes the index, never on a base-light map', () => {
    const waves: number[] = [];
    world = new WorldFx(() => now, { playGlobalWave: w => waves.push(w) }, seeded(5));
    world.setMap(map(false), [], []);
    world.receive({ id: W.Hora, elapsedMs: 3_600_000 * 0 + 100_000, dayLenMs: 7_200_000 }); // 00:20
    world.update(0, frame()); expect(world.isNight).toBe(true); expect(waves).toEqual([124]);
    now = 600; world.update(600, frame()); expect(waves).toEqual([124]);                   // same index: silent
    world.receive({ id: W.Hora, elapsedMs: 1_950_000, dayLenMs: 7_200_000 }); now = 1200;       // 06:30 -> index 3 (MorningIndex)
    world.update(1200, frame()); expect(world.isNight).toBe(false); expect(waves).toEqual([124, 137]);
    const quiet = new WorldFx(() => now, { playGlobalWave: w => waves.push(w) }, seeded(5));
    quiet.setMap({ ...map(false), baseLight: 0x808080 }, [], []); quiet.receive({ id: W.Hora, elapsedMs: 100_000, dayLenMs: 7_200_000 });
    quiet.update(2000, frame()); expect(waves).toEqual([124, 137]);
  });
  it('FlashScreen: global_light takes the colour for the Efecto time, but the 500 ms hour tick replaces it before the lightmap reads it (VB6)', () => {
    world.receive({ id: W.Hora, elapsedMs: 3_900_000, dayLenMs: 7_200_000 });
    world.setMap(map(false, false, true), [], []); world.update(0, frame());
    const day = { ...world.ambient };
    // BGR long: R low byte.
    world.receive({ id: 129, color: 0xff0000 | 0x00ff00 | 0x00ff, duration: 300, ignore: false } as never);
    now = 100; world.update(100, frame());               // no tick yet, UpdateLights unset: the grid is untouched
    expect(world.ambient).toEqual(day);
    now = 600; world.update(600, frame());               // tick: global_light = hour colour, the flash never rendered
    expect(world.ambient).toEqual(day);
  });
  it('FlashScreen without fog on the map and without the ignore flag does nothing; the Efecto end uses the map base light, else RestaurarLuz', () => {
    world.receive({ id: W.Hora, elapsedMs: 3_900_000, dayLenMs: 7_200_000 });
    world.setMap(map(false), [], []); world.update(0, frame());
    world.receive({ id: 129, color: 0x0000ff, duration: 50, ignore: false } as never);
    expect((world as unknown as { efectoEndsAt?: number }).efectoEndsAt).toBeUndefined();
    world.receive({ id: 129, color: 0x0000ff, duration: 50, ignore: true } as never);
    expect((world as unknown as { efectoEndsAt?: number }).efectoEndsAt).toBe(50);
    now = 60; world.update(60, frame());                 // Efecto_Timer: no base light -> RestaurarLuz leaves global_light, the lightmap keeps its colour
    expect((world as unknown as { efectoEndsAt?: number }).efectoEndsAt).toBeUndefined();
    expect(world.ambient).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('PauseToggle is a plain toggle on a fresh connection (HandleDisconnect resets pausa; the browser builds a new WorldFx per connection)', () => {
    expect(world.paused).toBe(false);
    world.receive({ id: W.PauseToggle } as never); expect(world.paused).toBe(true);
    world.receive({ id: W.PauseToggle } as never); expect(world.paused).toBe(false);
    world.receive({ id: W.PauseToggle } as never); // a client that logs in between the server's save pair gets one toggle: paused, like the VB6 client
    expect(new WorldFx(() => now).paused).toBe(false);
  });
});

describe('VB6 recording: login, idle, cross the area border (tests/fixtures/vb6/world-fx)', () => {
  it('feeds the real packets through the world state', async () => {
    const { decodeServerPacket } = await import('@ao/protocol');
    const rows = readFileSync(new URL('../../../tests/fixtures/vb6/world-fx/login-idle-area-border.jsonl', import.meta.url), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as { dir: string; hex: string });
    const bounds: unknown[] = [], speeds: number[] = [];
    const world = new WorldFx(() => 0, { areaChanged: b => bounds.push(b), speedToChar: (_c, s) => speeds.push(s) });
    for (const row of rows) {
      if (row.dir !== 's2c') continue;
      const packet = decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex')));
      if (!('unknown' in packet)) world.receive(packet);
    }
    expect(world.clock.inited).toBe(true);
    expect(world.clock.time(0).hour).toBeGreaterThanOrEqual(0);
    expect(bounds).toHaveLength(3);
    expect(bounds[0]).toMatchObject({ minX: expect.any(Number), maxX: expect.any(Number) });
    expect(speeds.length).toBeGreaterThan(0);
  });
});

describe('VB6 recording: rain and snow toggles (tests/fixtures/vb6/world/weather-toggles.jsonl, #28)', () => {
  it('RainToggle (59) and NieveToggle (122) decode from the real server frames and drive the weather flags', async () => {
    const { decodeServerPacket } = await import('@ao/protocol');
    const rows = readFileSync(new URL('../../../tests/fixtures/vb6/world/weather-toggles.jsonl', import.meta.url), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as { dir: string; id: number; hex: string });
    const world = new WorldFx(() => 0);
    const seen: string[] = [];
    for (const row of rows.filter(r => r.dir === 's2c')) {
      const packet = decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex')));
      expect('unknown' in packet).toBe(false);
      world.receive(packet);
      seen.push(`${row.id}:${world.raining ? 'R' : '-'}${world.snowing ? 'S' : '-'}`);
    }
    expect(seen).toEqual(['59:--', '122:--', '59:R-', '122:RS', '122:R-', '122:RS']);
  });
});
