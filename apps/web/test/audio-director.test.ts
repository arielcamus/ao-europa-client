import { describe, expect, it } from 'vitest';
import { AudioServerPacketId as A, CombatServerPacketId as C, ServerPacketId as S, SkillsServerPacketId as SK, SpellServerPacketId as SP } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { AudioDirector } from '../src/audio-director.js';
import type { AudioWorld, PlayWavePacket } from '../src/audio-director.js';
import { AudioEngine } from '../src/audio-engine.js';
import { fakeAudio } from './audio-fakes.js';

type Char = { x: number; y: number; body: number; privileges: number; sailing: boolean; speeding: number; npc?: number };
function setup(over: Partial<{ audio: ReturnType<AudioWorld['mapAudio']>; ground: number; roof: boolean }> = {}) {
  const f = fakeAudio();
  const engine = new AudioEngine(f.deps); engine.unlock();
  const chars = new Map<number, Char>([[1, { x: 50, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 }]]);
  const state = {
    resourceMap: 7 as number | undefined, position: { x: 50, y: 50 } as { x: number; y: number } | undefined, charIndex: 1 as number | undefined,
    dead: false, motion: undefined as { started: number; to: { x: number; y: number } } | undefined, mapReady: true,
    audio: over.audio === undefined && 'audio' in over ? undefined : over.audio ?? { music: 5, ambient: '3-4', rain: true, snow: false, fog: false },
    ground: over.ground ?? 1, roof: over.roof ?? false, night: false,
  };
  const world: AudioWorld = {
    get resourceMap() { return state.resourceMap; }, get position() { return state.position; }, get charIndex() { return state.charIndex; },
    get dead() { return state.dead; }, get motion() { return state.motion; }, get mapReady() { return state.mapReady; }, get night() { return state.night; },
    char: index => chars.get(index), mapAudio: () => state.audio, terrainAt: () => ({ file: state.ground, overlay: 0 }), roofAt: () => state.roof,
  };
  const director = new AudioDirector(engine, world);
  const waves = () => engine.events.filter(e => e.kind === 'wave').map(e => e.id);
  const wave = (p: Partial<PlayWavePacket>): ServerPacket => ({ id: SP.PlayWave, wave: 2, x: 0, y: 0, cancelLast: 0, localize: 0, ...p });
  return { f, engine, chars, state, director, waves, wave };
}

describe('server waves (HandlePlayWave)', () => {
  it('plays a wave without a position at the category volume and centred', () => {
    const t = setup();
    t.director.receive(t.wave({ wave: 55 }));
    expect(t.engine.events.at(-1)).toMatchObject({ kind: 'wave', id: '55', volume: 0, pan: 0 });
  });
  it('plays a positioned wave only inside the 23x19 area, quieter and panned by distance', () => {
    const t = setup();
    t.director.receive(t.wave({ wave: 10, x: 53, y: 52 })); // 5 tiles away, to the right; invert is on by default
    expect(t.engine.events.at(-1)).toMatchObject({ id: '10', volume: -600, pan: -2500 });
    t.director.receive(t.wave({ wave: 11, x: 70, y: 50 })); // outside the area
    expect(t.waves()).toEqual(['10']);
  });
  it('honours cancelLast 1 (stop then play) and 2 (stop only), and the fog waves', () => {
    const t = setup();
    t.director.receive(t.wave({ wave: 20, cancelLast: 1 }));
    t.director.receive(t.wave({ wave: 21, cancelLast: 2 }));
    expect(t.engine.events.map(e => `${e.kind}:${e.id}`)).toEqual(['stop:20', 'wave:20', 'stop:21']);
    t.director.receive(t.wave({ wave: 401 }));
    expect(t.waves()).toEqual(['20']);
    t.state.audio = { ...t.state.audio!, fog: true };
    t.director.receive(t.wave({ wave: 401 }));
    expect(t.waves()).toEqual(['20', '401']);
  });
  it('prefixes the language code when the server asks to localize and the client is not Spanish', () => {
    const t = setup(); t.director.language = 'en';
    t.director.receive(t.wave({ wave: 30, localize: 1 }));
    expect(t.waves()).toEqual(['en_30']);
  });
  it('ignores PlayMIDI like the VB6 client does', () => {
    const t = setup();
    t.director.receive({ id: A.PlayMIDI, file: 3, loop: 1 } as ServerPacket);
    expect(t.engine.events).toHaveLength(0);
  });
});

describe('footsteps (DoPasosFx)', () => {
  const move = (charIndex: number, x: number, y: number) => ({ id: S.CharacterMove, charIndex, x, y }) as unknown as ServerPacket;
  it('alternates feet for other characters by terrain, quieter with distance', () => {
    const t = setup({ ground: 6001 });
    t.chars.set(2, { x: 52, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 });
    t.director.receive(move(2, 52, 50)); t.director.receive(move(2, 53, 50));
    expect(t.engine.events.map(e => [e.id, e.category, e.volume, e.label])).toEqual([
      ['201', 'steps', -240, 'pasos2_1'], ['69', 'steps', -360, 'pasos2_2'],
    ]);
  });
  it('plays the own step once per walk, at the destination, on the terrain there', () => {
    const t = setup({ ground: 5001 });
    t.state.motion = { started: 100, to: { x: 51, y: 50 } };
    t.director.tick(); t.director.tick();
    t.state.motion = { started: 400, to: { x: 52, y: 50 } };
    t.director.tick();
    expect(t.engine.events.filter(e => e.category === 'steps').map(e => e.id)).toEqual(['199', '200']);
  });
  it('uses the horse steps when fast on plain floor and the boat loop on water', () => {
    const t = setup({ ground: 1 });
    t.chars.get(1)!.speeding = 1.5;
    t.state.motion = { started: 1, to: { x: 51, y: 50 } }; t.director.tick();
    expect(t.engine.events.filter(e => e.category === 'steps').at(-1)).toMatchObject({ id: '70' });
    t.chars.set(3, { x: 51, y: 50, body: 1, privileges: 0, sailing: true, speeding: 1 });
    t.director.receive(move(3, 51, 50));
    expect(t.engine.events.at(-1)).toMatchObject({ id: '50', label: 'sailing_3', category: 'steps' });
  });
  it('stays quiet for the dead, for a dead player, out of earshot and for stronger privileges', () => {
    const t = setup();
    t.chars.set(2, { x: 52, y: 50, body: 829, privileges: 0, sailing: false, speeding: 1 });
    t.chars.set(3, { x: 90, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 });
    t.chars.set(4, { x: 52, y: 51, body: 1, privileges: 2, sailing: false, speeding: 1 }); // priv 1 (a GM)
    for (const [i, x, y] of [[2, 52, 50], [3, 90, 50], [4, 52, 51]] as const) t.director.receive(move(i, x, y));
    expect(t.engine.events).toHaveLength(0);
    t.chars.set(5, { x: 51, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 });
    t.state.dead = true; t.director.receive(move(5, 51, 50));
    expect(t.engine.events).toHaveLength(0);
  });
  it('does not make a step for its own CharacterMove echo', () => {
    const t = setup(); t.director.receive(move(1, 51, 50));
    expect(t.engine.events).toHaveLength(0);
  });
  it('plays the invisible walker step from PlayWaveStep with the server distance and side', () => {
    const t = setup();
    t.director.receive({ id: A.PlayWaveStep, charIndex: 9, grh: 100, grh2: 0, distance: 4, balance: 1, step: false } as ServerPacket);
    expect(t.engine.events.at(-1)).toMatchObject({ id: '24', category: 'steps', volume: -480, pan: -2000 });
  });
});

describe('combat sounds the client makes itself', () => {
  it('plays the swing wave 2 at a swinging character in the area', () => {
    const t = setup(); t.chars.set(2, { x: 55, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 });
    t.director.receive({ id: C.CharSwing, charIndex: 2, showFx: true, showText: false, notifyText: false } as ServerPacket);
    expect(t.waves()).toEqual(['2']);
  });
  it('plays 10 for a hit and 2 for a miss on CharAtaca, nothing when the player is dead', () => {
    const t = setup(); t.chars.set(2, { x: 55, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 });
    t.director.receive({ id: C.CharAtaca, charIndex: 2, victimIndex: 1, damage: 7 } as ServerPacket);
    t.director.receive({ id: C.CharAtaca, charIndex: 2, victimIndex: 1, damage: -1 } as ServerPacket);
    expect(t.waves()).toEqual(['10', '2']);
    t.state.dead = true;
    t.director.receive({ id: C.CharAtaca, charIndex: 2, victimIndex: 1, damage: 7 } as ServerPacket);
    expect(t.waves()).toHaveLength(2);
  });
});

describe('map music, ambient and weather', () => {
  const music = (t: ReturnType<typeof setup>) => t.engine.events.filter(e => e.kind === 'music').map(e => e.id);
  it('starts the map music (header number, ost_<n>) and the day ambient when a map becomes ready', () => {
    const t = setup(); t.director.tick(); t.director.tick();
    expect(music(t)).toEqual(['ost_5']);
    expect(t.engine.events.filter(e => e.kind === 'ambient').map(e => e.id)).toEqual(['4']);
  });
  it('prefers the zone music under the player and switches when the player enters another zone', () => {
    const t = setup(); t.director.zones = [{ map: 7, music: 9, x1: 60, x2: 70, y1: 1, y2: 100 }];
    t.director.tick();
    t.state.position = { x: 61, y: 50 }; t.director.tick();
    t.state.position = { x: 40, y: 50 }; t.director.tick();
    expect(music(t)).toEqual(['ost_5', 'ost_9', 'ost_5']);
  });
  it('stops the music on a map without any and the ambient on "0-0"', () => {
    const t = setup({ audio: { music: 0, ambient: '0-0', rain: false, snow: false, fog: false } });
    t.director.tick();
    expect(music(t)).toEqual(['']);
  });
  it('waits for the renderer to hold the map the session is on', () => {
    const t = setup(); t.state.mapReady = false; t.director.tick();
    expect(t.engine.events).toHaveLength(0);
  });
  it('plays the rain loop outside or inside and the end wave when it stops, only on maps with rain', () => {
    const t = setup(); t.director.tick();
    t.director.receive({ id: A.RainToggle, raining: true } as ServerPacket);
    t.state.roof = true; t.director.tick();
    t.director.receive({ id: A.RainToggle, raining: false } as ServerPacket);
    expect(t.engine.events.filter(e => e.kind === 'ambient').map(e => e.id)).toEqual(['4', '194', '191', '4']);
    expect(t.engine.events.at(-1)).toMatchObject({ kind: 'wave', id: '192', category: 'ambient' });
    const dry = setup({ audio: { music: 5, ambient: '3-4', rain: false, snow: false, fog: false } }); dry.director.tick();
    dry.director.receive({ id: A.RainToggle, raining: true } as ServerPacket);
    expect(dry.engine.events.filter(e => e.kind === 'ambient')).toHaveLength(1);
  });
  it('picks the rain loop when a map loads while it is raining', () => {
    const t = setup(); t.director.receive({ id: A.RainToggle, raining: true } as ServerPacket);
    t.director.tick();
    expect(t.engine.events.filter(e => e.kind === 'ambient').map(e => e.id)).toEqual(['194']);
  });
});

describe('night ambient, meditation, pets and global waves (#28)', () => {
  it('picks the first ambient field at night and the second by day (PlayAmbientAudio, EsNoche)', () => {
    const night = setup(); night.state.night = true; night.director.tick();
    expect(night.engine.events.filter(e => e.kind === 'ambient').map(e => e.id)).toEqual(['3']);
    const day = setup(); day.director.tick();
    expect(day.engine.events.filter(e => e.kind === 'ambient').map(e => e.id)).toEqual(['4']);
    // Real map data is a single number ("514"): the VB6 client plays it at night and is silent by day.
    const single = setup({ audio: { music: 0, ambient: '514', rain: false, snow: false, fog: false } }); single.state.night = true; single.director.tick();
    expect(single.engine.events.filter(e => e.kind === 'ambient').map(e => e.id)).toEqual(['514']);
  });
  it('does not restart the ambient when the hour flips on a map that is already playing', () => {
    const t = setup(); t.director.tick(); t.state.night = true; t.director.tick(); t.director.tick();
    expect(t.engine.events.filter(e => e.kind === 'ambient')).toHaveLength(1);
  });
  it('loops the meditation wave 158 under "meditate<char>" for a character in the area and stops it when the toggle comes back with fx 0', () => {
    const t = setup(); t.chars.set(2, { x: 53, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 });
    t.director.receive({ id: SK.MeditateToggle, charIndex: 2, fx: 12, x: 0, y: 0 } as ServerPacket);
    expect(t.engine.events.at(-1)).toMatchObject({ kind: 'wave', id: '158', label: 'meditate2' });
    t.director.receive({ id: SK.MeditateToggle, charIndex: 2, fx: 0, x: 0, y: 0 } as ServerPacket);
    expect(t.engine.events.at(-1)).toMatchObject({ kind: 'stop', id: '158', label: 'meditate2' });
    t.chars.set(3, { x: 90, y: 50, body: 1, privileges: 0, sailing: false, speeding: 1 }); // outside the area: no sound
    const before = t.engine.events.length; t.director.receive({ id: SK.MeditateToggle, charIndex: 3, fx: 12, x: 0, y: 0 } as ServerPacket);
    expect(t.engine.events).toHaveLength(before);
  });
  it('pets make no footsteps (EsMascota = FlagNpc 2), other NPCs do', () => {
    const t = setup(); t.chars.set(2, { x: 52, y: 50, body: 5, privileges: 0, sailing: false, speeding: 1, npc: 2 });
    t.director.step(2, 52, 50); expect(t.waves()).toEqual([]);
    t.chars.set(3, { x: 52, y: 50, body: 5, privileges: 0, sailing: false, speeding: 1, npc: 1 });
    t.director.step(3, 52, 50); expect(t.waves()).toHaveLength(1);
  });
  it('plays a global wave with no position', () => {
    const t = setup(); t.director.global(124);
    expect(t.engine.events.at(-1)).toMatchObject({ kind: 'wave', id: '124' });
  });
});

describe('leaving the world', () => {
  it('stops music and ambient and plays the next map from scratch', () => {
    const t = setup(); t.director.tick();
    t.director.reset();
    expect(t.engine.events.at(-1)).toMatchObject({ kind: 'music', id: '' });
    expect(t.engine.currentAmbient).toBe(0);
    t.director.tick();
    expect(t.engine.events.filter(e => e.kind === 'music').map(e => e.id)).toEqual(['ost_5', '', 'ost_5']);
  });
});

describe('ui clicks', () => {
  it('plays SND_CLICK (500) on press and SND_CLICK_OVER (501) on hover', () => {
    const t = setup(); t.director.click(); t.director.hover();
    expect(t.waves()).toEqual(['500', '501']);
  });
});
