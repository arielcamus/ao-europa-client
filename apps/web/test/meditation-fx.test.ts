import { describe, expect, it } from 'vitest';
import { MEDITATION_MAX_FX, MEDITATION_TIERS, meditationArt } from '../src/meditation-fx.js';

// Live recording (VB6 server 9ccd7fad, 21 Nov, mage on map 1): level 1 -> MeditateToggle fx 153, level 15 -> 155, level 30 -> 161,
// and fx 0 when the character moves. Dat/Meditaciones.dat names FX 153-172; pre-HOO init/FXs.ini has 150 entries (FX 115-120 among them).
const none = () => false;
describe('meditation aura by level', () => {
  it('the server tiers are the Meditaciones.dat ranges: 10 citizen FX (153, 155 ... 171) and 10 criminal FX (154 ... 172)', () => {
    expect(MEDITATION_TIERS.map(t => t.to)).toEqual([12, 17, 24, 28, 32, 36, 39, 42, 44, 46]);
    expect(MEDITATION_TIERS.map(t => t.citizen)).toEqual([153, 155, 157, 159, 161, 163, 165, 167, 169, 171]);
    expect(MEDITATION_TIERS.map(t => t.criminal)).toEqual([154, 156, 158, 160, 162, 164, 166, 168, 170, 172]);
  });
  it('an FX that FXs.ini has is drawn as sent', () => {
    expect(meditationArt(153, id => id === 153)).toBe(153);
    expect(meditationArt(MEDITATION_MAX_FX, id => id === 120)).toBe(120);
  });
  it('FX 153-172 are missing from the pre-HOO FXs.ini: drawn with the classic step of their level, growing with level', () => {
    const art = (fx: number) => meditationArt(fx, none);
    expect([153, 155, 161, 171].map(art)).toEqual([115, 116, 117, 119]);
    // 13-17 mixes the classic 115 (13-14) and 116; 33-36 mixes 117 (33-35) and 118: the majority wins.
    expect(MEDITATION_TIERS.map(t => art(t.citizen))).toEqual([115, 116, 116, 117, 117, 117, 118, 118, 118, 119]);
    expect(MEDITATION_TIERS.map(t => art(t.criminal))).toEqual(MEDITATION_TIERS.map(t => art(t.citizen)));
  });
  it('an id that is no meditation tier is kept as it is', () => { expect(meditationArt(7, none)).toBe(7); expect(meditationArt(120, none)).toBe(120); });
});
