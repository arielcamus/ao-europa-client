/*
 * frmMapaGrande's creature list, stat labels and drop list, from the pinned classic client 619e69d (frmMapaGrande.frm
 * ListView1_ItemClick, Recursos.CargarDatosMapa, GetNpcDropPercentageFromDenominator). The creatures of a map come from the NPC section of
 * its .csm file, the stats from the NPC table (init/sp_localindex.dat, the file the pinned client reads; Dat/npcs.dat only for the drop keys that file lacks).
 * NOT QuestNPCsMapData.bin: that file (ListNPCMapData) only feeds the minimap's NPC dots (ModMinimap), the large map never reads it.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import type { Ini, MapFileNpc } from './assets.js';

export interface NpcRow { index: number; name: string; count: number }
export interface NpcDrop { object: number; /** GetNpcDropPercentageFromDenominator, or 100 for a guaranteed drop. */ percent: number }
export interface NpcInfo { index: number; name: string; body: number; head: number; hp: number; exp: number; gold: number; minHit: number; maxHit: number; expClan: number; drops: NpcDrop[]; noMapInfo: boolean }

/** VB6 Val(): the leading number of a string ("26-1" is 26), 0 when there is none. */
export const vbVal = (text: string | undefined) => { const match = /^\s*[-+]?\d*\.?\d+/.exec(text ?? ''); return match ? Number(match[0]) : 0; };

/** Round(100 / Denominator, 2); a denominator of 0 or less is 0. */
export const dropPercent = (denominator: number) => denominator <= 0 ? 0 : Math.round(100 / denominator * 100) / 100;

/**
 * An INI reader that accepts what the NPC files really contain: a trailing comment after a section header ("[NPC560] 'Ogro") and values
 * with a VB comment. assets.parseIni would fold such a section into the previous one and corrupt both.
 */
export function parseNpcSections(text: string): Ini {
  const ini: Ini = new Map(); let section = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) { const name = header[1]!.toLowerCase(); section = ini.get(name) ?? new Map(); ini.set(name, section); continue; }
    const match = /^([^;#'=]+)=(.*)$/.exec(line);
    if (match) section.set(match[1]!.trim().toLowerCase(), match[2]!.trim());
  }
  return ini;
}

/**
 * NpcData(n) of Recursos.bas, the fields frmMapaGrande reads. The pinned client takes all of them from init/<lang>_localindex.dat (`local`).
 * That pre-HOO file has Name, Body, Head, HP, EXP, ORO, MinHit, MaxHit and GiveEXPClan but none of the DropCount / Drop<n> / NroItems / Obj<n> /
 * NpcType / Comercia keys the client code reads, so those fall back to the server's own [NPCn] (Dat/npcs.dat, `server`) when `local` lacks them.
 */
export function npcInfo(local: Ini, server: Ini | undefined, index: number): NpcInfo | undefined {
  const section = local.get(`npc${index}`);
  if (!section) return undefined;
  const fallback = server?.get(`npc${index}`);
  const n = (key: string) => vbVal(section.get(key));
  const drops: NpcDrop[] = [];
  const hasDropKeys = section.has('dropcount') || section.has('nroitems');
  const source = hasDropKeys ? section : fallback ?? section;
  const dropCount = vbVal(source.get('dropcount')), npcType = vbVal(source.get('npctype')), comercia = vbVal(source.get('comercia')), items = vbVal(source.get('nroitems'));
  // "DropN=obj-denominator[-min-max]"
  for (let i = 1; i <= dropCount; i++) {
    const parts = (source.get(`drop${i}`) ?? '').trim().split('-');
    const object = vbVal(parts[0]);
    if (object > 0) drops.push({ object, percent: dropPercent(vbVal(parts[1])) });
  }
  // A seller's own stock is not a drop; any other NPC with NroItems drops all of them, always.
  if (npcType === 0 && items > 0 && comercia < 1) {
    for (let i = 1; i <= items; i++) { const object = vbVal(source.get(`obj${i}`)); if (object > 0) drops.push({ object, percent: 100 }); }
  }
  return {
    index, name: section.get('name') || 'Vacío', body: n('body'), head: n('head'), hp: n('hp'), exp: n('exp'), gold: n('oro'), minHit: n('minhit'), maxHit: n('maxhit'),
    expClan: n('giveexpclan'), drops, noMapInfo: n('nomapinfo') === 1,
  };
}

/** CargarDatosMapa: one row per NpcIndex on the map (ascending), skipping NoMapInfo NPCs, with how many there are. */
export function npcRows(npcs: readonly MapFileNpc[], local: Ini): NpcRow[] {
  const counts = new Map<number, number>();
  for (const { npcIndex } of npcs) counts.set(npcIndex, (counts.get(npcIndex) ?? 0) + 1);
  const rows: NpcRow[] = [];
  for (const index of [...counts.keys()].sort((a, b) => a - b)) {
    const info = npcInfo(local, undefined, index);
    if (info && !info.noMapInfo) rows.push({ index, name: info.name, count: counts.get(index)! });
  }
  return rows;
}

/** Which bitmap rows of the creature list are heading S, W, N, E: tmrPreview starts at 3 (south) and turns 3, 4, 1, 2, ... every 18 ticks. */
export const PREVIEW_INTERVAL_MS = 120, PREVIEW_DIR_TICKS = 18;
export interface PreviewState { heading: number; frame: number; tick: number }
export const previewStart = (): PreviewState => ({ heading: 3, frame: 1, tick: 0 });
/** tmrPreview_Timer: the frame advances (wrapping at the longest of body and head), every DIR_TICKS the heading turns and the frame restarts. */
export function previewStep(state: PreviewState, bodyFrames: number, headFrames: number): PreviewState {
  let { heading, frame, tick } = state;
  if (heading < 1 || heading > 4) heading = 1;
  frame += 1;
  const longest = Math.max(bodyFrames, headFrames, 1);
  if (frame > longest) frame = 1;
  tick += 1;
  if (tick >= PREVIEW_DIR_TICKS) { tick = 0; heading += 1; if (heading > 4) heading = 1; frame = 1; }
  return { heading, frame, tick };
}
