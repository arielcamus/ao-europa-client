import { describe, expect, it } from 'vitest';
import { ClientPacketId as C, ServerPacketId as S, SessionClientPacketId as SC, SessionServerPacketId as SS, decodeClientPacket, encodeServerFrame, FrameDecoder } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';

function harness(credentials: { email: string; password: string; create?: boolean } = { email: 'a@local.test', password: 'secret' }) {
  let now = 0;
  const sent: Uint8Array[] = [];
  const session = new Session(credentials, bytes => sent.push(bytes), () => now);
  session.interactive = true;
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  const packets = () => { const decoder = new FrameDecoder(); return sent.flatMap(bytes => decoder.push(bytes).map(decodeClientPacket)); };
  return { session, recv, packets, advance: (ms: number) => { now += ms; } };
}
const char = (id: number, name: string) => ({ ...f.AccountCharacterList.characters[0]!, id, name });

describe('interactive connect flow (frmConnect account screen)', () => {
  it('logs the account in, then waits on the account screen instead of entering the first character', () => {
    const h = harness();
    h.recv(f.Connected);
    expect(h.packets().map(p => p.id)).toEqual([C.LoginAccount]);
    h.recv({ id: S.AccountCharacterList, characters: [char(11, 'Uno'), char(12, 'Dos')] });
    expect(h.session.phase).toBe('account');
    expect(h.session.accountCharacters.map(c => c.name)).toEqual(['Uno', 'Dos']);
    expect(h.packets().map(p => p.id)).toEqual([C.LoginAccount]); // no LoginExistingChar yet
    // The player may take a minute at the account screen: the placement deadline does not run.
    h.advance(120_000);
    expect(() => h.session.tick()).not.toThrow();
    expect(h.session.enterCharacter(h.session.accountCharacters[1]!)).toBe(true);
    expect(h.session.phase).toBe('login');
    expect(h.packets().at(-1)).toEqual({ id: C.LoginExistingChar, charId: 12, name: 'Dos' });
    expect(h.session.enterCharacter(h.session.accountCharacters[0]!)).toBe(false); // already entering
  });
  it('refuses a character that is not on the list', () => {
    const h = harness();
    h.recv(f.Connected, { id: S.AccountCharacterList, characters: [char(11, 'Uno')] });
    expect(h.session.enterCharacter(char(99, 'Otro'))).toBe(false);
    expect(h.session.phase).toBe('account');
  });
  it('creates an account with CreateAccount and accepts the empty character list the server answers with', () => {
    const h = harness({ email: 'new@local.test', password: 'secret', create: true });
    h.recv(f.Connected);
    expect(h.packets()).toEqual([{ id: SC.CreateAccount, email: 'new@local.test', password: 'secret' }]);
    h.recv({ id: S.AccountCharacterList, characters: [] });
    expect(h.session.phase).toBe('account');
    expect(h.session.accountCharacters).toEqual([]);
  });
  it('creates a character with LoginNewChar and shows a refusal (ShowMessageBox) without closing', () => {
    const h = harness();
    h.recv(f.Connected, { id: S.AccountCharacterList, characters: [] });
    expect(h.session.createCharacter({ name: 'Nuevo', race: 1, gender: 1, characterClass: 3, head: 7, home: 7 })).toBe(true);
    expect(h.packets().at(-1)).toEqual({ id: SC.LoginNewChar, name: 'Nuevo', race: 1, gender: 1, characterClass: 3, head: 7, home: 7 });
    h.recv({ id: SS.ShowMessageBox, messageId: 1769, extra: '' });
    expect(h.session.notices).toEqual([{ kind: 'box', messageId: 1769, extra: '' }]);
    h.session.backToAccount();
    expect(h.session.phase).toBe('account');
    expect(h.session.phase).not.toBe('closed');
  });
  it('ErrorMsg is a message for the player in the interactive flow, and still a thrown error for the bot', () => {
    const h = harness();
    h.recv({ id: S.ErrorMsg, message: 'Usuario o Contraseña erronea.' });
    expect(h.session.notices).toEqual([{ kind: 'error', text: 'Usuario o Contraseña erronea.' }]);
    const bot = new Session({ email: 'a', password: 'b' }, () => {});
    expect(() => bot.receive(encodeServerFrame({ id: S.ErrorMsg, message: 'x' }))).toThrow('Server: x');
  });
  it('Disconnect, CerrarleCliente and MostrarCuenta reach the UI callbacks', () => {
    const h = harness(); const seen: string[] = [];
    h.session.onDisconnect = () => seen.push('disconnect'); h.session.onCloseClient = () => seen.push('close'); h.session.onShowAccount = () => seen.push('account');
    h.recv({ id: S.Disconnect, fullLogout: false }, { id: SS.CerrarleCliente }, { id: SS.MostrarCuenta });
    expect(seen).toEqual(['disconnect', 'close', 'account']);
  });
  it('movement toggles, counters, flash and floating text are kept for the UI', () => {
    const h = harness();
    h.recv({ id: SS.NavigateToggle, sailing: true }, { id: SS.EquiteToggle }, { id: SS.NadarToggle, swimming: true, rubberSuit: false }, { id: SS.Contadores, invisibility: 9, effect: 4 },
      { id: SS.FlashScreen, color: 0xff, duration: 300, ignore: false }, { id: SS.TextOverTile, text: 'hola', x: 5, y: 6, color: 255, duration: 1300, offsetY: 0, animated: true },
      { id: SS.TextCharDrop, text: 'chau', charIndex: 3, color: 255, duration: 1300, animated: false });
    expect(h.session.movement).toEqual({ sailing: true, riding: true, swimming: true, rubberSuit: false });
    expect(h.session.timers).toEqual({ invisibility: 9, effect: 4 });
    expect(h.session.flash).toMatchObject({ color: 255, duration: 300 });
    expect(h.session.floatingTexts.map(t => t.text)).toEqual(['hola', 'chau']);
    h.recv({ id: SS.EquiteToggle });
    expect(h.session.movement.riding).toBe(false);
  });
});
