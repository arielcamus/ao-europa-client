import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AudioServerPacketId as A, ServerPacketId as S, decodeServerPacket } from '@ao/protocol';
import { AudioDirector } from '../src/audio-director.js';
import { AudioEngine } from '../src/audio-engine.js';
import { SessionWorld } from '../src/audio-system.js';
import { Session } from '../src/session.js';
import { panByDistance } from '../src/audio-rules.js';
import type { WorldRenderer } from '../src/renderer.js';
import { fakeAudio } from './audio-fakes.js';

// Watcher side of tests/fixtures/vb6/audio/invisible-walker-steps.jsonl (#28): a non-GM walker drank an invisibility potion and walked past.
type Row = { t_ms: number; dir: 's2c' | 'c2s'; id: number; hex: string };
const rows = readFileSync(new URL('../../../tests/fixtures/vb6/audio/invisible-walker-steps.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Row);
const decode = (row: Row) => decodeServerPacket(Buffer.from(row.hex, 'hex'));

describe('VB6 recording: PlayWaveStep (188) of an invisible walker', () => {
  it('the server sends PlayWaveStep beyond 3 tiles (Manhattan) and PosUpdateChar within them, for the same char index', () => {
    const steps = rows.filter(r => r.id === A.PlayWaveStep).map(decode);
    expect(steps.length).toBeGreaterThanOrEqual(10);
    const walker = (steps[0] as { charIndex: number }).charIndex;
    for (const p of steps) {
      expect(p).toMatchObject({ id: A.PlayWaveStep, charIndex: walker });
      const step = p as unknown as { grh: number; distance: number; balance: number; step: boolean };
      expect(step.grh).toBeGreaterThan(0);
      expect(step.distance).toBeGreaterThanOrEqual(3); // Distance() is Euclidean: (3,1) away rounds to 3 while Manhattan is 4
      expect([-1, 0, 1]).toContain(step.balance);
    }
    // stepToggle alternates per MOVE, also across the PosUpdateChar steps, so consecutive 188s may repeat a foot; both feet occur.
    expect(new Set(steps.map(p => (p as unknown as { step: boolean }).step))).toEqual(new Set([true, false]));
    const near = rows.filter(r => r.id === S.PosUpdateChar).map(decode);
    expect(near.length).toBeGreaterThan(0);
    for (const p of near) expect(p).toMatchObject({ charIndex: walker });
  });

  it('replayed through the session: one footstep per PlayWaveStep with the distance pan, and the walker leaves MapData until its next position', () => {
    const f = fakeAudio(); const engine = new AudioEngine(f.deps); engine.unlock();
    const session = new Session({ email: 'x', password: 'y' }, () => undefined, () => 5000);
    const renderer = { readyMap: undefined, mapAudio: { music: 0, ambient: '', rain: false, snow: false, fog: false }, terrainAt: () => ({ file: 1, overlay: 0 }), roofAt: () => false, grhFile: () => 0 } as unknown as WorldRenderer;
    const world = new SessionWorld(renderer); world.session = session;
    const director = new AudioDirector(engine, world);
    session.onPacket = packet => director.receive(packet);
    const expectedPans: number[] = [];
    let checked = 0;
    for (const row of rows.filter(r => r.dir === 's2c')) {
      const body = Buffer.from(row.hex, 'hex');
      try { session.receive(new Uint8Array([body.length & 255, body.length >> 8, ...body])); } catch { break; } // the recorded /SALIR ends it
      const p = decode(row);
      if ('unknown' in p) continue;
      if (p.id === A.PlayWaveStep) {
        expectedPans.push(panByDistance(p.distance, Math.sign(p.balance), engine.settings.invertChannels)); // InvertirSonido defaults to 1
        const walker = session.tracker.chars.get(p.charIndex)!;
        expect(walker).toBeDefined();
        expect(session.tracker.at(walker.x, walker.y)).toBeUndefined(); // HandlePlayWaveStep: MapData(.Pos).charindex = 0
        checked++;
      } else if (p.id === S.PosUpdateChar && checked) {
        expect(session.tracker.at(p.x, p.y)?.charIndex).toBe(p.charIndex); // HandlePosUpdateChar puts it back
      }
    }
    // DoPasosInvi plays with no label; the labelled 'pasos<char>' steps are DoPasosFx of visible walkers (NPCs and players moving in view).
    const steps = engine.events.filter(e => e.kind === 'wave' && e.category === 'steps' && !('label' in e));
    expect(steps.map(e => (e as { pan: number }).pan)).toEqual(expectedPans);
    expect(checked).toBe(expectedPans.length);
  });
});
