import { describe, expect, it } from 'vitest';
import { ClientPacketId as C, NpcsServerPacketId as NS, ServerPacketId as S, SpellClientPacketId as SC, SpellServerPacketId as SS, FrameDecoder, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { parseIni } from '../src/assets.js';
import { Session } from '../src/session.js';
import { MSG_CLICK_TARGET, MSG_TOO_FAST, spellTables, swapSpellSlots } from '../src/spells.js';
import { ChatLocale } from '../src/chat-locale.js';
import { expandConsoleText } from '../src/chat-console.js';

const hechizos = parseIni(`[HECHIZO1]\nNombre=Dardo Mágico\nDesc=Causa 5 a 10 puntos de daño a la víctima.\nHechizeroMsg=Has lanzado Dardo Mágico sobre\nTargetMsg=lanzó Dardo Mágico sobre vos.\nPropioMsg=Has invocado un Lobo\nManaRequerido=10\nMinSkill=0\nStaRequerido=5\n`);
// Spell console text is chat's pipeline (ChatLocale + expandConsoleText); spells only supplies Dat/Hechizos.dat.
const chatLocale = new ChatLocale(); chatLocale.load('[SP_MSG]\nMsg8=Estás muy lejos.\nMsg1=[¬1] ha sido expulsado del clan (¬2).\n'); chatLocale.spellData = hechizos;

function harness() {
  let now = 0;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
  const clientPackets = () => { const d = new FrameDecoder(); return sent.flatMap(b => d.push(b)).map(decodeClientPacket); };
  return { session, recv, clientPackets, advance: (ms: number) => { now += ms; } };
}

describe('spell text resolvers (HandleConsoleMessage tokens and Locale_Parse_ServerMessage)', () => {
  it('expands HECINF (with the HechizoData requirement lines), ProMSG, HecMSG, HecMSGU and HecMSGA like the VB6 client', () => {
    expect(expandConsoleText('HECINF*1', chatLocale)).toBe(['------------< Información del hechizo >------------', 'Nombre: Dardo Mágico',
      'Descripción: Causa 5 a 10 puntos de daño a la víctima.', 'Skill requerido: 0 de magia.', 'Mana necesario: 10 puntos.', 'Stamina necesaria: 5 puntos.'].join('\n'));
    expect(expandConsoleText('ProMSG*1', chatLocale)).toBe('Has invocado un Lobo');
    expect(expandConsoleText('HecMSG*1', chatLocale)).toBe('Has lanzado Dardo Mágico sobre la criatura.');
    expect(expandConsoleText('HecMSGU*1*Ana', chatLocale)).toBe('Has lanzado Dardo Mágico sobre Ana.');
    expect(expandConsoleText('HecMSGA*1*Ana', chatLocale)).toBe('Ana lanzó Dardo Mágico sobre vos.');
    expect(expandConsoleText('Hola * mundo', chatLocale)).toBe('Hola * mundo');
  });
  it('fills locale placeholders from the ¬ separated extra', () => {
    expect(chatLocale.message(8, '')).toBe('Estás muy lejos.');
    expect(chatLocale.message(1, 'Ana¬por mal')).toBe('[Ana] ha sido expulsado del clan (por mal).');
    expect(expandConsoleText('ID*8*', chatLocale)).toBe('Estás muy lejos.');
  });
  it('swaps list entries like cmdMoverHechi_Click and refuses to leave the list', () => {
    const spells = new Map([[1, { slot: 1, spell: 1, index: 1 }], [2, { slot: 2, spell: 7, index: 7 }]]);
    expect(swapSpellSlots(spells, 2, true)).toBe(1);
    expect(spells.get(1)).toEqual({ slot: 1, spell: 7, index: 7 }); expect(spells.get(2)).toEqual({ slot: 2, spell: 1, index: 1 });
    expect(swapSpellSlots(spells, 1, true)).toBe(1); expect(swapSpellSlots(spells, 40, false)).toBe(40);
    expect(swapSpellSlots(new Map(), 3, false)).toBe(3);
  });
});

describe('spell session behaviour', () => {
  it('casts, waits for the server target request, then sends one WorkLeftClick and clears the cursor', () => {
    spellTables.spells = hechizos;
    const h = harness(); h.session.ui.chat.locale = chatLocale;
    expect(h.session.spells.cast(0, 'x')).toBe(false); expect(h.session.spells.cast(1, '(Vacío)')).toBe(false);
    expect(h.session.spells.click(5, 5)).toBe(false); // nothing asked for a target
    expect(h.session.spells.cast(1, 'Dardo Mágico')).toBe(true);
    expect(h.session.spells.targeting).toBeUndefined(); // only the server's WorkRequestTarget arms the cursor
    h.recv({ id: SS.WorkRequestTarget, skill: 1, area: false, radius: 0 });
    expect(h.session.spells.targeting).toEqual({ skill: 1, area: false, radius: 0 });
    expect(h.session.ui.messages.at(-1)?.text).toBe(MSG_CLICK_TARGET);
    expect(h.session.spells.click(60, 44)).toBe(true);
    expect(h.session.spells.targeting).toBeUndefined();
    expect(h.session.spells.click(60, 44)).toBe(false);
    h.session.spells.info(2); h.session.spells.move(true, 2);
    expect(h.clientPackets().filter(p => [SC.CastSpell, SC.WorkLeftClick, SC.SpellInfo, SC.MoveSpell].includes(p.id as SC))).toEqual([
      { id: SC.CastSpell, slot: 1, counter: 1 }, { id: SC.WorkLeftClick, x: 60, y: 44, skill: 1, counter: 1 },
      { id: SC.SpellInfo, slot: 2 }, { id: SC.MoveSpell, up: true, slot: 2 },
    ]);
  });
  it('clears the cursor on a skill-0 request or a map change, and warns when clicks come faster than the magic interval', () => {
    const h = harness();
    h.recv({ id: SS.WorkRequestTarget, skill: 1, area: true, radius: 3 });
    expect(h.session.spells.targeting?.radius).toBe(3);
    h.recv({ id: SS.WorkRequestTarget, skill: 0, area: false, radius: 0 });
    expect(h.session.spells.targeting).toBeUndefined();
    h.recv({ id: SS.WorkRequestTarget, skill: 1, area: false, radius: 0 }); h.recv({ ...f.ChangeMap });
    expect(h.session.spells.targeting).toBeUndefined();
    h.recv({ id: SS.WorkRequestTarget, skill: 1, area: false, radius: 0 }); h.session.spells.click(1, 1);
    h.recv({ id: SS.WorkRequestTarget, skill: 1, area: false, radius: 0 }); h.advance(10); h.session.spells.click(1, 1);
    expect(h.session.ui.messages.filter(m => m.text === MSG_TOO_FAST)).toHaveLength(1);
  });
  it('CreateFX with fx 0 clears that character\'s FX and a CharacterRemove drops its FX (HandleCreateFX/SetCharacterFx)', () => {
    const h = harness();
    h.recv({ id: SS.CreateFX, charIndex: 40, fx: 15, loops: -1, x: 0, y: 0 }, { id: SS.CreateFX, charIndex: 41, fx: 16, loops: -1, x: 0, y: 0 });
    h.recv({ id: SS.CreateFX, charIndex: 40, fx: 0, loops: 0, x: 0, y: 0 });
    expect(h.session.spells.effects.map(e => e.charIndex)).toEqual([41]);
    h.recv({ id: NS.CharacterRemove, charIndex: 41, vanish: false, warp: false });
    expect(h.session.spells.effects).toEqual([]);
  });
  it('GetInventarioHechizos flips the panel request; a followed client reports its panel with NotifyInventarioHechizos, an unfollowed one stays silent', () => {
    const h = harness();
    h.recv({ id: SS.GetInventarioHechizos, value: 2, hechiSel: 4, scrollSel: 1 });
    expect(h.session.spells.panelRequest).toEqual({ value: 2, selected: 4, scroll: 1, seq: 1 });
    const notified = () => h.clientPackets().filter(p => p.id === SC.NotifyInventarioHechizos);
    h.session.spells.notifyPanel(2, 4, 1); expect(notified()).toEqual([]);
    h.session.spells.followed = true; h.session.spells.notifyPanel(1, 0, 0);
    expect(notified()).toEqual([{ id: SC.NotifyInventarioHechizos, value: 1, hechiSel: 0, scrollSel: 0 }]);
  });
  it('records spell effects, cools down and prints locale and token console text', () => {
    spellTables.spells = hechizos;
    const h = harness(); h.session.ui.chat.locale = chatLocale;
    h.recv({ id: SS.CreateFX, charIndex: 2555, fx: 15, loops: 0, x: 0, y: 0 }, { id: SS.FxFloor, x: 51, y: 60, grh: 20 });
    expect(h.session.spells.effects.map(e => [e.fx, e.charIndex, e.grh])).toEqual([[15, 2555, undefined], [0, undefined, 20]]);
    h.advance(5000); h.session.spells.prune(5000, () => 600);
    expect(h.session.spells.effects).toEqual([]);
    h.recv({ id: SS.CreateFX, charIndex: 1, fx: 3, loops: -1, x: 0, y: 0 }); h.session.spells.prune(1e9, () => 100);
    expect(h.session.spells.effects).toHaveLength(1); // loops -1 never expires
    h.recv({ id: NS.LocaleMsg, messageId: 8, text: '', font: 7, channel: 1 });
    h.recv({ id: S.ConsoleMsg, message: 'HecMSG*1', font: 7 });
    h.recv({ id: SS.SendSkillCdUpdate, typeId: 4, skillId: 9, timeLeft: 1000, totalTime: 2000, effectType: 2, stacks: 1 });
    expect(h.session.ui.messages.map(m => m.text).slice(-2)).toEqual(['Estás muy lejos.', 'Has lanzado Dardo Mágico sobre la criatura.']);
    expect(h.session.spells.cooldowns.get(9)?.totalTime).toBe(2000);
  });
  it('ignores ids it does not own and uses the unchanged walk path', () => {
    const h = harness();
    h.recv(f.UpdateMana); expect(h.session.ui.stats.mana).toBe(60);
    expect(h.clientPackets().some(p => p.id === C.Walk)).toBe(false);
  });
});
