import { describe, expect, it } from 'vitest';
import { ServerPacketId as S, ClientPacketId as C, FrameDecoder, decodeClientPacket, encodeServerFrame, toVbColor } from '@ao/protocol';
import type { CharacterCreate, ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { characterName, dialogLife, DIALOG_FADE_MS } from '../src/chat-state.js';
import { ChatLocale } from '../src/chat-locale.js';
import { expandConsoleText, formatLine, plainText, readField, vbVal } from '../src/chat-console.js';
import { fontStyle, nameColor, privilegeLevel } from '../src/chat-fonts.js';
import { ChatInput, SendingType, filterChatText } from '../src/chat-input.js';
import { bubblePlacement } from '../src/chat-bubbles.js';
import { ClassicState } from '../src/ui-state.js';
import { Session } from '../src/session.js';
import { readFileSync } from 'node:fs';
import { decodeServerPacket } from '@ao/protocol';

const locale = new ChatLocale();
// Same shape as init/SP_LocalMsg.dat and init/sp_localindex.dat (windows-1252 text, U+00AC parameters).
locale.load([
  '[NPC7]', 'NAME=Sacerdote', 'DESC=Hola, hijo mio.', '[OBJ3]', 'NAME=Espada', '[QUEST2]', 'DESCFINAL=Gracias por tu ayuda.',
  '[HECHIZO5]', 'NOMBRE=Dardo', 'PALABRASMAGICAS=OHL VOR', 'PROPIOMSG=Te curaste.', 'HECHIZEROMSG=Has lanzado Dardo sobre', 'TARGETMSG=lanzó Dardo sobre vos.',
  '[SP_MSG]', 'Msg1=[¬1] ha ingresado al clan ¬2.', 'Msg2=Hola',
].join('\r\n'));
const character = (over: Partial<CharacterCreate> = {}): CharacterCreate => ({ ...f.CharacterCreate, charIndex: 1, name: 'Ariel', status: 1, privileges: 0, npc: 0, ...over });

describe('console font and colour tables', () => {
  it('has the 44 classic font types with their bold/italic flags', () => {
    expect(fontStyle(0)).toEqual({ r: 255, g: 255, b: 255, bold: false, italic: false });
    expect(fontStyle(1)).toEqual({ r: 255, g: 0, b: 0, bold: true, italic: false });
    expect(fontStyle(2)).toMatchObject({ bold: false, italic: true });
    expect(fontStyle(7)).toMatchObject({ r: 0, g: 255, b: 0 }); // FONTTYPE_VENENO sets only green
    expect(fontStyle(9)).toMatchObject({ r: 0, g: 185, b: 0 }); // FONTTYPE_SERVER sets only green
    expect(fontStyle(43)).toMatchObject({ r: 0, g: 255, b: 0, bold: true });
    expect(fontStyle(99)).toEqual(fontStyle(0));
  });
  it('colours a name by privilege first, then by faction status', () => {
    expect(privilegeLevel(8)).toBe(3);
    expect(nameColor(1, 0)).toEqual([6, 128, 255]);
    expect(nameColor(0, 0)).toEqual([255, 0, 0]);
    expect(nameColor(2, 0)).toEqual([255, 51, 51]);
    expect(nameColor(1, privilegeLevel(8))).toEqual([0, 225, 0]);
  });
});

describe('console text', () => {
  it('uses the font table, or the trailing ~r~g~b~bold~italic when present', () => {
    expect(formatLine({ kind: 'console', message: 'Hola', font: 3 }, locale)).toEqual([{ text: 'Hola', r: 65, g: 190, b: 156, bold: false, italic: false }]);
    expect(formatLine({ kind: 'console', message: 'Aviso~300~20~x~1~0', font: 3 }, locale)).toEqual([{ text: 'Aviso', r: 255, g: 20, b: 0, bold: true, italic: false }]);
  });
  it('expands the special KEY*arg prefixes from local data', () => {
    expect(expandConsoleText('NPCNAME*7*, un NPC', locale)).toBe('Sacerdote, un NPC');
    expect(expandConsoleText('O*3*(x2)', locale)).toBe('Espada (x2)');
    expect(expandConsoleText('ProMSG*5', locale)).toBe('Te curaste.');
    expect(expandConsoleText('HecMSG*5', locale)).toBe('Has lanzado Dardo sobre la criatura.');
    expect(expandConsoleText('HecMSGU*5*Pepe', locale)).toBe('Has lanzado Dardo sobre Pepe.');
    expect(expandConsoleText('HecMSGA*5*Pepe', locale)).toBe('Pepe lanzó Dardo sobre vos.');
    expect(expandConsoleText('ID*1*Ana¬Los Fieles', locale)).toBe('[Ana] ha ingresado al clan Los Fieles.');
    expect(expandConsoleText('Sin prefijo', locale)).toBe('Sin prefijo');
    expect(readField(3, 'a*b', '*')).toBe(''); expect(vbVal('12abc')).toBe(12); expect(vbVal('x')).toBe(0);
  });
  it('fills locale parameters in reverse so ¬1 never eats ¬10, and passes id 2266 through', () => {
    const big = new ChatLocale(); big.load('[SP_MSG]\r\nMsg9=¬1 ¬10');
    expect(big.message(9, 'a¬b¬c¬d¬e¬f¬g¬h¬i¬j')).toBe('a j');
    expect(big.message(2266, 'literal')).toBe('literal');
    expect(big.message(404, 'x')).toBe('');
  });
  it('formats a locale message, a faction message and a guild line', () => {
    expect(plainText(formatLine({ kind: 'locale', id: 1, extra: 'Eva¬Clan', font: 3 }, locale))).toBe('[Eva] ha ingresado al clan Clan.');
    expect(plainText(formatLine({ kind: 'faction', message: ' Ana> hola', font: 20, label: 'MENSAJE_ARMADA' }, locale))).toBe('[Armada Real] Ana> hola');
    expect(formatLine({ kind: 'guild', status: 1, message: 'Ana> hola' }, locale)).toEqual([{ text: 'Ana> hola', r: 228, g: 199, b: 27, bold: false, italic: false }]);
    expect(formatLine({ kind: 'guild', status: 3, message: 'Ana> hola~1~2~3~1~0' }, locale)).toEqual([{ text: 'Ana> hola', r: 60, g: 163, b: 255, bold: true, italic: false }]);
  });
  it('writes "[Name] " in bold in the name colour, then the text in the message colour, and hides empty lines', () => {
    const [name, text] = formatLine({ kind: 'user', name: 'Ariel <Clan>', text: ' hola ', color: [157, 226, 20], status: 1, level: 0 }, locale);
    expect(name).toEqual({ text: '[Ariel] ', r: 6, g: 128, b: 255, bold: true, italic: false });
    expect(text).toMatchObject({ text: 'hola', r: 157, g: 226, b: 20, bold: false });
    expect(formatLine({ kind: 'user', name: 'Ariel', text: '   ', color: [1, 2, 3], status: 1, level: 0 }, locale)).toEqual([]);
  });
});

describe('speaker names', () => {
  it('strips the alias and the clan like HandleCharacterCreate', () => {
    expect(characterName('TChat {}')).toBe('TChat');
    expect(characterName('Ana <Los Fieles> {Anita}')).toBe('Ana <Los Fieles>');
    expect(characterName('Ana <Los Fieles>')).toBe('Ana');
    expect(characterName('Ana')).toBe('Ana');
  });
});

describe('chat packets in the UI state', () => {
  it('routes console, locale, faction, guild and whisper packets into history', () => {
    const ui = new ClassicState(); ui.chat.locale = locale;
    ui.receive({ id: S.ConsoleMsg, message: 'Hola', font: 3, channel: 0 });
    ui.receive({ id: S.LocaleMsg, messageId: 1, message: 'Eva¬Clan', font: 3 });
    ui.receive({ id: S.ConsoleFactionMessage, message: ' Ana> hi', font: 20, label: 'MENSAJE_LEGION' });
    ui.receive({ id: S.GuildChat, status: 1, message: 'Ana> hi' });
    ui.receive({ id: S.ConsoleCharText, message: 'psst', color: toVbColor(157, 226, 20), sourceName: 'Bob', sourceStatus: 0, privileges: 0 });
    expect(ui.messages.map(m => m.text)).toEqual(['Hola', '[Eva] ha ingresado al clan Clan.', '[Legión Oscura] Ana> hi', 'Ana> hi', '[Bob] psst']);
    expect(ui.messages[0]!.font).toBe(3);
  });
  it('shows a bubble with the wire colour, copies it to the console and ignores unknown characters', () => {
    let now = 1000;
    const ui = new ClassicState(); ui.chat.locale = locale; ui.chat.clock = () => now;
    ui.chat.characters = i => (i === 1 ? character() : i === 2 ? character({ charIndex: 2, name: 'Guardia', npc: 1 }) : undefined);
    ui.receive({ id: S.ChatOverHead, chat: 'Hola ñ', charIndex: 1, color: toVbColor(255, 128, 0), isSpell: false, x: 5, y: 6, minTime: 0, maxTime: 0 });
    ui.receive({ id: S.ChatOverHead, chat: 'Bienvenido', charIndex: 2, color: toVbColor(255, 255, 255), isSpell: false, x: 5, y: 6, minTime: 0, maxTime: 0 });
    ui.receive({ id: S.ChatOverHead, chat: 'fantasma', charIndex: 9, color: 0, isSpell: false, x: 0, y: 0, minTime: 0, maxTime: 0 });
    expect([...ui.chat.dialogs.keys()]).toEqual([1, 2]);
    expect(ui.chat.dialogs.get(1)).toMatchObject({ text: 'Hola ñ', color: [255, 128, 0], start: 1000, life: dialogLife('Hola ñ', false, 0) });
    expect(ui.messages.map(m => m.text)).toEqual(['[Ariel] Hola ñ']); // NPC and unknown speakers are not copied
    expect(ui.chat.visibleDialogs().map(v => v.opacity)).toEqual([1, 1]);
    now += 3000 + 60 * 'Hola ñ'.length + DIALOG_FADE_MS / 2;
    expect(ui.chat.visibleDialogs().find(v => v.charIndex === 1)!.opacity).toBeCloseTo(.5, 1);
    now += DIALOG_FADE_MS;
    expect(ui.chat.visibleDialogs()).toEqual([]); expect(ui.chat.dialogs.size).toBe(0);
  });
  it('expands LOCMSG, NPCDESC, PMAG, QUESTFIN and NOCONSOLA overhead prefixes without copying them to the console', () => {
    const ui = new ClassicState(); ui.chat.locale = locale; ui.chat.characters = () => character();
    const say = (chat: string) => ui.receive({ id: S.ChatOverHead, chat, charIndex: 1, color: 0, isSpell: true, x: 0, y: 0, minTime: 0, maxTime: 0 });
    say('LOCMSG*2*'); expect(ui.chat.dialogs.get(1)!.text).toBe('Hola');
    say('NPCDESC*7'); expect(ui.chat.dialogs.get(1)!.text).toBe('Hola, hijo mio.');
    say('PMAG*5'); expect(ui.chat.dialogs.get(1)!.text).toBe('OHL VOR');
    say('QUESTFIN*2'); expect(ui.chat.dialogs.get(1)!.text).toBe('Gracias por tu ayuda.');
    say('NOCONSOLA*< a la clan >'); expect(ui.chat.dialogs.get(1)!.text).toBe('< a la clan >');
    expect(ui.messages).toHaveLength(0);
    ui.receive({ id: S.LocaleChatOverHead, chatId: 1, params: 'Eva¬Clan', charIndex: 1, color: 0, isSpell: false, x: 0, y: 0, minTime: 0, maxTime: 0 });
    expect(ui.chat.dialogs.get(1)!.text).toBe('[Eva] ha ingresado al clan Clan.');
  });
  it('honours RequiredMinDisplayTime for plain speech but never for spells, and uses MaxDisplayTime for spells', () => {
    let now = 0;
    const ui = new ClassicState(); ui.chat.clock = () => now; ui.chat.characters = () => character();
    const say = (chat: string, isSpell: boolean, minTime = 0, maxTime = 0) =>
      ui.receive({ id: S.ChatOverHead, chat, charIndex: 1, color: 0, isSpell, x: 0, y: 0, minTime, maxTime });
    say('uno', false, 2000); now = 500; say('dos', false);
    expect(ui.chat.dialogs.get(1)!.text).toBe('uno');
    say('conjuro', true, 0, 1200); expect(ui.chat.dialogs.get(1)).toMatchObject({ text: 'conjuro', life: 1200 });
    say('otro', true); expect(ui.chat.dialogs.get(1)!.life).toBe(3500);
    now = 5000; say('tres', false); expect(ui.chat.dialogs.get(1)!.text).toBe('tres');
  });
  it('removes one bubble on RemoveCharDialog and all of them on RemoveDialogs', () => {
    const ui = new ClassicState(); ui.chat.characters = () => character();
    for (const charIndex of [1, 2]) ui.receive({ id: S.ChatOverHead, chat: 'x', charIndex, color: 0, isSpell: false, x: 0, y: 0, minTime: 0, maxTime: 0 });
    ui.receive({ id: S.RemoveCharDialog, charIndex: 1 }); expect([...ui.chat.dialogs.keys()]).toEqual([2]);
    ui.receive({ id: S.RemoveDialogs }); expect(ui.chat.dialogs.size).toBe(0);
  });
  it('bounds history and never interprets chat text as HTML', () => {
    const ui = new ClassicState();
    for (let i = 0; i < 205; i++) ui.receive({ id: S.ConsoleMsg, message: String(i), font: 0 });
    expect(ui.messages).toHaveLength(200); expect(ui.messages[0]!.text).toBe('5');
  });
});

describe('chat input rules (HandleChatMsg and ParseUserCommand)', () => {
  const run = (text: string, context = {}) => { const input = new ChatInput(); return { input, out: input.submit(text, context) }; };
  it('says plain text, yells after "-", whispers after "\\name"', () => {
    expect(run('hola').out).toEqual({ talk: 'hola', notes: [] });
    expect(run('-cuidado').out.packet).toEqual({ id: C.Yell, message: 'cuidado' });
    expect(run('\\Bob hola que tal').out.packet).toEqual({ id: C.Whisper, name: 'Bob', message: 'hola que tal' });
    expect(run('\\Bob').out).toEqual({ notes: [] });
  });
  it('maps the channel commands and counts guild messages separately', () => {
    expect(run('/GRUPO vamos').out.packet).toEqual({ id: C.GroupMessage, message: 'vamos' });
    expect(run('/cluster vamos').out.packet).toEqual({ id: C.GroupMessage, message: 'vamos' });
    const input = new ChatInput();
    expect(input.submit('/CMSG uno').packet).toEqual({ id: C.GuildMessage, message: 'uno', counter: 1 });
    expect(input.submit('/cmsg dos').packet).toEqual({ id: C.GuildMessage, message: 'dos', counter: 2 });
    expect(run('/BMSG hola').out.packet).toEqual({ id: C.CouncilMessage, message: 'hola' });
    expect(run('/FMSG hola').out.packet).toEqual({ id: C.FactionMessage, message: 'hola' });
    expect(run('/ONLINECLAN').out.packet).toEqual({ id: C.GuildOnline });
    expect(run('/GLOBAL hola~x', { level: 5 }).out.packet).toEqual({ id: C.GlobalMessage, message: 'holax' });
  });
  it('explains local failures with the original messages', () => {
    expect(run('/GRUPO').out).toEqual({ notes: [{ text: 'Escriba un mensaje.', font: 0 }] });
    expect(run('/BMSG   ').out.notes[0]!.text).toBe('Escriba un mensaje.');
    expect(run('/GLOBAL hola', { level: 4 }).out).toEqual({ notes: [{ text: '¡¡Debes ser nivel 5 o superior para usar el global!!!', font: 25 }] });
    expect(run('/GLOBAL hola', { dead: true }).out.notes[0]!.text).toContain('No puedes comunicarte');
    expect(run('-grito', { dead: true }).out).toEqual({ notes: [{ text: '¡¡Estás muerto!!', font: 3 }] });
    expect(run('/SEG').out.notes[0]).toMatchObject({ font: 3 });
  });
  it('remembers the channel and prefills the next box like CompletarEnvioMensajes', () => {
    const input = new ChatInput();
    expect(input.prefill()).toBe('');
    input.submit('-grito'); expect(input.sendingType).toBe(SendingType.Yell); expect(input.prefill()).toBe('-');
    input.submit('\\Bob hola'); expect(input.prefill()).toBe('\\Bob ');
    input.submit('/GRUPO x'); expect(input.prefill()).toBe('/GRUPO ');
    input.submit('/CMSG x'); expect(input.prefill()).toBe('');
    input.submit('hola'); expect(input.prefill()).toBe('');
    input.whisperTo('Ana Maria'); expect(input.prefill()).toBe('\\Ana+Maria ');
    input.submit(''); expect(input.sendingType).toBe(SendingType.Talk);
  });
  it('sends guild box text as /CMSG without changing the remembered channel', () => {
    const input = new ChatInput(); input.submit('-grito');
    expect(input.guildMessage('hola').packet).toEqual({ id: C.GuildMessage, message: 'hola', counter: 1 });
    expect(input.guildMessage('').packet).toBeUndefined();
    expect(input.prefill()).toBe('-');
  });
  it('keeps only characters 32..250 and at most 160 of them', () => {
    expect(filterChatText('a\tb\u0007c ñ ÿ 🙂 ú')).toBe('abc ñ   ú');
    expect(filterChatText('x'.repeat(200))).toHaveLength(160);
  });
});

describe('speech bubble placement (engine.bas dialog position)', () => {
  it('centres 14 px into the tile, 34 px above the head offset, and rises while new', () => {
    // 736x608 viewport, camera on tile 50,50; the player's own tile starts at 368-16, 304-16.
    expect(bubblePlacement(736, 608, { x: 50, y: 50 }, { x: 50, y: 50 }, -2, 1000)).toEqual({ left: 366, top: 252 });
    expect(bubblePlacement(736, 608, { x: 50, y: 50 }, { x: 52, y: 49 }, -2, 1000)).toEqual({ left: 430, top: 220 });
    expect(bubblePlacement(736, 608, { x: 50, y: 50 }, { x: 50, y: 50 }, -2, 0).top).toBe(252 + 17);
  });
});

describe('chat in a session', () => {
  const login = (sent: Uint8Array[] = [], now = () => 0) => {
    const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), now);
    for (const packet of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, npc: 0 }, f.UserCharIndexInServer, f.Logged] as ServerPacket[]) session.receive(encodeServerFrame(packet));
    return session;
  };
  it('puts a bubble on the self character and uses the session clock', () => {
    let now = 10;
    const session = login([], () => now);
    session.receive(encodeServerFrame({ id: S.ChatOverHead, chat: 'Hola', charIndex: f.UserCharIndexInServer.charIndex, color: 0xffffff, isSpell: false, x: 50, y: 50, minTime: 0, maxTime: 0 }));
    expect(session.ui.chat.dialogs.get(f.UserCharIndexInServer.charIndex)).toMatchObject({ text: 'Hola', start: 10, color: [255, 255, 255] });
    expect(session.ui.messages.at(-1)!.text).toBe('[Añ] Hola');
  });
  it('sends non-Say chat packets only once playing', () => {
    const sent: Uint8Array[] = [];
    const early = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes));
    expect(early.sendChat({ id: C.Yell, message: 'x' })).toBe(false);
    const session = login(sent);
    expect(session.sendChat({ id: C.Whisper, name: 'Bob', message: 'hola' })).toBe(true);
    const decoder = new FrameDecoder();
    const decoded = sent.flatMap(bytes => decoder.push(bytes)).map(decodeClientPacket).filter(p => p.id === C.Whisper);
    expect(decoded).toEqual([{ id: C.Whisper, name: 'Bob', message: 'hola' }]);
  });
});

describe('recorded VB6 chat frames drive the UI state', () => {
  const frames = (name: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/chat/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n')
    .map(l => JSON.parse(l) as { dir: string; hex: string }).filter(l => l.dir === 's2c').map(l => decodeServerPacket(Uint8Array.from(Buffer.from(l.hex, 'hex'))));
  it('say: the real ChatOverHead becomes a white bubble and a "[Name] text" console line', () => {
    const ui = new ClassicState(); ui.chat.locale = locale;
    const login = frames('login').filter(p => !('unknown' in p)) as ServerPacket[];
    const index = (login.find(p => p.id === S.UserCharIndexInServer) as { charIndex: number }).charIndex;
    const self = login.find(p => p.id === S.CharacterCreate && (p as CharacterCreate).charIndex === index) as CharacterCreate;
    ui.chat.characters = i => (i === self.charIndex ? { ...self, npc: 0 } : undefined);
    for (const packet of frames('say')) if (!('unknown' in packet)) ui.receive(packet);
    expect(ui.chat.dialogs.get(self.charIndex)).toMatchObject({ text: 'segundo mensaje', color: [255, 255, 255] });
    expect(ui.messages.map(m => m.text)).toEqual([`[${characterName(self.name)}] Hola mundo, ñandú`, `[${characterName(self.name)}] segundo mensaje`]);
  });
  it('whisper and channel replies decode into console lines', () => {
    const ui = new ClassicState(); ui.chat.locale = locale;
    for (const name of ['whisper', 'channels']) for (const packet of frames(name)) if (!('unknown' in packet)) ui.receive(packet);
    expect(ui.messages.some(m => m.text === '[TChat] psst, secreto')).toBe(true);
    expect(ui.messages.every(m => m.line)).toBe(true);
  });
});
