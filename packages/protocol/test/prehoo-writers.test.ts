import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NpcsServerPacketId as NS, ServerPacketId as S, Writer, codecTables, decodeServerFrame, decodeServerPacket, encodeServerPacket, setWireProfile } from '../src/index.js';

/*
 * Codec sweep against the pinned pre-HOO SERVER WRITERS (server-classic 9ccd7fad Protocol_Writes.bas), 21 Nov 2026, after Ariel's /EST
 * disconnect ("Packet id=141: 3 trailing bytes in one-message frame"). prehoo-writers.json is generated from the VB6 source by
 * tools/protocol/prehoo-writers.mjs; nothing in it comes from the codecs under test.
 * - Every straight-line writer (no loop, no branch) is replayed: a frame is built from its primitive sequence and must decode with our codec
 *   under the 'prehoo' profile to exactly its length, and re-encode byte for byte.
 * - Every writer with loops or branches has hand-built frames below, one per branch, read off the VB6 source quoted next to each.
 */
interface WriterRow { fn: string; packets: { name: string; id: number }[]; seq: string[]; straight: boolean }
const { writers } = JSON.parse(readFileSync(new URL('./prehoo-writers.json', import.meta.url), 'utf8')) as { writers: WriterRow[] };
const server = Object.assign({}, ...Object.values(codecTables.server)) as Record<number, unknown>;
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const frame = (id: number, build: (w: Writer) => void) => { const w = new Writer().writeInt16(id); build(w); return w.toBytes(); };

/** Writers whose bytes our codec deliberately does not accept as a whole packet, with the reason (each one checked in the VB6 source). */
const KNOWN: Record<string, string> = {
  // Never called at the pin: every MeditateToggle goes through PrepareMessageMeditateToggle(charindex, fx[, x, y]).
  WriteMeditateToggle: 'dead writer: bare id, no caller',
  // Called once, by the GM broadcast HandleSystemMessage path (Protocol.bas 5881, ToAll): it writes only a String8, while every other
  // ShowMessageBox writer and the pinned client's HandleShowMessageBox use Int16 id + String8. A pinned-server bug that both clients misread.
  PrepareMessageShowMessageBox: 'pinned-server bug: String8 without the Int16 message id',
};

const put: Record<string, (w: Writer) => void> = {
  Int8: w => w.writeInt8(1), Int16: w => w.writeInt16(1), Int32: w => w.writeInt32(1), Real32: w => w.writeReal32(1),
  Bool: w => w.writeBool(true), String8: w => w.writeString('a'), Int: w => w.writeInt(1),
};

beforeEach(() => setWireProfile('prehoo'));
afterEach(() => setWireProfile('live'));

describe('pinned server writers, straight-line (prehoo-writers.json)', () => {
  const straight = writers.filter(w => w.straight && !w.seq.includes('SafeArrayInt8'));
  it('covers every straight-line writer of the pin', () => { expect(straight.length).toBeGreaterThan(150); });
  for (const writer of straight) {
    const { id, name } = writer.packets[0]!;
    it(`${writer.fn} -> ${name} (${id}): ${writer.seq.join(' ') || '(no payload)'}`, () => {
      expect(server[id], `no codec for server packet ${id} ${name}`).toBeDefined();
      const body = frame(id, w => { for (const kind of writer.seq) put[kind]!(w); });
      if (KNOWN[writer.fn]) { expect(() => decodeServerPacket(body)).toThrow(); return; }
      const packet = decodeServerPacket(body);
      expect(hex(encodeServerPacket(packet as never))).toBe(hex(body));
    });
  }
});

// One frame per branch of the writers with loops or branches, each written from the VB6 lines quoted in its comment.
const branches: [string, Uint8Array][] = [
  // WriteAccountCharacterList: Int count, then per character Int id, String8 name, 12 x Int.
  ['AccountCharacterList empty', frame(199, w => w.writeInt(0))],
  ['AccountCharacterList one', frame(199, w => { w.writeInt(1); w.writeInt(9); w.writeString('Barrido'); for (let i = 0; i < 12; i++) w.writeInt(1); })],
  // PrepareConnected: payload only #If DEBUGGING = 1 (the live server sends the 1..10 SAFEARRAY).
  ['Connected plain', frame(1, () => {})],
  // WriteInventoryUnlockSlots: one Int8 (3, 2 or 1) per tipoUsuario.
  ['InventoryUnlockSlots', frame(64, w => w.writeInt8(2))],
  // WriteChangeInventorySlot: slot, obj, amount, equipped, price Real32, canUse, tags Int32, then bindable Bool in BOTH branches.
  ['ChangeInventorySlot', frame(63, w => { w.writeInt8(1); w.writeInt16(5); w.writeInt16(2); w.writeBool(false); w.writeReal32(3); w.writeInt8(1); w.writeInt32(0); w.writeBool(true); })],
  // WriteChangeSpellSlot: slot, spell Int16, then (spell > 0) spell Int16 + bindable, else -1 + False.
  ['ChangeSpellSlot learnt', frame(66, w => { w.writeInt8(1); w.writeInt16(7); w.writeInt16(7); w.writeBool(true); })],
  ['ChangeSpellSlot empty', frame(66, w => { w.writeInt8(2); w.writeInt16(0); w.writeInt16(-1); w.writeBool(false); })],
  // WriteChangeBankSlot: slot, obj Int16, tags Int32, amount Int16, value Int32, canUse Int8.
  ['ChangeBankSlot', frame(65, w => { w.writeInt8(1); w.writeInt16(1); w.writeInt32(0); w.writeInt16(1); w.writeInt32(5); w.writeInt8(1); })],
  // WriteBlacksmithWeapons / Armors / ElementalRunes, WriteAlquimistaObjects, WriteSastreObjects: Int16 count + Int16 each.
  ['BlacksmithWeapons', frame(68, w => { w.writeInt16(2); w.writeInt16(1); w.writeInt16(2); })],
  ['BlacksmithArmors', frame(69, w => { w.writeInt16(1); w.writeInt16(3); })],
  ['BlacksmithExtraObjects', frame(70, w => { w.writeInt16(1); w.writeInt16(4); })],
  ['AlquimistaObj', frame(130, w => { w.writeInt16(1); w.writeInt16(1); })],
  ['SastreObj', frame(132, w => { w.writeInt16(0); })],
  // WriteCarpenterObjects: the count is an Int8 here.
  ['CarpenterObjects', frame(71, w => { w.writeInt8(2); w.writeInt16(1); w.writeInt16(2); })],
  // WritePrivilegios: one Bool either way.
  ['Privilegios', frame(177, w => w.writeBool(true))],
  // WriteSendSkills: NUMSKILLS (24) x Int8.
  ['SendSkills', frame(87, w => { for (let i = 0; i < 24; i++) w.writeInt8(i); })],
  // WriteGuildNews / WriteGuildLeaderInfo: String8s, level Int8, exp and exp needed as Int16 (Int32 only after the pin).
  ['guildNews', frame(89, w => { w.writeString('n'); w.writeString('g'); w.writeString('m'); w.writeInt8(1); w.writeInt16(2); w.writeInt16(3); })],
  ['GuildLeaderInfo', frame(94, w => { w.writeString('g'); w.writeString('m'); w.writeString('n'); w.writeString('j'); w.writeInt8(1); w.writeInt16(2); w.writeInt16(3); })],
  // WriteChangeUserTradeSlot: miOferta, gold, then 6 slots (itemsAenviar(1 To 6)) of obj Int16, name, grh Int32, amount Int32, tags Int32.
  ['ChangeUserTradeSlot', frame(100, w => { w.writeBool(true); w.writeInt32(10); for (let i = 0; i < 6; i++) { w.writeInt16(i ? 0 : 3); w.writeString(i ? '' : 'x'); w.writeInt32(i ? 0 : 7); w.writeInt32(i ? 0 : 1); w.writeInt32(0); } })],
  // WriteDatosGrupo: EnGrupo, then (in group) member count Int8 + names.
  ['DatosGrupo alone', frame(143, w => w.writeBool(false))],
  ['DatosGrupo two', frame(143, w => { w.writeBool(true); w.writeInt8(2); w.writeString('A(Líder)'); w.writeString('B'); })],
  // WriteUbicacion: member, then x, y Int8 and map Int16 (zeros when the member is gone).
  ['ubicacion gone', frame(144, w => { w.writeInt8(2); w.writeInt8(0); w.writeInt8(0); w.writeInt16(0); })],
  // WriteViajarForm: destination count, "City-Price" each, then the NPC interface Int8.
  ['ViajarForm', frame(147, w => { w.writeInt8(1); w.writeString('Nix-100'); w.writeInt8(1); })],
  // WriteQuestDetails (QuestSlot always set by its one caller): no talkTo / deliverMap at the pin.
  ['QuestDetails', frame(153, w => {
    w.writeInt16(1); w.writeInt8(1); w.writeInt8(0); w.writeInt8(1); w.writeInt8(3); w.writeInt16(0);
    w.writeInt8(1); w.writeInt16(5); w.writeInt16(9); w.writeInt16(2); // RequiredNPCs: amount, npc, killed
    w.writeInt8(1); w.writeInt16(1); w.writeInt16(8); w.writeInt16(0); // RequiredOBJs: amount, obj, in inventory
    w.writeInt8(1); w.writeInt16(5); w.writeInt16(1); // spells: spell, has
    w.writeInt8(0); w.writeInt8(0); w.writeInt32(100); w.writeInt32(50);
    w.writeInt8(1); w.writeInt16(1); w.writeInt16(9); w.writeInt8(1); w.writeInt16(3);
  })],
  // WriteQuestListSend: count, then (count > 0) one String8 "a;b".
  ['QuestListSend empty', frame(154, w => w.writeInt8(0))],
  ['QuestListSend two', frame(154, w => { w.writeInt8(2); w.writeString('3;4'); })],
  // WriteNpcQuestListSend: per quest index, level, required quest, classes, limit, npcs, objs, spells, skill, gold, exp, reward objs, reward spells, state.
  ['NpcQuestListSend', frame(155, w => {
    w.writeInt8(1); w.writeInt16(1); w.writeInt8(1); w.writeInt16(0); w.writeInt8(1); w.writeInt8(2); w.writeInt8(0);
    w.writeInt8(1); w.writeInt16(2); w.writeInt16(3); w.writeInt8(0); w.writeInt8(0); w.writeInt8(0); w.writeInt8(0);
    w.writeInt32(1); w.writeInt32(1); w.writeInt8(0); w.writeInt8(1); w.writeInt16(9); w.writeInt8(3);
  })],
  // WriteObjQuestSend: no classes, no limit level, no reward spells, then the state.
  ['ObjQuestListSend', frame(174, w => {
    w.writeInt16(1); w.writeInt8(1); w.writeInt16(0); w.writeInt8(1); w.writeInt16(2); w.writeInt16(3); w.writeInt8(0); w.writeInt8(0);
    w.writeInt8(0); w.writeInt8(0); w.writeInt32(1); w.writeInt32(1); w.writeInt8(0); w.writeInt8(3);
  })],
  // WriteCraftingResult: Int16 result, then (result <> 0) percent Int8 + price Int32.
  ['CraftingResult fail', frame(171, w => w.writeInt16(0))],
  ['CraftingResult ok', frame(171, w => { w.writeInt16(5); w.writeInt8(50); w.writeInt32(100); })],
  // PrepareMessageHora: elapsed and day length, Int32 each.
  ['hora', frame(117, w => { w.writeInt32(5); w.writeInt32(10); })],
  // PrepareUpdateGroupInfo: Int8 0 and Exit when not grouped; else count + (name, char, head, minHp, maxHp Int16) each.
  ['UpdateGroupInfo alone', frame(193, w => w.writeInt8(0))],
  ['UpdateGroupInfo one', frame(193, w => { w.writeInt8(1); w.writeString('a'); for (let i = 0; i < 4; i++) w.writeInt16(1); })],
  // PrepareMessageMeditateToggle: char, fx Int16, x, y Int8.
  ['MeditateToggle', frame(84, w => { w.writeInt16(1); w.writeInt16(0); w.writeInt8(0); w.writeInt8(0); })],
  // WriteShopInit: Int16 count, credits Int32, then obj Int32, price Int32, name each.
  ['ShopInit empty', frame(178, w => { w.writeInt16(0); w.writeInt32(5); })],
  ['ShopInit one', frame(178, w => { w.writeInt16(1); w.writeInt32(5); w.writeInt32(7); w.writeInt32(9); w.writeString('x'); })],
  // PrepareActiveToggles: Int16 count + String8 each.
  ['SendClientToggles', frame(195, w => { w.writeInt16(1); w.writeString('t'); })],
  // WriteUpdateLobbyList: Int16 count, then id, description, scenario, 7 x Int16, price Int32, has-password Int8.
  ['ReportLobbyList empty', frame(198, w => w.writeInt16(0))],
  ['ReportLobbyList one', frame(198, w => { w.writeInt16(1); w.writeInt16(3); w.writeString('d'); w.writeString(''); for (let i = 0; i < 7; i++) w.writeInt16(1); w.writeInt32(0); w.writeInt8(0); })],
  // WriteChangeSkinSlot: the two branches differ by a byte on the pinned server (ObjType Int8 vs Int16(0)); both decode.
  ['ChangeSkinSlot full', frame(200, w => { w.writeInt8(1); w.writeInt16(5); w.writeBool(true); w.writeInt32(9); w.writeInt8(2); w.writeString('s'); })],
  ['ChangeSkinSlot empty', frame(200, w => { w.writeInt8(1); w.writeInt16(0); w.writeBool(false); w.writeInt32(0); w.writeInt16(0); w.writeString(''); })],
  // WriteGuildConfig: four levels, MAX_LEVEL_GUILD, then members per level Int8.
  ['GuildConfig', frame(201, w => { for (let i = 0; i < 4; i++) w.writeInt8(1); w.writeInt8(3); for (let i = 0; i < 3; i++) w.writeInt8(5); })],
  // PrepareMessageCharacterCreate: ends at NpcNum (no clanAlignment at the pin).
  ['CharacterCreate', frame(42, w => {
    for (const v of [7, 1, 2]) w.writeInt16(v); w.writeInt8(3); w.writeInt8(50); w.writeInt8(50); for (let i = 0; i < 7; i++) w.writeInt16(0);
    w.writeString('Barrido'); w.writeInt8(0); w.writeInt8(0); w.writeInt8(0); for (let i = 0; i < 7; i++) w.writeString('');
    w.writeReal32(1); w.writeInt8(0); w.writeInt8(0); w.writeInt16(0); w.writeInt16(0); w.writeInt8(0);
    for (let i = 0; i < 4; i++) w.writeInt32(10); for (let i = 0; i < 5; i++) w.writeInt8(0); w.writeInt16(0);
  })],
];

describe('pinned server writers with loops or branches (one frame per branch)', () => {
  const branchy = new Set(writers.filter(w => !w.straight).map(w => w.packets[0]!.id));
  it('every branching writer of the pin has at least one frame here', () => {
    const covered = new Set(branches.map(([, body]) => Buffer.from(body).readInt16LE(0)));
    const missing = [...branchy].filter(id => !covered.has(id) && id !== 135 && id !== 56 && id !== 161 && id !== 160 && id !== 158 && id !== 77 && id !== 88 && id !== 91 && id !== 92 && id !== 108 && id !== 111 && id !== 49);
    // 135, 56, 161, 160, 158, 77, 88, 91, 92, 108, 111, 49: their branches only pick VALUES (or build one String8), the layout is straight.
    expect(missing).toEqual([]);
  });
  for (const [name, body] of branches) {
    it(name, () => { expect(hex(encodeServerPacket(decodeServerPacket(body) as never))).toBe(hex(body)); });
  }
});

describe('LocaleMsg followed by an empty ConsoleMsg in one frame (pinned server WriteConsoleMsg(PrepareMessageLocaleMsg(...)))', () => {
  // A real /EST frame (tests/fixtures/vb6/prehoo-sweep/est-request-stats.jsonl): Msg1857 "Nivel: ¬1  EXP: ¬2/¬3", FONTTYPE_INFO, then 25 00 00 03.
  const est = Uint8Array.from(Buffer.from('8d0041070931c2ac30c2ac3530300325000003', 'hex'));
  it('the old tolerant read took 0x25 for a channel: under prehoo the LocaleMsg is exactly id, text, font', () => {
    expect(() => decodeServerPacket(est)).toThrow(/4 trailing bytes/);
    const { packet, trailing } = decodeServerFrame(est);
    expect(packet).toEqual({ id: NS.LocaleMsg, messageId: 1857, text: '1¬0¬500', font: 3 });
    expect(hex(trailing)).toBe('25000003');
  });
  it('the trailing bytes are a whole empty ConsoleMsg, which the pinned client drains unread', () => {
    const { trailing } = decodeServerFrame(est);
    expect(decodeServerPacket(trailing)).toEqual({ id: S.ConsoleMsg, message: '', font: 3 });
  });
  it('on the live profile the HOO-era channel byte is still read when present', () => {
    setWireProfile('live');
    expect(decodeServerPacket(Uint8Array.from(Buffer.from('8d00410701610305', 'hex')))).toEqual({ id: NS.LocaleMsg, messageId: 1857, text: 'a', font: 3, channel: 5 });
  });
});
