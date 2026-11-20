/*
 * Recipe text for the smith and carpenter windows, adapted 2026-11-20 from the classic client's
 * frmHerrero.AddMaterialNames/AddMaterialValues and frmCarp.lstArmas_Click. The server only sends
 * which objects can be built; the materials come from Dat/Obj.dat (ObjData). AGPL-3.0-or-later; see NOTICE.
 */
import type { Ini } from './assets.js';
import { ObjType } from './object-catalog.js';

/** Languages/1.json MENSAJE_LINGOTE_DE_HIERRO ... MENSAJE_ESENCIA_DE_AIRE (Spanish), in AddMaterialNames order. */
const SMITH_MATERIALS = [
  ['lingh', 'Lingote de hierro'], ['lingp', 'Lingote de plata'], ['lingo', 'Lingote de oro'], ['coal', 'Carbón'], ['blodium', 'Blodium'],
  ['fireessence', 'Esencia de fuego'], ['wateressence', 'Esencia de agua'], ['earthessence', 'Esencia de tierra'], ['windessence', 'Esencia de viento'],
] as const;

export interface Material { name: string; amount: number }
const value = (ini: Ini, object: number, key: string) => { const n = Number(ini.get(`obj${object}`)?.get(key)); return Number.isFinite(n) ? n : 0; };

/** AddMaterialNames + AddMaterialValues: only the materials the object needs, in the VB6 order. */
export function smithMaterials(ini: Ini, object: number): Material[] {
  return SMITH_MATERIALS.map(([key, name]) => ({ name, amount: value(ini, object, key) })).filter(material => material.amount > 0);
}
/** frmCarp.lstArmas_Click: the two wood columns are always listed, plain then elven. */
export function carpenterMaterials(ini: Ini, object: number): Material[] {
  return [{ name: 'Leña', amount: value(ini, object, 'madera') }, { name: 'Leña élfica', amount: value(ini, object, 'maderaelfica') }];
}
/** frmHerrero.List1_Click: the graphic follows the row (iron, silver, gold ingot), whatever the row's material. */
export const SMITH_MATERIAL_GRH = [724, 725, 723] as const;
/** frmCarp.List1_Click. */
export const carpenterMaterialGrh = (row: number) => (row === 0 ? 550 : 5348);

export type SmithTab = 'weapons' | 'armors' | 'helmets' | 'shields' | 'runes';
/** HandleBlacksmithArmors: the defence list is split by object type into armours, shields (and rings, magic items) and helmets. */
export function splitDefenses(defenses: readonly number[], typeOf: (object: number) => number) {
  const armors: number[] = [], shields: number[] = [], helmets: number[] = [];
  for (const object of defenses) {
    if (object === 0) break;
    const type = typeOf(object);
    if (type === ObjType.Armour) armors.push(object);
    // Shields (16), magic objects (21), rings (30 and 35) and type 100 share one list.
    if ([ObjType.Shield, ObjType.Rings, ObjType.Magical, ObjType.Stains, 100].includes(type as 16)) shields.push(object);
    if (type === ObjType.Helmet) helmets.push(object);
  }
  return { armors, shields, helmets };
}
