import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FrameDecoder, KeysClientPacketId as K, WorkSkill, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { DEFAULTS_MODERN, KeyAction, keyAction, vbKeyCode } from '../src/keymap.js';
import { Session } from '../src/session.js';

const ini = `${process.env.AO_ASSETS ?? ''}/OUTPUT/DefaultKey.ini`;

describe('one keymap from DefaultKey.ini [DEFAULTSMODERN]', () => {
  it.skipIf(!process.env.AO_ASSETS || !existsSync(ini))('matches the file binding for binding', () => {
    const text = readFileSync(ini, 'latin1').replace(/\r/g, '');
    const section = text.slice(text.indexOf('[DEFAULTSMODERN]'), text.indexOf('[USER]'));
    const file = new Map([...section.matchAll(/^(\d+)=\s*(\d+),/gm)].map(m => [Number(m[1]), Number(m[2])]));
    expect(Number(/NumBinds=(\d+)/.exec(text)![1])).toBe(34);
    for (let binding = 1; binding <= 34; binding++) expect(DEFAULTS_MODERN[binding as KeyAction], `binding ${binding}`).toBe(file.get(binding));
  });
  it('maps every game key, e.g. O hides, H safe, J tames, Q picks up, F6 meditates, Control attacks', () => {
    expect([keyAction('KeyO'), keyAction('KeyH'), keyAction('KeyJ'), keyAction('KeyQ'), keyAction('KeyT'), keyAction('KeyU'), keyAction('KeyE')])
      .toEqual([KeyAction.Hide, KeyAction.ChangeSafe, KeyAction.Taming, KeyAction.Loot, KeyAction.Drop, KeyAction.UseItem, KeyAction.EquipItem]);
    expect([keyAction('F6'), keyAction('F12'), keyAction('ControlLeft'), keyAction('Enter'), keyAction('Digit1'), keyAction('Digit0')])
      .toEqual([KeyAction.Meditate, KeyAction.ExitGame, KeyAction.Attack, KeyAction.SendText, KeyAction.HotKey1, KeyAction.HotKey10]);
    expect([keyAction('KeyW'), keyAction('KeyA'), keyAction('KeyS'), keyAction('KeyD'), keyAction('ArrowUp'), keyAction('ArrowLeft')])
      .toEqual([KeyAction.MoveUp, KeyAction.MoveLeft, KeyAction.MoveDown, KeyAction.MoveRight, KeyAction.MoveUp, KeyAction.MoveLeft]);
    expect(Object.keys(DEFAULTS_MODERN)).toHaveLength(34);
    expect(vbKeyCode('NumpadMultiply')).toBe(106); expect(keyAction('KeyZ')).toBeUndefined();
  });
  it('Work keys (steal, hide, tame) take the shared work counter', () => {
    const sent: Uint8Array[] = [];
    const s = new Session({ email: 'a', password: 'b' }, b => sent.push(b), () => 0);
    for (const p of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged]) s.receive(encodeServerFrame(p));
    s.sendAction({ id: K.Work, skill: WorkSkill.Hide, counter: 0 }); s.sendAction({ id: K.Work, skill: WorkSkill.Tame, counter: 0 });
    const d = new FrameDecoder();
    expect(sent.flatMap(b => d.push(b).map(decodeClientPacket)).filter(p => p.id === K.Work)).toEqual([
      { id: K.Work, skill: 7, counter: 1 }, { id: K.Work, skill: 24, counter: 2 }]);
  });
});
