/*
 * Left-click "look at tile" texts, adapted 2026-11-20 from client modLocale.bas
 * Locale_Parse_ServerMessage and ModUtils.bas UserInTileToTxtParser/NpcInTileToTxtParser.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 * Strings are the Spanish entries of Languages/1.json, which the client ships with.
 */

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

function npcInfo(fields: string[], npcName: (npcNumber: number) => string | undefined, pet: boolean): string[] {
  const out = [...fields];
  out[0] = npcName(Number(fields[0])) ?? fields[0] ?? '';
  const [hp = '', , , , , mask = '0'] = (fields[2] ?? '').split('-');
  const extra = NPC_STATUS.filter(([bit]) => (Number(mask) & bit) !== 0).map(([, text]) => `[${text}]`).join('');
  out[1] = ''; // ElementalTagsToTxtParser: tags are not part of this subset.
  out[2] = hp ? `<${hp}>${extra}` : extra;
  if (pet) out[3] = `[Mascota de ${fields[3] ?? ''}]`;
  return out;
}

/**
 * Locale_Parse_ServerMessage field rewrites for the look-at ids (UserInTileToTxtParser / NpcInTileToTxtParser); other ids keep
 * their fields. Shared by the chat console pipeline (ChatLocale.message) so a look-at reply reads the same everywhere.
 */
export function lookAtFields(id: number, fields: string[], npcName: (npcNumber: number) => string | undefined): string[] {
  if (id === MSG_YOU_SEE_CHARACTER) return [describeUser(fields[0] ?? ''), ...fields.slice(1)];
  if (id === MSG_NPC || id === MSG_NPC_PET) return npcInfo(fields, npcName, id === MSG_NPC_PET);
  return fields;
}
