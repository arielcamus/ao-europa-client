import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS, STEP_SOUNDS, Terrain, ambientWave, readField, vbVal, effectiveVolume, gainOf, inHearingArea, mapMusicId, musicFile, panAt, panByDistance,
  parseZones, sanitizeSettings, stepWave, terrainOf, volumeByDistance, waveFile,
} from '../src/audio-rules.js';

describe('volume, pan and area rules (ao20audio.bas, clsAudioEngine.cls)', () => {
  it('attenuates 120 per tile of Manhattan distance and floors at -4000', () => {
    expect(volumeByDistance(0, 0)).toBe(0);
    expect(volumeByDistance(0, 5)).toBe(-600);
    expect(volumeByDistance(-1000, 10)).toBe(-2200);
    expect(volumeByDistance(0, 19)).toBe(-2280);
    expect(volumeByDistance(0, 20)).toBe(-4000);
    expect(volumeByDistance(-3900, 3)).toBe(-4000);
    expect(volumeByDistance(0, -4)).toBe(-480);
  });
  it('converts a DirectSound attenuation to a gain like ConvertFxVolumeToBass', () => {
    expect(gainOf(0)).toBe(1); expect(gainOf(100)).toBe(1);
    expect(gainOf(-2000)).toBeCloseTo(0.1, 6); expect(gainOf(-4000)).toBeCloseTo(0.01, 6);
    expect(gainOf(-10_000)).toBe(0);
  });
  it('plays at the quieter of the category volume and the request', () => {
    expect(effectiveVolume(-1000, 0)).toBe(-1000);
    expect(effectiveVolume(0, -600)).toBe(-600);
    expect(effectiveVolume(-2000, -600)).toBe(-2000);
  });
  it('pans by 500 per tile, 9000 from 19 tiles, with the inverted-channels default', () => {
    expect(panAt(10, 10, 10, 10, true)).toBe(0);
    expect(panAt(10, 12, 10, 10, true)).toBe(0); // same column
    expect(panAt(13, 10, 10, 10, false)).toBe(1500); // right of the player
    expect(panAt(7, 10, 10, 10, false)).toBe(-1500);
    expect(panAt(13, 10, 10, 10, true)).toBe(-1500); // InvertirSonido flips it
    expect(panAt(40, 10, 10, 10, false)).toBe(9000);
    expect(panByDistance(4, 1, false)).toBe(2000);
    expect(panByDistance(4, 1, true)).toBe(-2000);
    expect(panByDistance(0, 1, false)).toBe(0);
    expect(panByDistance(30, -1, false)).toBe(-9000);
  });
  it('hears the 23x19 window around the player (MinXBorder 12, MinYBorder 10)', () => {
    expect(inHearingArea(61, 50, 50, 50)).toBe(true);
    expect(inHearingArea(62, 50, 50, 50)).toBe(false);
    expect(inHearingArea(50, 59, 50, 50)).toBe(true);
    expect(inHearingArea(50, 60, 50, 50)).toBe(false);
    expect(inHearingArea(39, 41, 50, 50)).toBe(true);
    expect(inHearingArea(38, 50, 50, 50)).toBe(false);
  });
});

describe('footsteps (TileEngine.GetTerrenoDePaso, Recursos.CargarPasos)', () => {
  it('maps a ground file number to its terrain', () => {
    expect(terrainOf(6001, 0)).toBe(Terrain.Forest);
    expect(terrainOf(551, 0)).toBe(Terrain.Forest);
    expect(terrainOf(7503, 0)).toBe(Terrain.Dungeon);
    expect(terrainOf(1533, 0)).toBe(Terrain.Dungeon);
    expect(terrainOf(5002, 0)).toBe(Terrain.Snow);
    expect(terrainOf(6021, 0)).toBe(Terrain.Desert);
    expect(terrainOf(186, 0)).toBe(Terrain.Desert);
    expect(terrainOf(6018, 0)).toBe(Terrain.Forest); // the forest range is tested first
    expect(terrainOf(20, 0)).toBe(Terrain.Water);
    expect(terrainOf(20, 4321)).toBe(Terrain.Floor); // a bridge or dock over the water
    expect(terrainOf(1, 0)).toBe(Terrain.Floor);
  });
  it('alternates two waves per terrain', () => {
    expect(STEP_SOUNDS[Terrain.Floor]).toEqual([23, 24]);
    expect(stepWave(Terrain.Forest, true)).toBe(201);
    expect(stepWave(Terrain.Forest, false)).toBe(69);
    expect(stepWave(Terrain.Horse, true)).toBe(70);
    expect(stepWave(Terrain.Water, true)).toBe(50);
  });
});

describe('server waves, ambient and music selection', () => {
  it('skips the fog waves 400-404 without fog and localizes only when asked', () => {
    expect(waveFile(402, 0, 'es', false)).toBeUndefined();
    expect(waveFile(402, 0, 'es', true)).toBe('402');
    expect(waveFile(399, 0, 'es', false)).toBe('399');
    expect(waveFile(123, 1, 'es', false)).toBe('123');
    expect(waveFile(123, 1, 'en', false)).toBe('en_123');
    expect(waveFile(123, 0, 'en', false)).toBe('123');
  });
  it('reads the ambient as PlayAmbientAudio does: ReadField over val(ambient), so the first number plays day and night', () => {
    expect(ambientWave('12-34', false)).toBe(12);
    expect(ambientWave('12-34', true)).toBe(12);
    expect(ambientWave('0-0', false)).toBe(0);
    expect(ambientWave('0-34', true)).toBe(0);
    expect(ambientWave('', false)).toBe(0);
    expect(ambientWave('514', false)).toBe(514);
    expect(ambientWave('514', true)).toBe(514);
    expect(readField(2, '514', '-')).toBe('514'); // no separator: ReadField returns the whole text for any field
    expect(readField(2, '1-2-3', '-')).toBe('2');
    expect(readField(3, '1-2-3', '-')).toBe('3');
    expect(vbVal('  17-4')).toBe(17); expect(vbVal('abc')).toBe(0);
  });
  it('picks the zone under the player, else the map header, and names the ogg ost_<id>', () => {
    const zones = parseZones('[Config]\nCantidad=2\n\n[Zona1]\nMapa=172\nMusica=3\nX1=1\nX2=50\nY1=1\nY2=100\n\n[Zona2]\nMapa=172\nMusica=0\nX1=60\nX2=70\nY1=10\nY2=20\n');
    expect(zones).toEqual([{ map: 172, music: 3, x1: 1, x2: 50, y1: 1, y2: 100 }, { map: 172, music: 0, x1: 60, x2: 70, y1: 10, y2: 20 }]);
    expect(mapMusicId(zones, 172, 10, 10, 9)).toBe(3);
    expect(mapMusicId(zones, 172, 65, 15, 9)).toBe(9); // a zone with Musica=0 falls back to the header
    expect(mapMusicId(zones, 5, 10, 10, 9)).toBe(9);
    expect(mapMusicId(zones, 5, 10, 10, 0)).toBe(0);
    expect(musicFile(31)).toBe('ost_31');
  });
});

describe('settings', () => {
  it('defaults to everything on at full volume (DefaultSettings.ini [AUDIO])', () => {
    expect(DEFAULT_AUDIO_SETTINGS).toMatchObject({ audioEnabled: true, musicEnabled: true, fxEnabled: true, ambientEnabled: true, invertChannels: true, volMusic: 0, volFx: 0 });
  });
  it('clamps stored volumes to -4000..0 and ignores junk', () => {
    expect(sanitizeSettings({ volMusic: 100, volFx: -9999, volSteps: -250.6, volAmbient: 'loud', musicEnabled: false, evil: 1 })).toEqual({
      ...DEFAULT_AUDIO_SETTINGS, volMusic: 0, volFx: -4000, volSteps: -251, musicEnabled: false,
    });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});
