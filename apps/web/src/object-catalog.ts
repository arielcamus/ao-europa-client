/*
 * Object data read from Dat/Obj.dat, the fields the VB6 client copies from
 * ObjData(): Name, GrhIndex, ObjType, MinHit/MaxHit, MinDef/MaxDef, Texto,
 * proyectil and Destruye. AGPL-3.0-or-later; see NOTICE. Local mount only.
 */
import { fetchText, parseIni } from './assets.js';
import type { Ini } from './assets.js';

/** eObjType, Declares.bas. Only the values the items feature branches on. */
export const ObjType = {
  UseOnce: 1, Weapon: 2, Armour: 3, Trees: 4, Doors: 6, Signs: 8, Potions: 11, Shield: 16, Helmet: 17, Tools: 18,
  Teleport: 19, Decoration: 20, Magical: 21, Deposits: 22, Minerals: 23, Anvil: 27, Forge: 28, Rings: 30, Arrows: 32,
  Stains: 35, Donor: 36, Mail: 47, CastleSpawner: 10,
} as const;

export interface ObjectInfo {
  name: string; grh: number; type: number; minHit: number; maxHit: number; minDef: number; maxDef: number;
  text: string; projectile: boolean; destroys: boolean; creaLuz: boolean;
}

const num = (section: Map<string, string>, key: string) => { const value = Number(section.get(key)); return Number.isFinite(value) ? value : 0; };

export class ObjectCatalog {
  private cache = new Map<number, ObjectInfo | undefined>();
  constructor(readonly ini: Ini) {}
  get(id: number): ObjectInfo | undefined {
    if (this.cache.has(id)) return this.cache.get(id);
    const section = this.ini.get(`obj${id}`);
    const info = section && {
      name: section.get('name') ?? `Objeto ${id}`, grh: num(section, 'grhindex'), type: num(section, 'objtype'),
      minHit: num(section, 'minhit'), maxHit: num(section, 'maxhit'), minDef: num(section, 'mindef'), maxDef: num(section, 'maxdef'),
      text: section.get('texto') ?? '', projectile: num(section, 'proyectil') === 1, destroys: num(section, 'destruye') !== 0,
      creaLuz: !!section.get('crealuz'),
    };
    this.cache.set(id, info); return info;
  }
}

let loading: Promise<Ini> | undefined;
/** One shared fetch + parse of Dat/Obj.dat for the inventory, the shop and the map renderer. */
export function loadObjectIni(): Promise<Ini> {
  return loading ??= fetchText('Dat/Obj.dat').then(parseIni).catch(error => { loading = undefined; throw error; });
}
export const loadObjectCatalog = async () => new ObjectCatalog(await loadObjectIni());

/** GetInfo, clsGrapchicalInventory: the shop's description line. */
export function itemInfo(info: ObjectInfo | undefined): string {
  if (!info) return '';
  switch (info.type) {
    case ObjType.Weapon: return `Golpe: ${info.minHit}/${info.maxHit}`;
    case ObjType.Armour: case ObjType.Shield: case ObjType.Helmet: return `Defensa: ${info.minDef}/${info.maxDef}`;
    default: return info.text;
  }
}
/** DrawInterfaceComerciar suffix for PuedeUsar: 0 usable, else what blocks it. */
export function usableSuffix(canUse: number): string {
  return [' (Usable)', ' (No usa: Genero)', ' (No usa: Clase)', ' (No usa: Facción)', ' (No usa: Skill)', ' (No usa: Raza)', ' (No usa: Nivel)'][canUse] ?? ' (Usable)';
}
/** Objects the renderer draws a second time over characters (TileEngine_RenderScreen.bas). */
export const isTallObject = (type: number) => [ObjType.Trees, ObjType.Doors, ObjType.Signs, ObjType.Deposits, ObjType.Mail, ObjType.Anvil, ObjType.Forge, ObjType.Decoration, ObjType.CastleSpawner].includes(type as 4);
