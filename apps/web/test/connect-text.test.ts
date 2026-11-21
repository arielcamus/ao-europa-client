import { describe, expect, it } from 'vitest';
import { CLASS_ROTATION, TEXT, headsFor, raceModifiers, rotateClass, validateCharacterName } from '../src/connect-text.js';
import { ACCOUNT_RECTS, slotAt, slotOrigin } from '../src/connect-ui.js';
import { parseIni } from '../src/assets.js';

describe('character name rules (General.ValidarNombre)', () => {
  it.each([['Ab', TEXT.nameLength], ['A'.repeat(19), TEXT.nameLength], ['Ab1', TEXT.nameChars], ['Añb', TEXT.nameChars], ['Ana  Maria', TEXT.nameSpaces], [' Ana', TEXT.nameEdges], ['Ana ', TEXT.nameEdges]])('%s', (name, problem) => {
    expect(validateCharacterName(name)).toBe(problem);
  });
  it('accepts 3 to 18 letters with single inner spaces', () => {
    expect(validateCharacterName('Ana')).toBeUndefined(); expect(validateCharacterName('Ana Maria Luz')).toBeUndefined(); expect(validateCharacterName('A'.repeat(18))).toBeUndefined();
  });
});

describe('head lists (ModCabezas.DameOpciones = the server ValidarCabeza ranges)', () => {
  const valid = (race: number, gender: number, head: number) => {
    const r = (a: number, b: number) => head >= a && head <= b;
    if (gender === 0) return [r(1, 41) || r(778, 791), r(101, 132) || r(531, 545), r(200, 229) || r(792, 810), r(400, 429), r(300, 344), r(500, 529)][race];
    return [r(50, 80) || r(187, 190) || r(230, 246), r(150, 179) || r(758, 777), r(250, 279), r(450, 479), r(350, 379), r(550, 579)][race];
  };
  it('every head offered is one the server accepts, for all 12 race and gender pairs', () => {
    for (let race = 0; race < 6; race++) for (let gender = 0; gender < 2; gender++) {
      const heads = headsFor(race, gender);
      expect(heads.length).toBeGreaterThan(0);
      expect(heads.every(h => valid(race, gender, h)), `${race}/${gender}`).toBe(true);
    }
  });
  it('humans (male) have 41 + 14 heads, dwarves 45, gnomes 30', () => {
    expect(headsFor(0, 0)).toHaveLength(55); expect(headsFor(4, 0)).toHaveLength(45); expect(headsFor(3, 0)).toHaveLength(30);
  });
});

describe('class selector and race modifiers', () => {
  it('rotates in the VB6 arrow order and back', () => {
    expect(TEXT.classes[rotateClass(0, true)]).toBe('Druida');
    expect(rotateClass(0, false)).toBe(8); // Mago back -> Trabajador
    let at = 0; for (let i = 0; i < CLASS_ROTATION.length; i++) at = rotateClass(at, true);
    expect(at).toBe(0);
  });
  it('reads ModRaza from the [MODRAZA] section', () => {
    const ini = parseIni('[MODRAZA]\nHumanoFuerza=+1\nHumanoAgilidad=+1\nHumanoInteligencia=0\nHumanoCarisma=0\nHumanoConstitucion=+2\nElfoOscuroFuerza=+1\n');
    expect(raceModifiers(ini, 0)).toEqual([1, 1, 0, 2, 0]);
    expect(raceModifiers(ini, 2)[0]).toBe(1);
  });
});

describe('account screen geometry (frmConnect render_MouseUp)', () => {
  it('slots are a 5x2 grid of 79x93 hit areas, 131 and 158 apart', () => {
    expect(slotAt(207, 246)).toBe(1); expect(slotAt(285, 338)).toBe(1); expect(slotAt(286, 300)).toBe(0); expect(slotAt(338, 246)).toBe(2);
    expect(slotAt(207, 404)).toBe(6); expect(slotAt(207 + 131 * 4, 404)).toBe(10); expect(slotAt(100, 300)).toBe(0); expect(slotAt(207, 500)).toBe(0);
  });
  it('character drawing origins follow RenderAccountCharacters', () => {
    expect(slotOrigin(1)).toEqual({ x: 216, y: 283 }); expect(slotOrigin(5)).toEqual({ x: 744, y: 283 }); expect(slotOrigin(6)).toEqual({ x: 216, y: 440 });
  });
  it('button areas', () => { expect(ACCOUNT_RECTS.play).toEqual([605, 712, 154, 33]); });
});

import { filterChatText } from '../src/chat-input.js';
describe('chat text filter is by windows-1252 byte, not code point (issue #16 item 3)', () => {
  it('keeps cp1252 characters in 32..250 and drops the rest', () => {
    expect(filterChatText('hola ñandú €…')).toBe('hola ñandú €…');
    expect(filterChatText('a\u0081b🙂cúdû')).toBe('abcúd'); // U+0081 has no windows-1252 byte, û is byte 251 (> 250)
    expect(filterChatText('ā')).toBe(''); // U+0101 is not in the code page although its code point is 257
  });
});
