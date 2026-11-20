/*
 * Left-click "look at tile" texts, adapted 2026-11-20 from client modLocale.bas
 * Locale_Parse_ServerMessage and ModUtils.bas UserInTileToTxtParser/NpcInTileToTxtParser.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 * Strings are the Spanish entries of Languages/1.json, which the client ships with.
 */
import type { LocaleData } from './character-data.js';

export const MSG_YOU_SEE_CHARACTER = 1105;
export const MSG_NPC_PET = 1621;
export const MSG_NPC = 1622;
/** Server separates locale parameters with U+00AC (`¬`), and the templates use `¬1`, `¬2`... */
const SEPARATOR = '¬';

const CLASSES = ['', 'Mago', 'Clérigo', 'Guerrero', 'Asesino', 'Bardo', 'Druida', 'Paladín', 'Cazador', 'Trabajador', 'Pirata', 'Ladrón', 'Bandido'];
const RACES = ['', 'Humano', 'Elfo', 'Elfo Oscuro', 'Gnomo', 'Enano', 'Orco'];
const NPC_STATUS: [number, string][] = [
  [1, 'Casi muerto'], [2, 'Gravemente herido'], [4, 'Herido'], [8, 'Levemente herido'], [16, 'Intacto'],
];

/** Fields(0) of UserInTileToTxtParser: the only user-info field the 1105 template (`Ves a ¬1`) prints. */
export function describeUser(packed: string): string {
  const [name = '', alias = '', desc = '', guild = '', spouse = '', cls = '', race = '', level = '', elo = ''] = packed.split('-');
  const className = CLASSES[Number(cls || 0)] ?? '', raceName = RACES[Number(race || 0)] ?? '';
  let text = `${name} `;
  if (alias) text += `<Alias:${alias}> `;
  if (desc) text += `<${desc}> `;
  if (guild) text += `<${guild}> `;
  if (spouse) text += `<Casado con ${spouse}> `;
  if (className) text += `<${className}|`; // VB6 writes `<Class|` and `Race>` independently
  if (raceName) text += `${raceName}> `;
  if (level) text += `<Nivel:${level}> `;
  if (elo) text += `Elo:${elo} `;
  return text;
}

function npcInfo(fields: string[], locale: LocaleData, pet: boolean): string[] {
  const out = [...fields];
  const npc = locale.npcs.get(Number(fields[0]));
  out[0] = npc?.name ?? fields[0] ?? '';
  const [hp = '', , , , , mask = '0'] = (fields[2] ?? '').split('-');
  const extra = NPC_STATUS.filter(([bit]) => (Number(mask) & bit) !== 0).map(([, text]) => `[${text}]`).join('');
  out[1] = ''; // ElementalTagsToTxtParser: tags are not part of this subset.
  out[2] = hp ? `<${hp}>${extra}` : extra;
  if (pet) out[3] = `[Mascota de ${fields[3] ?? ''}]`;
  return out;
}

/** Locale_Parse_ServerMessage for the ids this feature handles; other ids use the plain template. */
export function localeText(id: number, params: string, locale: LocaleData): string {
  const template = locale.messages.get(id) ?? '';
  if (!params) return template;
  let fields = params.split(SEPARATOR);
  if (id === MSG_YOU_SEE_CHARACTER) fields[0] = describeUser(fields[0] ?? '');
  if (id === MSG_NPC || id === MSG_NPC_PET) fields = npcInfo(fields, locale, id === MSG_NPC_PET);
  let text = template;
  // Replace from the end so ¬1 never clobbers ¬10, as the VB6 loop does.
  for (let i = fields.length - 1; i >= 0; i--) text = text.split(`${SEPARATOR}${i + 1}`).join(fields[i]!);
  return text;
}
