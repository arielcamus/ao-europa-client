import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SpellServerPacketId as SP, decodeServerPacket } from '@ao/protocol';
import { AudioDirector } from '../src/audio-director.js';
import { AudioEngine } from '../src/audio-engine.js';
import { SessionWorld } from '../src/audio-system.js';
import { Session } from '../src/session.js';
import type { WorldRenderer } from '../src/renderer.js';
import { fakeAudio } from './audio-fakes.js';

const root = new URL('../../../tests/fixtures/vb6/', import.meta.url);
type Row = { t_ms: number; dir: 's2c' | 'c2s'; id: number; hex: string };
const rows = (path: string): Row[] => readFileSync(new URL(path, root), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Row);
const fixtures = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.jsonl'));

/** What the real VB6 server sends as PlayWave (id 55): {wave, x, y, cancelLast, localize}, read straight from the recordings. */
function recordedWaves() {
  const found: Array<{ fixture: string; wave: number; x: number; y: number }> = [];
  for (const fixture of fixtures) {
    for (const row of rows(fixture)) {
      if (row.dir !== 's2c' || row.id !== SP.PlayWave) continue;
      const packet = decodeServerPacket(Buffer.from(row.hex, 'hex'));
      if ('unknown' in packet || packet.id !== SP.PlayWave) throw new Error(`PlayWave of ${fixture} does not decode`);
      found.push({ fixture, wave: packet.wave, x: packet.x, y: packet.y });
    }
  }
  return found;
}

describe('PlayWave as the real VB6 server sends it (every recorded fixture)', () => {
  const waves = recordedWaves();
  it('decodes every recorded PlayWave with the spells codec', () => {
    expect(waves.length).toBeGreaterThan(5);
    for (const w of waves) expect(w.wave).toBeGreaterThan(0);
  });
  it('plays them back through the session: each wave heard in the area reaches the engine under its recorded id', () => {
    const withWaves = fixtures.filter(name => rows(name).some(r => r.id === SP.PlayWave));
    expect(withWaves.length).toBeGreaterThan(3);
    for (const fixture of withWaves) {
      const f = fakeAudio(); const engine = new AudioEngine(f.deps); engine.unlock();
      const session = new Session({ email: 'x', password: 'y' }, () => undefined, () => 5000);
      const renderer = { readyMap: undefined, mapAudio: { music: 4, ambient: '', rain: false, snow: false, fog: false }, terrainAt: () => ({ file: 1, overlay: 0 }), roofAt: () => false, grhFile: () => 0 } as unknown as WorldRenderer;
      const world = new SessionWorld(renderer); world.session = session;
      const director = new AudioDirector(engine, world);
      session.onPacket = packet => director.receive(packet);
      const expected: string[] = [];
      for (const row of rows(fixture).filter(r => r.dir === 's2c')) {
        const body = Buffer.from(row.hex, 'hex');
        if (row.id === SP.PlayWave) {
          const packet = decodeServerPacket(body);
          const here = session.position;
          if ('unknown' in packet || packet.id !== SP.PlayWave) throw new Error('not a PlayWave');
          const audible = packet.x === 0 || packet.y === 0 || (here !== undefined && Math.abs(packet.x - here.x) < 12 && Math.abs(packet.y - here.y) < 10);
          // HandlePlayWave: cancelLast = 2 only stops the wave and returns, nothing is played.
          const fog = packet.wave >= 400 && packet.wave <= 404;
          if (audible && !fog && packet.cancelLast !== 2) expected.push(String(packet.wave));
        }
        try { session.receive(new Uint8Array([body.length & 255, body.length >> 8, ...body])); } catch { break; } // a recorded kick ends the replay
      }
      const heard = engine.events.filter(e => e.kind === 'wave' && e.category === 'general').map(e => e.id);
      const remaining = [...heard];
      for (const id of expected) {
        const at = remaining.indexOf(id);
        expect(at, `${fixture}: wave ${id} was recorded but not played`).toBeGreaterThanOrEqual(0);
        remaining.splice(at, 1);
      }
    }
  });
  it('plays the recorded walk, dummy and door session: the door wave 5 from the server, the swing wave 2 from the client', () => {
    const f = fakeAudio(); const engine = new AudioEngine(f.deps); engine.unlock();
    const session = new Session({ email: 'x', password: 'y' }, () => undefined, () => 5000);
    const renderer = { readyMap: undefined, mapAudio: { music: 4, ambient: '', rain: false, snow: false, fog: false }, terrainAt: () => ({ file: 1, overlay: 0 }), roofAt: () => false, grhFile: () => 0 } as unknown as WorldRenderer;
    const world = new SessionWorld(renderer); world.session = session;
    const director = new AudioDirector(engine, world);
    session.onPacket = packet => director.receive(packet);
    for (const row of rows('audio/walk-dummy-door.jsonl').filter(r => r.dir === 's2c')) {
      const body = Buffer.from(row.hex, 'hex');
      session.receive(new Uint8Array([body.length & 255, body.length >> 8, ...body]));
    }
    expect(rows('audio/walk-dummy-door.jsonl').filter(r => r.id === SP.PlayWave).map(r => decodeServerPacket(Buffer.from(r.hex, 'hex')))).toEqual([
      { id: SP.PlayWave, wave: 5, x: 72, y: 35, cancelLast: 0, localize: 0 }, { id: SP.PlayWave, wave: 5, x: 72, y: 35, cancelLast: 0, localize: 0 },
    ]);
    const heard = engine.events.filter(e => e.kind === 'wave');
    expect(heard.filter(e => e.id === '5').map(e => e.category)).toEqual(['general', 'general']);
    expect(heard.filter(e => e.id === '2')).toHaveLength(6); // six missed swings at the dummy
  });
});
