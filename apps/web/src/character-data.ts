/*
 * Character resources adapted 2026-11-20 from client Recursos.bas (CargarAnimArmas,
 * CargarEscudos, CargarCascos, CargarColores, CargarIndicesOBJ) and
 * TileEngine_Chars/Protocol HandleCharacterCreate. Copyright (C) 2022-2026
 * Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE and NOTICE.
 */
import { graphicAnimation } from './assets.js';
import type { Animation, GraphicIndex, Ini } from './assets.js';

/** Four-heading animation set (index 0..3 = North, East, South, West) for a weapon or shield. */
export type EquipmentSet = (Animation | undefined)[];

const clamp = (n: number) => Math.min(255, Math.max(0, n));
export interface Rgb { r: number; g: number; b: number }

/**
 * armas.dat ([ARMAn]) and escudos.dat ([ESCn]) share one layout: either Dir1..Dir4 graphic
 * ids (Std=0) or a mold template over FileNum (Std>0). Animation speed is NumFrames/0.018
 * ms per cycle, i.e. 1/0.018 ms per frame, for both, as in CargarAnimArmas/CargarEscudos.
 */
export function readEquipment(source: Ini, molds: Ini, graphics: GraphicIndex, prefix: 'arma' | 'esc', id: number): EquipmentSet {
  const section = source.get(`${prefix}${id}`);
  if (!section) return [];
  const value = (key: string) => Number(section.get(key) ?? 0);
  const std = value('std');
  const sets: EquipmentSet = [];
  if (std === 0) {
    for (let heading = 1; heading <= 4; heading++) {
      const grh = value(`dir${heading}`);
      if (grh > 0 && graphics.has(grh)) sets[heading - 1] = graphicAnimation(graphics, grh);
    }
    return sets;
  }
  const mold = molds.get(`molde${std}`);
  if (!mold) return [];
  const m = (key: string) => Number(mold.get(key) ?? 0);
  // Mold rows are stored South, North, West, East (BodiesHeading), like readBody.
  [3, 1, 4, 2].forEach((heading, row) => {
    const frames = m(`dir${row + 1}`);
    if (!Number.isInteger(frames) || frames < 1 || frames > 256 || m('width') < 1 || m('height') < 1) return;
    sets[heading - 1] = {
      frameMs: 1 / 0.018,
      frames: Array.from({ length: frames }, (_, frame) => ({
        file: value('filenum'), x: m('x') + frame * m('width'), y: m('y') + row * m('height'),
        width: m('width'), height: m('height'),
      })),
    };
  });
  return sets;
}

/** colores.dat has sections like `[6] 'comment`; Ini parsing would drop them. */
export function parseColors(text: string): Map<string, Rgb> {
  const colors = new Map<string, Rgb>();
  let name: string | undefined;
  let value: Rgb | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const section = /^\[([^\]]+)\]/.exec(raw.trim());
    if (section) { name = section[1]!.trim().toLowerCase(); value = { r: 0, g: 0, b: 0 }; colors.set(name, value); continue; }
    const field = /^([RGB])\s*=\s*(\d+)/i.exec(raw.trim());
    if (field && value) value[field[1]!.toLowerCase() as 'r' | 'g' | 'b'] = clamp(Number(field[2]));
  }
  return colors;
}
const COLOR_KEYS: Record<number, string> = { 48: 'ne', 49: 'ci', 50: 'cr' };
/** ColoresPJ(i): 0..47 numbered sections, 48 Ne, 49 Ci, 50 Cr (CargarColores). */
export const colorPj = (colors: Map<string, Rgb>, index: number): Rgb =>
  colors.get(COLOR_KEYS[index] ?? String(index)) ?? { r: 255, g: 255, b: 255 };

/**
 * Name colour of a player (Char_Render): privileged characters use ColoresPJ(priv), others
 * the status colour: 0 criminal(50), 1 citizen(49), 2 -> 6, 3 -> 7. NPC names are drawn in
 * (0,129,195) and only under the mouse. Same-group members are drawn white.
 */
export function playerNameColor(colors: Map<string, Rgb>, status: number, privileges: number, sameGroup = false): Rgb {
  if (sameGroup) return { r: 255, g: 255, b: 255 };
  // .priv = Log2(privs); bit 0 gives 0, which VB6 treats as "no privilege".
  const priv = privileges > 0 ? Math.round(Math.log2(privileges)) : 0;
  if (priv !== 0) return colorPj(colors, priv);
  return colorPj(colors, ({ 0: 50, 1: 49, 2: 6, 3: 7 } as Record<number, number>)[status] ?? 50);
}
export const NPC_NAME_COLOR: Rgb = { r: 0, g: 129, b: 195 };

/** The name as the header shows it: an empty alias `{}` or clan `<>` renders nothing, as in VB6. */
export const displayName = (raw: string) => raw.replace(/\s*\{\s*\}/g, '').replace(/\s*<\s*>/g, '').trim();

/** HandleCharacterCreate: "Name{alias}<Clan>" -> parts. */
export function splitName(raw: string): { name: string; alias: string; clan: string } {
  const alias = raw.indexOf('{'), aliasEnd = raw.indexOf('}'), clan = raw.indexOf('<');
  const name = alias > 0 ? raw.slice(0, alias).trim() : clan === 0 || clan < 0 ? raw : raw.slice(0, clan).trim();
  return {
    name,
    alias: alias >= 0 && aliasEnd > alias ? raw.slice(alias + 1, aliasEnd) : '',
    clan: clan >= 0 ? `<${raw.slice(clan + 1, Math.max(clan + 1, raw.indexOf('>', clan)))}>` : '',
  };
}
/** Title shown instead of the clan for game masters (Char_Render, Select Case .priv). */
export function privilegeTitle(priv: number): string | undefined {
  return ({ 1: '<Game Design>', 2: '<Game Master>', 3: '<Administrador>', 4: '<Administrador>' } as Record<number, string>)[priv];
}
export const privilegeIndex = (privileges: number) => privileges === 0 ? 0 : Math.round(Math.log2(privileges));

export interface LocaleData { messages: Map<number, string>; npcs: Map<number, { name: string; desc: string; body: number; head: number }> }
/** sp_localindex.dat: [SP_MSG] MsgN=text and [NPCn] NAME/DESC/BODY/HEAD (CargarIndicesOBJ). */
export function parseLocale(source: Ini): LocaleData {
  const messages = new Map<number, string>();
  for (const [key, text] of source.get('sp_msg') ?? []) {
    const match = /^msg(\d+)$/.exec(key);
    if (match) messages.set(Number(match[1]), text);
  }
  const npcs = new Map<number, { name: string; desc: string; body: number; head: number }>();
  for (const [section, fields] of source) {
    const match = /^npc(\d+)$/.exec(section);
    if (match) npcs.set(Number(match[1]), {
      name: fields.get('name') ?? '', desc: fields.get('desc') ?? '',
      body: Number(fields.get('body') ?? 0), head: Number(fields.get('head') ?? 0),
    });
  }
  return { messages, npcs };
}
