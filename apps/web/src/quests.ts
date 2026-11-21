/*
 * Quest state and text, adapted 2026-11-20 from client Protocol.bas (HandleQuestListSend, HandleQuestDetails,
 * HandleNpcQuestListSend, HandleObjQuestListSend), FrmQuest.frm, frmQuestInfo.frm and Recursos.bas (QUEST sections of
 * init/sp_localindex.dat). Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE and NOTICE.
 * No DOM here: quest-window.ts draws it.
 */
import { QuestServerPacketId as Q, QuestState as State } from '@ao/protocol';
import type { ObjQuest, OfferedQuest, QuestDetails, ServerPacket } from '@ao/protocol';
import { parseIni } from './assets.js';
import type { Ini } from './assets.js';
import { CLASS_NAMES, SKILL_NAMES } from './game-text.js';

/** Quest, NPC, object and spell data the quest forms read from init/sp_localindex.dat (QuestList, NpcData, ObjData, HechizoData). */
export class QuestCatalog {
  private data: Ini = new Map();
  ready = false;
  load(index: string) { this.data = parseIni(index); this.ready = this.data.size > 0; }
  private get(section: string, key: string) { return this.data.get(section)?.get(key) ?? ''; }
  private number(section: string, key: string) { return Number(this.get(section, key)) || 0; }
  /** The quest's name; init/sp_localindex.dat of this snapshot has only quests 1..255, so a newer quest is shown as "Misión N". */
  questName(id: number) { return this.get(`quest${id}`, 'nombre') || `Misión ${id}`; }
  questDescription(id: number) { return this.get(`quest${id}`, 'desc'); }
  questRepeatable(id: number) { return this.number(`quest${id}`, 'repetible') === 1; }
  npcName(id: number) { return this.get(`npc${id}`, 'name').split(' <')[0]!; }
  npcLook(id: number) { return { body: this.number(`npc${id}`, 'body'), head: this.number(`npc${id}`, 'head') }; }
  objName(id: number) { return this.get(`obj${id}`, 'name'); }
  objGraphic(id: number) { return this.number(`obj${id}`, 'grhindex'); }
  spellName(id: number) { return this.get(`hechizo${id}`, 'nombre'); }
  spellIcon(id: number) { return this.number(`hechizo${id}`, 'iconoindex'); }
}

/** General.bas BeautifyBigNumber. */
export function beautifyBigNumber(n: number): string {
  const round = (value: number, digits: number) => String(Math.round(value * 10 ** digits) / 10 ** digits);
  if (n > 1_000_000_000) return `${round(n * 1e-9, 3)}KKK`;
  if (n > 10_000_000) return `${round(n * 1e-6, 2)}KK`;
  if (n > 10_000) return `${round(n * 1e-3, 1)}K`;
  return String(n);
}

/** A row of the objective (ListView1) or reward (ListView2) lists; `kind` says which table `id` indexes (SubItems(3) / typeReward). */
export interface QuestRow { name: string; amount: string; id: number; kind: 'npc' | 'obj' | 'spell' }

/** Level, class, previous quest and skill lines (JsonLanguage MENSAJE_QUEST_*). */
export function requirementLines(
  q: { requiredLevel: number; limitLevel: number; requiredClasses: number[]; requiredQuest: number; skillType: number; skillValue: number },
  catalog: QuestCatalog,
): string[] {
  const lines: string[] = [];
  if (q.requiredLevel > 1) lines.push(`Nivel requerido: ${q.requiredLevel}`);
  if (q.limitLevel !== 0) lines.push(`Nivel máximo: ${q.limitLevel}`);
  if (q.requiredClasses.length > 0 && q.requiredClasses.length <= 12) for (const id of q.requiredClasses) lines.push(`Clase: ${CLASS_NAMES[id] ?? ''}`);
  if (q.requiredQuest !== 0) lines.push(`Quest: ${catalog.questName(q.requiredQuest)}`);
  if (q.skillType > 0) lines.push(`${SKILL_NAMES[q.skillType] ?? ''}: ${q.skillValue}`);
  return lines;
}

export interface DetailsView {
  title: string; repeatable: boolean; description: string; info: string;
  objectives: QuestRow[]; rewards: QuestRow[];
}
/** HandleQuestDetails: what FrmQuests shows for the quest in one of the player's slots. */
export function detailsView(d: QuestDetails, catalog: QuestCatalog): DetailsView {
  const objectives: QuestRow[] = [];
  for (const n of d.npcs) objectives.push({ name: catalog.npcName(n.npcIndex), amount: n.amount - n.killed > 0 ? `${n.killed}/${n.amount}` : 'OK', id: n.npcIndex, kind: 'npc' });
  for (const o of d.objs) objectives.push({ name: catalog.objName(o.objIndex), amount: `${o.have}/${o.amount}`, id: o.objIndex, kind: 'obj' });
  for (const s of d.spells) objectives.push({ name: catalog.spellName(s.spell), amount: `${s.has}/1`, id: s.spell, kind: 'spell' });
  const rewards = rewardRows(d.rewardGold, d.rewardExp, d.rewardObjs, d.rewardSpells, catalog);
  const lines = requirementLines(d, catalog);
  const deliver: string[] = [];
  if (d.deliverMap > 0) deliver.push(`Mapa de entrega: ${d.deliverMap}`);
  if (d.talkTo > 0) deliver.push(`Entregar a: ${catalog.npcName(d.talkTo)}`);
  return {
    title: catalog.questName(d.questIndex), repeatable: catalog.questRepeatable(d.questIndex),
    description: catalog.questDescription(d.questIndex), info: [...deliver, ...lines].join('\n'), objectives, rewards,
  };
}

function rewardRows(gold: number, exp: number, objs: { amount: number; objIndex: number }[], spells: number[], catalog: QuestCatalog): QuestRow[] {
  const rows: QuestRow[] = [];
  // Gold and experience are drawn with objects 12 (coins) and 608.
  if (gold !== 0) rows.push({ name: 'Oro', amount: beautifyBigNumber(gold), id: 12, kind: 'obj' });
  if (exp !== 0) rows.push({ name: 'Experiencia', amount: beautifyBigNumber(exp), id: 608, kind: 'obj' });
  for (const o of objs) rows.push({ name: catalog.objName(o.objIndex), amount: String(o.amount), id: o.objIndex, kind: 'obj' });
  for (const s of spells) rows.push({ name: catalog.spellName(s), amount: '1', id: s, kind: 'spell' });
  return rows;
}

export const STATE_COLORS: Record<number, string> = {
  [State.Available]: 'rgb(255,255,255)', [State.InProgress]: 'rgb(255,175,10)', [State.Done]: 'rgb(15,140,50)', [State.Unavailable]: 'rgb(255,10,10)',
};
/** Colour of an offered quest's row: Finalizada green, Repetible grey when it can be done again (HandleNpcQuestListSend). */
export function offerColor(state: number, repeatable: boolean): string {
  return state === State.Done && repeatable ? 'rgb(180,180,180)' : STATE_COLORS[state] ?? STATE_COLORS[State.Available]!;
}

export interface OfferView { index: number; title: string; label: string; color: string; state: number; repeatable: boolean; description: string; objectives: QuestRow[]; rewards: QuestRow[]; requirements: string }
/** ListViewQuest_ItemClick: the description with its "Requisitos" block, objectives and rewards of an offered quest. */
export function offerView(q: OfferedQuest | ObjQuest, catalog: QuestCatalog): OfferView {
  const repeatable = catalog.questRepeatable(q.questIndex);
  const requiredClasses = 'requiredClasses' in q ? q.requiredClasses : [];
  const limitLevel = 'limitLevel' in q ? q.limitLevel : 0;
  const lines = requirementLines({ ...q, requiredClasses, limitLevel }, catalog);
  const objectives: QuestRow[] = [];
  for (const n of q.npcs) objectives.push({ name: catalog.npcName(n.npcIndex), amount: String(n.amount), id: n.npcIndex, kind: 'npc' });
  for (const o of q.objs) objectives.push({ name: catalog.objName(o.objIndex), amount: String(o.amount), id: o.objIndex, kind: 'obj' });
  for (const s of q.spells) objectives.push({ name: catalog.spellName(s), amount: '1', id: s, kind: 'spell' });
  const rewardSpells = 'rewardSpells' in q ? q.rewardSpells : [];
  let description = catalog.questDescription(q.questIndex);
  if (lines.length) description += `\n\nRequisitos\n${lines.join('\n')}`;
  return {
    index: q.questIndex, title: catalog.questName(q.questIndex), repeatable, state: q.state, color: offerColor(q.state, repeatable),
    label: catalog.questName(q.questIndex) + (repeatable ? ' (R)' : ''), description, objectives,
    rewards: rewardRows(q.rewardGold, q.rewardExp, q.rewardObjs, rewardSpells, catalog), requirements: lines.join('\n'),
  };
}

/** What the server has told the quest forms to show. */
export class QuestsState {
  revision = 0;
  /** FrmQuests: the quest numbers in the player's quest slots, in slot order. */
  list: number[] = [];
  listOpen = false;
  details: QuestDetails | undefined;
  /** FrmQuestInfo: what an NPC (or a quest item) offers. */
  offers: (OfferedQuest | ObjQuest)[] = [];
  offersOpen = false;
  /** Slot the details request (WriteQuestDetailsRequest) was last sent for; 0 = none. */
  requestedSlot = 0;

  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case Q.QuestListSend:
        this.list = packet.quests; this.listOpen = true;
        // HandleQuestListSend clears the text box; an empty list leaves nothing to describe.
        if (!packet.quests.length) this.details = undefined;
        break;
      case Q.QuestDetails: { const { id: _id, ...details } = packet; this.details = details; break; }
      case Q.NpcQuestListSend: this.offers = packet.quests; this.offersOpen = packet.quests.length > 0; break;
      case Q.ObjQuestListSend: { const { id: _id, ...quest } = packet; this.offers = [quest]; this.offersOpen = true; break; }
      default: return;
    }
    this.revision++;
  }
  closeList() { if (this.listOpen) { this.listOpen = false; this.details = undefined; this.revision++; } }
  closeOffers() { if (this.offersOpen) { this.offersOpen = false; this.revision++; } }
}
