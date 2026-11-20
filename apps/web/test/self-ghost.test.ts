import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NpcsServerPacketId as NS, encodeServerFrame } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { CharacterSprites } from '../src/character-render.js';
import { graphicAnimation, parseGraphics, parseHeads, parseIni } from '../src/assets.js';

const root = process.env.AO_ASSETS;
const SELF = f.CharacterCreate.charIndex;
function playing() {
  let now = 0;
  const s = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
  for (const p of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1, body: 1, head: 1, weapon: 5, shield: 6, helmet: 7 }, f.UserCharIndexInServer, f.Logged]) s.receive(encodeServerFrame(p));
  return s;
}
const change = (body: number, head: number) => ({ id: NS.CharacterChange, charIndex: SELF, flags: 0, body, head, heading: 3, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0 }) as const;

describe('own character CharacterChange (death / revival)', () => {
  it('one handler: self body and head swap at once, weapon/shield/helmet 0 keep the previous set (VB6 TempInt <> 0)', () => {
    const s = playing();
    s.receive(encodeServerFrame(change(829, 0)));
    expect(s.tracker.chars.get(SELF)).toMatchObject({ body: 829, head: 0, weapon: 5, shield: 6, helmet: 7 }); // what the renderer draws
    expect(s.self).toMatchObject({ body: 829, head: 0 }); // the session's own copy agrees
    s.receive(encodeServerFrame(change(1, 1)));
    expect(s.tracker.chars.get(SELF)).toMatchObject({ body: 1, head: 1 }); expect(s.self).toMatchObject({ body: 1, head: 1 });
  });
  it.skipIf(!root || !existsSync(`${root}/init/cuerpos.dat`))('the ghost body 829 has a drawable sprite right after the change', () => {
    const graphics = parseGraphics(readFileSync(`${root}/init/graficos.ini`, 'latin1'));
    const sprites = new CharacterSprites({
      graphics, bodies: parseIni(readFileSync(`${root}/init/cuerpos.dat`, 'latin1')), molds: parseIni(readFileSync(`${root}/init/moldes.ini`, 'latin1')),
      heads: parseHeads(new Uint8Array(readFileSync(`${root}/init/cabezas.ind`))), helmets: [], weapons: new Map(), shields: new Map(),
      animation: id => graphicAnimation(graphics, id),
    });
    const s = playing();
    s.receive(encodeServerFrame(change(829, 0)));
    expect(sprites.layers(s.tracker.chars.get(SELF)!, 3).length).toBeGreaterThan(0);
  });
});
