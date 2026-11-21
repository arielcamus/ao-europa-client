// AGPL-3.0-or-later. Spell sounds against the real VB6 recording (tests/fixtures/vb6/spells/dardo-magico-kills-creature.jsonl, server 9ccd7fad):
// a newbie mage casts Dardo Mágico at a Gallo (15 HP) and kills it. The pinned server sends no PlayWave for a travelling spell: the wave (16)
// rides in ParticleFXWithDestino and the client plays it when the effect arrives. The killing hit puts the Gallo's CharacterRemove in the same
// TCP batch, so the client must take the positions when the packet arrives (Effect_Begin) and fly to the erased creature's tile (EraseChar).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SpellServerPacketId as SS, NpcsServerPacketId as N, decodeServerPacket, getWireProfile, setWireProfile } from '@ao/protocol';
import { AudioDirector } from '../src/audio-director.js';
import { AudioEngine } from '../src/audio-engine.js';
import { SessionWorld } from '../src/audio-system.js';
import { Session } from '../src/session.js';
import type { WorldRenderer } from '../src/renderer.js';
import { fakeAudio } from './audio-fakes.js';

type Row = { t_ms: number; dir: 's2c' | 'c2s'; id: number; hex: string };
const load = (file: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/spells/${file}`, import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Row);
const rows = load('dardo-magico-kills-creature.jsonl');

/** Replays a recording through a Session + AudioDirector with the renderer's frame loop between TCP batches (what AudioSystem.attach wires). */
async function replay(file: string) {
  const rows = load(file);
  const f = fakeAudio(); f.files.set('/ao-assets/wav/16.wav', 8230); f.files.set('/ao-assets/OGG/16.ogg', 4425); const engine = new AudioEngine(f.deps); engine.unlock();
  let now = 5000;
  const session = new Session({ email: 'x', password: 'y' }, () => undefined, () => now);
  const renderer = { readyMap: undefined, mapAudio: { music: 4, ambient: '', rain: false, snow: false, fog: false }, terrainAt: () => ({ file: 1, overlay: 0 }), roofAt: () => false, grhFile: () => 0 } as unknown as WorldRenderer;
  const sw = new SessionWorld(renderer); sw.session = session;
  const director = new AudioDirector(engine, sw);
  session.onPacket = packet => director.receive(packet);
  session.world.setHooks({ playWave: (wave, x, y) => director.at(wave, x, y), playGlobalWave: wave => director.global(wave) });
  // Renderer.renderWorldFx's charPixel (tile top-left in world pixels; the tracker's sliding position)
  const charPixel = (i: number) => { const c = session.tracker.chars.get(i); if (!c) return undefined; const p = session.tracker.visualPosition(c, now); return { x: p.x * 32, y: p.y * 32 }; };
  const frames = (n: number) => { for (let i = 0; i < n; i++) { now += 16; session.world.update(now, { dt: 16, view: { minX: 1, maxX: 100, minY: 1, maxY: 100 }, charPixel, selfDead: false }); } };
  // one TCP batch per recorded timestamp, rendered between batches
  const batches = new Map<number, Row[]>();
  for (const r of rows.filter(r => r.dir === 's2c')) batches.set(r.t_ms, [...(batches.get(r.t_ms) ?? []), r]);
  for (const batch of batches.values()) {
    const bytes = batch.flatMap(r => { const b = Buffer.from(r.hex, 'hex'); return [b.length & 255, b.length >> 8, ...b]; });
    session.receive(new Uint8Array(bytes));
    frames(30);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  return { engine, session, dart: engine.events.filter(e => e.kind === 'wave' && e.id === '16') };
}

describe('Dardo Mágico sound (real VB6 recording)', () => {
  // recorded on the pre-HOO 9ccd server: its NPC CharacterCreate has no clanAlignment byte
  const before = getWireProfile();
  beforeAll(() => setWireProfile('prehoo')); afterAll(() => setWireProfile(before));
  it('the recording: the cast is one ParticleFXWithDestino (Gallo as emitter and receptor, wave 16) followed by the Gallo\'s CharacterRemove, and no PlayWave 16', () => {
    const s2c = rows.filter(r => r.dir === 's2c').map(r => decodeServerPacket(Buffer.from(r.hex, 'hex')));
    const at = s2c.findIndex(p => !('unknown' in p) && p.id === SS.ParticleFXWithDestino);
    const cast = s2c[at] as { sender: number; receiver: number; travelParticle: number; finalParticle: number; wave: number; fx: number };
    expect(cast).toMatchObject({ travelParticle: 186, finalParticle: 15, wave: 16, fx: 1 });
    expect(cast.sender).toBe(cast.receiver);
    expect(s2c.slice(at).some(p => !('unknown' in p) && p.id === N.CharacterRemove && p.charIndex === cast.receiver)).toBe(true);
    expect(s2c.some(p => !('unknown' in p) && p.id === SS.PlayWave && p.wave === 16)).toBe(false);
  });

  it('plays wave 16 at the Gallo\'s tile when the dart arrives, though the Gallo was erased in the same batch', async () => {
    const { engine, session, dart } = await replay('dardo-magico-kills-creature.jsonl');
    expect(dart).toHaveLength(1);
    expect(dart[0]!.result).toBe('played');
    // the Gallo stood one tile east of the mage: one tile of attenuation, and the same pan as the server's PlayWave 137 (its death) on that tile
    const death = engine.events.find(e => e.kind === 'wave' && e.id === '137')!;
    expect(dart[0]!.volume).toBe(-120); expect(dart[0]!.pan).toBe(death.pan); expect(dart[0]!.pan).not.toBe(0);
    // the dart's FXs.ini explosion (15) was drawn on the tile
    expect(session.spells.effects.some(e => e.fx === 15)).toBe(true);
  });
  it('a living target (the Ullathorpe training dummy, 1,000,000 HP, 8 tiles north): every one of the three casts plays wave 16 with 8 tiles of attenuation', async () => {
    const { dart } = await replay('dardo-magico-training-dummy.jsonl');
    expect(dart.map(e => [e.result, e.volume, e.pan])).toEqual([['played', -960, 0], ['played', -960, 0], ['played', -960, 0]]);
  });
});
