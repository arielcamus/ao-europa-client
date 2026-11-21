import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FrameDecoder, NpcsServerPacketId as NS, QuestClientPacketId as QC, QuestServerPacketId as QS, QuestState, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ObjQuest, OfferedQuest, QuestDetails, ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { QuestCatalog, beautifyBigNumber, detailsView, offerColor, offerView } from '../src/quests.js';

const SELF = 0x1234, NPC = 77;
function harness() {
  let now = 1000;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, { ...f.Intervals, hit: 1400, leftClick: 100 }, f.ChangeMap,
    { ...f.CharacterCreate, speeding: 1, heading: 2, body: 107, head: 1 }, f.UserCharIndexInServer, f.Logged,
    { ...f.CharacterCreate, charIndex: NPC, name: 'Makrom <Quest de Dungeon Newbie>', x: 51, y: 60, npc: 1, npcNumber: 407, body: 300, head: 0, symbol: 0 });
  sent.length = 0;
  const decoded = () => { const d = new FrameDecoder(); return sent.flatMap(bytes => d.push(bytes).map(decodeClientPacket)); };
  return { session, recv, sent, decoded, advance: (ms: number) => { now += ms; } };
}
void SELF;

const catalog = new QuestCatalog();
catalog.load(`[QUEST4]
NOMBRE=Veneno mortal
DESC=Mata 10 serpientes.
REPETIBLE=1
[QUEST2]
NOMBRE=Primeros pasos en la Alquimia
DESC=Lleva esta receta a Caelum.
REPETIBLE=0
[NPC502]
NAME=Serpiente <Hostil>
BODY=4194
HEAD=0
[NPC11]
NAME=Seraphia <Quest de Alquimia>
[OBJ2492]
GRHINDEX=49309
NAME=Fluido de serpiente
[OBJ1188]
GRHINDEX=100
NAME=Receta
[HECHIZO5]
NOMBRE=Dardo Mágico
ICONOINDEX=35684
`);

const details: QuestDetails = {
  questIndex: 4, requiredLevel: 6, limitLevel: 20, requiredClasses: [9, 3], requiredQuest: 2,
  npcs: [{ amount: 10, npcIndex: 502, killed: 4 }, { amount: 5, npcIndex: 502, killed: 5 }],
  objs: [{ amount: 10, objIndex: 2492, have: 2 }], spells: [{ spell: 5, has: 1 }], skillType: 5, skillValue: 30,
  rewardGold: 70, rewardExp: 25_000, rewardObjs: [{ amount: 3, objIndex: 1188 }], rewardSpells: [5], talkTo: 11, deliverMap: 44,
};
const offer: OfferedQuest = {
  questIndex: 4, requiredLevel: 1, requiredQuest: 0, requiredClasses: [], limitLevel: 0, npcs: [{ amount: 10, npcIndex: 502 }], objs: [{ amount: 10, objIndex: 2492 }],
  spells: [], skillType: 0, skillValue: 0, rewardGold: 4, rewardExp: 0, rewardObjs: [{ amount: 10, objIndex: 1188 }], rewardSpells: [], state: QuestState.Available,
};

describe('quest requests (Quests button, quest log, accept, abandon)', () => {
  it('the Quests button sends QuestListRequest; nothing is sent before login', () => {
    const h = harness();
    expect(h.session.requestQuestList()).toBe(true);
    expect(h.decoded()).toEqual([{ id: QC.QuestListRequest }]);
    expect(new Session({ email: 'a', password: 'b' }, () => { throw new Error('nothing may be sent'); }, () => 0).requestQuestList()).toBe(false);
  });
  it('QuestListSend opens the log and asks for the details of the first quest (HandleQuestListSend); an empty list asks for nothing', () => {
    const h = harness();
    h.recv({ id: QS.QuestListSend, quests: [4, 9] });
    expect(h.session.quests).toMatchObject({ list: [4, 9], listOpen: true });
    expect(h.decoded()).toEqual([{ id: QC.QuestDetailsRequest, slot: 1 }]);
    h.sent.length = 0;
    h.recv({ id: QS.QuestListSend, quests: [] });
    expect(h.session.quests).toMatchObject({ list: [], listOpen: true, details: undefined });
    expect(h.decoded()).toEqual([]);
  });
  it('details, accept and abandon use the 1-based slot the player picked; bad slots send nothing', () => {
    const h = harness();
    expect(h.session.requestQuestDetails(2)).toBe(true);
    expect(h.session.acceptQuest(3)).toBe(true);
    expect(h.session.abandonQuest(1)).toBe(true);
    expect(h.session.requestQuestDetails(0)).toBe(false);
    expect(h.session.acceptQuest(256)).toBe(false);
    expect(h.session.abandonQuest(1.5)).toBe(false);
    expect(h.decoded()).toEqual([{ id: QC.QuestDetailsRequest, slot: 2 }, { id: QC.QuestAccept, slot: 3 }, { id: QC.QuestAbandon, slot: 1 }]);
  });
  it('quest packets are not sequence checked: no counter is consumed', () => {
    const h = harness();
    h.session.requestQuestList(); h.session.acceptQuest(1);
    expect(h.session.counters.current('leftClick')).toBe(0);
    expect(h.session.counters.current('walk')).toBe(0);
  });
});

describe('quest state', () => {
  it('details replace each other; NpcQuestListSend opens the offer, an empty offer stays closed; ObjQuestListSend shows one quest', () => {
    const h = harness();
    h.recv({ id: QS.QuestDetails, ...details });
    expect(h.session.quests.details?.questIndex).toBe(4);
    h.recv({ id: QS.NpcQuestListSend, quests: [] });
    expect(h.session.quests.offersOpen).toBe(false);
    h.recv({ id: QS.NpcQuestListSend, quests: [offer, { ...offer, questIndex: 2 }] });
    expect(h.session.quests).toMatchObject({ offersOpen: true });
    expect(h.session.quests.offers).toHaveLength(2);
    const objQuest: ObjQuest = { questIndex: 38, requiredLevel: 13, requiredQuest: 0, npcs: [], objs: [], spells: [], skillType: 0, skillValue: 0, rewardGold: 0, rewardExp: 0, rewardObjs: [], state: 0 };
    h.recv({ id: QS.ObjQuestListSend, ...objQuest });
    expect(h.session.quests.offers).toEqual([objQuest]);
    h.session.quests.closeOffers(); expect(h.session.quests.offersOpen).toBe(false);
    h.recv({ id: QS.QuestListSend, quests: [4] });
    h.session.quests.closeList(); expect(h.session.quests).toMatchObject({ listOpen: false, details: undefined });
  });
  it('the recorded ObjQuestListSend (UseItem on Obj 3305 "Nota de Rescate", QuestId 123) opens the one-quest offer', () => {
    const h = harness();
    const line = readFileSync(new URL('../../../tests/fixtures/vb6/quests/obj-quest-item.jsonl', import.meta.url), 'utf8').trim().split('\n')
      .map(text => JSON.parse(text) as { dir: string; id: number; hex: string }).find(entry => entry.dir === 's2c' && entry.id === QS.ObjQuestListSend)!;
    const body = Uint8Array.from(Buffer.from(line.hex, 'hex'));
    h.session.receive(Uint8Array.from([body.length & 255, body.length >> 8, ...body])); // the raw recorded frame: Int16 length (id + body), then the bytes
    // Quests.DAT [QUEST123]: RequiredLevel 16, five required objects, RewardGLD 1450 and RewardEXP 15750 x ExpMult 4 on this server.
    expect(h.session.quests.offers).toHaveLength(1);
    expect(h.session.quests.offers[0]).toMatchObject({ questIndex: 123, requiredLevel: 16, rewardGold: 1450, rewardExp: 63000 });
    expect(h.session.quests.offers[0]!.objs).toHaveLength(5);
    expect(h.session.quests.offersOpen).toBe(true);
  });
  it('UpdateNPCSimbolo sets the marker over the NPC and CharacterCreate seeds it', () => {
    const h = harness();
    expect(h.session.tracker.chars.get(NPC)?.symbol).toBe(0);
    h.recv({ id: QS.UpdateNPCSimbolo, charIndex: NPC, symbol: 3 });
    expect(h.session.tracker.chars.get(NPC)?.symbol).toBe(3);
    h.recv({ ...f.CharacterCreate, charIndex: 90, npc: 1, symbol: 2 });
    expect(h.session.tracker.chars.get(90)?.symbol).toBe(2);
    h.recv({ id: QS.UpdateNPCSimbolo, charIndex: 4000, symbol: 1 }); // unknown char: ignored, no throw
    h.recv({ id: NS.CharacterRemove, charIndex: NPC, vanish: false, warp: false });
    expect(h.session.tracker.chars.has(NPC)).toBe(false);
  });
});

describe('quest text (FrmQuests / FrmQuestInfo)', () => {
  it('BeautifyBigNumber', () => {
    expect([beautifyBigNumber(500), beautifyBigNumber(10_000), beautifyBigNumber(25_000), beautifyBigNumber(12_340_000), beautifyBigNumber(2_000_000_000)])
      .toEqual(['500', '10000', '25K', '12.34KK', '2KKK']);
  });
  it('quest log: objectives show kills as done/total or OK, requirements and delivery lines, rewards with gold and exp first', () => {
    const view = detailsView(details, catalog);
    expect(view.title).toBe('Veneno mortal');
    expect(view.repeatable).toBe(true);
    expect(view.description).toBe('Mata 10 serpientes.');
    expect(view.objectives).toEqual([
      { name: 'Serpiente', amount: '4/10', id: 502, kind: 'npc' }, { name: 'Serpiente', amount: 'OK', id: 502, kind: 'npc' },
      { name: 'Fluido de serpiente', amount: '2/10', id: 2492, kind: 'obj' }, { name: 'Dardo Mágico', amount: '1/1', id: 5, kind: 'spell' },
    ]);
    expect(view.info.split('\n')).toEqual([
      'Mapa de entrega: 44', 'Entregar a: Seraphia', 'Nivel requerido: 6', 'Nivel máximo: 20', 'Clase: Trabajador', 'Clase: Guerrero',
      'Quest: Primeros pasos en la Alquimia', 'Meditar: 30',
    ]);
    expect(view.rewards.map(r => [r.name, r.amount, r.kind])).toEqual([['Oro', '70', 'obj'], ['Experiencia', '25K', 'obj'], ['Receta', '3', 'obj'], ['Dardo Mágico', '1', 'spell']]);
  });
  it('a level of 1 is not a requirement and a missing limit prints nothing (RequiredLevel > 1, LimitLevel <> 0)', () => {
    const view = detailsView({ ...details, requiredLevel: 1, limitLevel: 0, requiredClasses: [], requiredQuest: 0, skillType: 0, talkTo: 0, deliverMap: 0 }, catalog);
    expect(view.info).toBe('');
  });
  it('offer: description with its Requisitos block, (R) on repeatable quests and the state colours', () => {
    const v = offerView({ ...offer, requiredLevel: 6, requiredClasses: [9], state: QuestState.Unavailable }, catalog);
    expect(v.label).toBe('Veneno mortal (R)');
    expect(v.color).toBe('rgb(255,10,10)');
    expect(v.description).toBe('Mata 10 serpientes.\n\nRequisitos\nNivel requerido: 6\nClase: Trabajador');
    expect(v.objectives.map(o => o.amount)).toEqual(['10', '10']);
    expect(offerView(offer, catalog).description).toBe('Mata 10 serpientes.');
    expect([QuestState.Available, QuestState.InProgress, QuestState.Done, QuestState.Unavailable].map(s => offerColor(s, false)))
      .toEqual(['rgb(255,255,255)', 'rgb(255,175,10)', 'rgb(15,140,50)', 'rgb(255,10,10)']);
    expect(offerColor(QuestState.Done, true)).toBe('rgb(180,180,180)'); // finished but repeatable
  });
  it('a quest the local data does not know has no name or text, never an exception', () => {
    expect(detailsView({ ...details, questIndex: 407 }, catalog)).toMatchObject({ title: 'Misión 407', description: '' });
  });
});
