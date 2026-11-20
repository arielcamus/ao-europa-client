import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../src/assets.js';

/** A legacy CSM with no tiles and the given tMapDat sound fields (Recursos.bas tMapDat order). */
function mapWithAudio(musicLow: number, ambient: string, weather: [number, number, number]) {
  const chunks: Buffer[] = [];
  const n = (value: number, size: number) => { const b = Buffer.alloc(size); b.writeIntLE(value, 0, size); chunks.push(b); };
  const text = (value: string) => { const b = Buffer.from(value, 'latin1'); n(b.length, 2); chunks.push(b); };
  n(0, 4); for (let i = 0; i < 4; i++) n(0, 4);
  for (let i = 0; i < 6; i++) n(0, 4);
  for (let i = 0; i < 4; i++) n(0, 2);
  text('Mapa de prueba'); n(0, 1); text('');
  n(77, 4); n(musicLow, 4); n(1, 1);                 // music_numberHi, music_numberLow, safe
  text(''); text(''); text(ambient);                  // zone, terrain, ambient
  for (let i = 0; i < 4; i++) n(0, 4);                // base light, letter, extra1, extra2
  text('');
  for (const flag of weather) n(flag, 1);             // rain, snow, fog
  return Buffer.concat(chunks);
}

describe('map header sound fields', () => {
  it('reads the music number, the ambient and the weather flags', () => {
    const map = parseMap(mapWithAudio(12, '55-56', [1, 0, 1]));
    expect(map.name).toBe('Mapa de prueba');
    expect(map.audio).toEqual({ music: 12, ambient: '55-56', rain: true, snow: false, fog: true });
    expect(parseMap(mapWithAudio(0, '', [0, 1, 0])).audio).toEqual({ music: 0, ambient: '', rain: false, snow: true, fog: false });
  });
  const real = process.env.AO_ASSETS ? `${process.env.AO_ASSETS}/Mapas/mapa1.csm` : '';
  it.skipIf(!real || !existsSync(real))('reads sensible values from a real map (Ullathorpe)', () => {
    const { audio } = parseMap(new Uint8Array(readFileSync(real)));
    expect(Number.isInteger(audio.music) && audio.music >= 0 && audio.music < 5000).toBe(true);
    expect(/^\d*-?\d*$/.test(audio.ambient)).toBe(true);
  });
});
