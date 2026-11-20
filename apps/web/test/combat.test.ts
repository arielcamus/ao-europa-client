import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BodyPart, ClientPacketId as C, CombatClientPacketId as CC, CombatServerPacketId as CS, DoorClientPacketId as DC, NpcsServerPacketId as NS, FrameDecoder, ServerPacketId as S, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { ponerPuntos, vbColor } from '../src/combat.js';
import { ChatLocale } from '../src/chat-locale.js';
import { ChatInput } from '../src/chat-input.js';
// LocaleMsg goes through chat's one console pipeline (ChatLocale); combat no longer parses it.
const chatLocale = (text: string) => { const l = new ChatLocale(); l.load(text); return l; };

const SELF = 0x1234, NPC = 77;
function harness() {
  let now = 1000;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => now);
  session.ui.chat.locale = chatLocale('[SP_MSG]\nMsg77=¡Estás muerto! Ve al sacerdote más cercano para poder volver a la vida.\nMsg382=Le has causado ¬1 puntos de daño a la criatura.\nMsg585=¡Has sido resucitado!\n');
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, { ...f.Intervals, hit: 1400, leftClick: 100 }, f.ChangeMap,
    { ...f.CharacterCreate, speeding: 1, heading: 2, body: 107, head: 1, minHp: 20, maxHp: 20 }, f.UserCharIndexInServer, f.Logged,
    { ...f.CharacterCreate, charIndex: NPC, name: 'Lobo', x: 51, y: 60, npc: 1, body: 300, head: 0 });
  const decoded = () => { const d = new FrameDecoder(); return sent.flatMap(bytes => d.push(bytes).map(decodeClientPacket)); };
  return { session, recv, sent, decoded, advance: (ms: number) => { now += ms; } };
}

describe('attack (WriteAttack, Control key)', () => {
  it('sends Attack with an increasing counter and honours Intervals.hit, the first one always passing', () => {
    const h = harness();
    expect(h.session.attack()).toBe(true);
    expect(h.session.attack()).toBe(false);
    h.advance(1399); expect(h.session.attack()).toBe(false);
    h.advance(1); expect(h.session.attack()).toBe(true);
    expect(h.decoded().filter(p => p.id === CC.Attack)).toEqual([{ id: CC.Attack, counter: 1 }, { id: CC.Attack, counter: 2 }]);
    expect(h.session.combat.attacksSent).toBe(2);
  });
  it('refuses to attack before placement', () => {
    const session = new Session({ email: 'a', password: 'b' }, () => { throw new Error('nothing may be sent'); }, () => 0);
    expect(session.attack()).toBe(false);
  });
  it('a dead character gets the local message and sends nothing (modBindKeys.Accionar)', () => {
    const h = harness(); h.recv({ id: S.UpdateHP, hp: 0, shield: 0 });
    expect(h.session.dead).toBe(true);
    expect(h.session.attack()).toBe(false);
    expect(h.decoded().some(p => p.id === CC.Attack)).toBe(false);
    expect(h.session.ui.messages.at(-1)?.text).toBe('¡¡Estás muerto!!');
  });
});

describe('server responses', () => {
  it('prints the creature hit, player hits and the localized damage line with VB6 number formatting', () => {
    const h = harness();
    h.recv({ id: CS.NPCHitUser, place: BodyPart.Head, damage: 1234 }, { id: CS.UserHittedUser, charIndex: NPC, place: BodyPart.Torso, damage: 5 },
      { id: CS.UserHittedByUser, charIndex: NPC, place: BodyPart.LeftArm, damage: 12 },
      { id: NS.LocaleMsg, messageId: 382, text: '1.234', font: 1, channel: 5 });
    expect(h.session.ui.messages.map(m => m.text)).toEqual([
      'La criatura te ha pegado en la cabeza por 1.234', 'Le has pegado a Lobo en el torso por 5.',
      'Lobo te ha pegado el brazo izquierdo por 12.', 'Le has causado 1.234 puntos de daño a la criatura.']);
    expect(h.session.ui.messages[0]!.font).toBe(1); // FONTTYPE_FIGHT: chat's fontStyle draws it red and bold
    expect(h.session.combat).toMatchObject({ hitsTaken: 2, hitsDealt: 1 });
  });
  it('updates HP, the ghost body on death and the living body on revival', () => {
    const h = harness();
    h.recv(f.UpdateUserStats, { id: S.UpdateHP, hp: 0, shield: 0 });
    expect(h.session.ui.stats.hp).toBe(0); expect(h.session.dead).toBe(true);
    const change = { id: NS.CharacterChange, charIndex: SELF, flags: 1, body: 829, head: 0, heading: 2, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0 } as const;
    h.recv(change);
    expect(h.session.tracker.chars.get(SELF)).toMatchObject({ body: 829, head: 0 }); // the npcs tracker owns appearance (renderer draws from it)
    h.recv({ id: S.UpdateHP, hp: 1, shield: 0 }, { ...change, body: 107, head: 1 }, { id: NS.LocaleMsg, messageId: 585, text: '', font: 43, channel: 3 });
    expect(h.session.dead).toBe(false); expect(h.session.tracker.chars.get(SELF)).toMatchObject({ body: 107, head: 1 });
    expect(h.session.ui.messages.at(-1)).toMatchObject({ text: '¡Has sido resucitado!', font: 43 });
  });
  it('floats damage text with VB colours, stacks lines and expires them after 1300 ms', () => {
    const h = harness();
    h.recv({ id: CS.TextOverChar, text: '8', charIndex: NPC, color: 0x0000ff }, { id: CS.TextOverChar, text: '9', charIndex: NPC, color: 0x00ffff });
    const [first, second] = h.session.combat.floating;
    expect(first).toMatchObject({ text: '8', color: 'rgb(255, 0, 0)', slide: -14 });
    expect(second).toMatchObject({ text: '9', color: 'rgb(255, 255, 0)', slide: 0 });
    h.advance(1301); h.session.combat.prune(h.session.combat['floating'][0]!.start + 1301);
    expect(h.session.combat.floating).toHaveLength(0);
  });
  it('shows "Fallo" only for my own swings, and starts a blood splash on a hit victim', () => {
    const h = harness();
    h.recv({ id: CS.CharSwing, charIndex: NPC, showFx: true, showText: true, notifyText: true });
    expect(h.session.combat.floating).toHaveLength(0);
    h.recv({ id: CS.CharSwing, charIndex: SELF, showFx: true, showText: true, notifyText: true });
    expect(h.session.combat.floating[0]).toMatchObject({ text: 'Fallo', charIndex: SELF });
    h.recv({ id: CS.CharAtaca, charIndex: NPC, victimIndex: SELF, damage: 4 }, { id: CS.CharAtaca, charIndex: NPC, victimIndex: SELF, damage: -1 });
    expect(h.session.combat.fx).toEqual([expect.objectContaining({ charIndex: SELF, fx: 14, loops: 0 })]);
    h.recv({ id: CS.CreateFX, charIndex: NPC, fx: 3, loops: 0, x: 0, y: 0 });
    expect(h.session.combat.fx).toHaveLength(2);
  });
  it('removes a killed creature and its floating text', () => {
    const h = harness();
    h.recv({ id: CS.TextOverChar, text: '3', charIndex: NPC, color: 0 }, { id: NS.CharacterRemove, charIndex: NPC, vanish: true, warp: false });
    expect(h.session.characters.has(NPC)).toBe(false); expect(h.session.tracker.chars.has(NPC)).toBe(false); expect(h.session.combat.floating).toHaveLength(0);
  });
  it('a locale id with no template prints one empty console line (chat pipeline, like HandleLocaleMsg)', () => {
    const h = harness(); h.recv({ id: NS.LocaleMsg, messageId: 9999, text: '', font: 1, channel: 5 });
    expect(h.session.ui.messages.map(m => m.text)).toEqual(['']);
  });
});

describe('resurrection and target selection', () => {
  it('sends LeftClick on a tile, paced by Intervals.leftClick, and rejects tiles off the map', () => {
    const h = harness();
    expect(h.session.leftClick(51, 60)).toBe(true);
    expect(h.session.leftClick(51, 60)).toBe(false);
    h.advance(100); expect(h.session.leftClick(0, 5)).toBe(false); expect(h.session.leftClick(52, 60)).toBe(true);
    expect(h.decoded().filter(p => p.id === DC.LeftClick)).toEqual([{ id: DC.LeftClick, x: 51, y: 60, counter: 1 }, { id: DC.LeftClick, x: 52, y: 60, counter: 2 }]);
  });
  it('turns /RESUCITAR and /CURAR typed in chat into Resucitate and Heal, not Talk', () => {
    const h = harness();
    const input = new ChatInput(); // the chat box parses commands (ParseUserCommand)
    expect(h.session.sendChat(input.submit('/resucitar').packet!)).toBe(true); expect(h.session.sendChat(input.submit('/CURAR').packet!)).toBe(true);
    expect(h.decoded().map(p => p.id)).toEqual([C.LoginAccount, C.LoginExistingChar, CC.Resucitate, CC.Heal]);
    expect(h.session.talk('hola')).toBe(true);
    expect(h.decoded().at(-1)).toMatchObject({ id: C.Talk, message: 'hola' });
  });
});

describe('helpers', () => {
  it('PonerPuntos groups thousands with dots', () => {
    expect([0, 999, 1000, 12345, 1234567, -5].map(ponerPuntos)).toEqual(['0', '999', '1.000', '12.345', '1.234.567', '-5']);
  });
  it('replaces ¬n fields from the highest down (chat ChatLocale) and maps VB colours', () => {
    expect(chatLocale('[SP_MSG]\nMsg1=¬1 y ¬10 y ¬2').message(1, 'a¬b¬3¬4¬5¬6¬7¬8¬9¬j')).toBe('a y j y b');
    expect(vbColor(0x00ff8040)).toBe('rgb(64, 128, 255)');
  });
});

describe('replay of a real VB6 melee session (tests/fixtures/vb6/combat/melee-dummy.jsonl)', () => {
  it('drives the session through login, hits and misses with no rejected frame', () => {
    const lines = readFileSync(new URL('../../../tests/fixtures/vb6/combat/melee-dummy.jsonl', import.meta.url), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as { dir: string; hex: string });
    const session = new Session({ email: 'x', password: 'y' }, () => undefined, () => 5000);
    session.ui.chat.locale = chatLocale('[SP_MSG]\nMsg382=Le has causado ¬1 puntos de daño a la criatura.\nMsg1626=+1 ¬1\n');
    for (const line of lines.filter(l => l.dir === 's2c')) {
      const body = Buffer.from(line.hex, 'hex');
      session.receive(new Uint8Array([body.length & 255, body.length >> 8, ...body]));
    }
    const text = session.ui.messages.map(m => m.text);
    expect(text.filter(t => /^Le has causado \d+ puntos de daño a la criatura\.$/.test(t)).length).toBeGreaterThan(0);
    expect(session.combat.misses).toBeGreaterThan(0);
    expect(session.combat.floating.some(f => f.color === 'rgb(255, 0, 0)' && f.charIndex !== session.charIndex)).toBe(true);
    expect(session.combat.swings.size).toBe(1);
    expect(session.ui.stats.hp).toBe(20);
    expect(session.dead).toBe(false);
  });
});
