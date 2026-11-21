// AGPL-3.0-or-later. Referential-integrity check of the classic Dat/init/Mapas data set.
// Every id one file points at (NPC body/head, object graphic, spell FX, quest NPC/object, crafting
// object, map NPC/object spawn) must exist in the file that defines it. Dangling ids are how HOO-era
// data shows up on a classic client: an NPC whose body is not in cuerpos.dat is simply invisible.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Case-insensitive path join: the upstream tree mixes Obj.dat/obj.dat, Mapa1/mapa1. */
export function findPath(root, ...parts) {
  let dir = root;
  for (const part of parts) {
    if (!existsSync(dir)) return undefined;
    const hit = readdirSync(dir).find(name => name.toLowerCase() === part.toLowerCase());
    if (!hit) return undefined;
    dir = join(dir, hit);
  }
  return dir;
}

/** Windows-1252 INI the way GetVar reads it: case-insensitive sections and keys, VB `'` comments after a value ignored by val(). */
export function parseIni(text) {
  const ini = new Map();
  let section;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[([^\]]+)\]/.exec(line);
    if (head) {
      const name = head[1].trim().toLowerCase();
      section = ini.get(name) ?? new Map();
      ini.set(name, section);
      continue;
    }
    const kv = /^([^;#'=]+)=(.*)$/.exec(line);
    if (kv && section) section.set(kv[1].trim().toLowerCase(), kv[2].trim());
  }
  return ini;
}

const num = value => {
  const m = /^\s*(-?\d+)/.exec(value ?? '');
  return m ? Number(m[1]) : 0;
};
/** "a-b-c" lists (Obj1=38-10000, DropQuest1=10-2494-1-1): the n-th integer. */
const field = (value, n) => num((value ?? '').split('-')[n]);

/** graficos.ini (LoadGrhIni): GrhN=1-file-x-y-w-h (static) or GrhN=frames-id..-duration (animation). */
function parseGraphics(text) {
  const graphics = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^Grh(\d+)=(.+)$/i.exec(line.trim());
    if (!m) continue;
    const v = m[2].split('-').map(Number);
    if (!(v[0] > 0)) continue;
    graphics.set(Number(m[1]), v[0] === 1 ? { file: v[1], x: v[2], y: v[3], width: v[4], height: v[5] } : { frames: v.slice(1, 1 + v[0]) });
  }
  return graphics;
}

/** Width/height from the PNG IHDR chunk, undefined when the file is missing or not a PNG. Cached per file number. */
function pngSizer(dir) {
  const names = new Map(dir && existsSync(dir) ? readdirSync(dir).map(n => [n.toLowerCase(), n]) : []);
  const cache = new Map();
  return file => {
    if (cache.has(file)) return cache.get(file);
    const name = names.get(`${file}.png`);
    let size;
    if (name) {
      const head = readFileSync(join(dir, name)).subarray(0, 24);
      if (head.length === 24 && head.readUInt32BE(12) === 0x49484452) size = { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }
    cache.set(file, size);
    return size;
  };
}

/** cabezas.ind / cascos.ind: 263-byte header, i16 count, four i32 graphic ids per entry. Valid ids have a non-zero first graphic. */
function indexEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getInt16(263, true);
  const ids = new Map(); // id -> the four directional graphic ids
  for (let i = 1; i <= count; i++) {
    const at = 265 + (i - 1) * 16;
    if (at + 16 > bytes.length) break;
    const grhs = [0, 4, 8, 12].map(o => view.getInt32(at + o, true));
    if (grhs[0] > 0 || grhs[1] > 0) ids.set(i, grhs);
  }
  return ids;
}

/** The parts of a CSM map that reference other files: layer graphics, object spawns, NPC spawns (FileIO.CargarMapaFormatoCSM). */
export function readMapRefs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const i32 = () => { const v = view.getInt32(at, true); at += 4; return v; };
  const i16 = () => { const v = view.getInt16(at, true); at += 2; return v; };
  const str = () => { const n = view.getUint16(at, true); at += 2 + n; };
  const first = i32();
  const five = first === 0x324c3557; // W5L2
  const blocked = five ? i32() : first;
  const layers = Array.from({ length: five ? 5 : 4 }, i32);
  const [triggers, lights, particles, npcs, objects] = Array.from({ length: 6 }, i32);
  at += 8; // tMapSize
  // tMapDat: name, backup(u8), restrict, music hi/low + safe (9 bytes), zone, terrain, ambient, base light, letter grh, extras, extra3, rain/snow/fog.
  str(); at += 1; str(); at += 9; str(); str(); str(); at += 4 + 12; str(); at += 3;
  at += blocked * 5;
  const grhs = [];
  for (const count of layers) for (let i = 0; i < count; i++) { at += 4; grhs.push(view.getInt32(at, true)); at += 4; }
  at += triggers * 6 + particles * 8 + lights * 9;
  const objs = [];
  for (let i = 0; i < objects; i++) { const x = i16(), y = i16(), id = i16(); i16(); if (id > 0) objs.push({ x, y, id }); }
  const npcList = [];
  for (let i = 0; i < npcs; i++) { const x = i16(), y = i16(), id = i16(); if (id > 0) npcList.push({ x, y, id }); }
  return { grhs, objects: objs, npcs: npcList };
}

/** Load the data set under `root` (a Recursos-shaped tree: Dat/, init/, Mapas/). `datDir` overrides Dat/ (to check a candidate Dat set against the same init/ and maps). */
export function loadDataSet(root, { datDir, mapsDir, maps = 'all' } = {}) {
  const dat = datDir ?? findPath(root, 'Dat');
  const init = findPath(root, 'init');
  const mapDir = mapsDir ?? findPath(root, 'Mapas');
  const text = (dir, name) => { const p = findPath(dir, name); return p ? readFileSync(p, 'latin1') : undefined; };
  const ini = (dir, name) => { const t = text(dir, name); return t === undefined ? undefined : parseIni(t); };
  const set = {
    npcs: ini(dat, 'npcs.dat'), objs: ini(dat, 'obj.dat'), spells: ini(dat, 'Hechizos.dat'), quests: ini(dat, 'Quests.DAT'),
    crafting: Object.fromEntries(['ArmasHerrero.dat', 'ArmadurasHerrero.dat', 'ObjCarpintero.dat', 'ObjSastre.dat', 'ObjAlquimista.dat']
      .map(n => [n, ini(dat, n)]).filter(([, v]) => v)),
    bodies: ini(init, 'cuerpos.dat'), molds: ini(init, 'moldes.ini'), weapons: ini(init, 'armas.dat'), shields: ini(init, 'escudos.dat'), fxs: ini(init, 'FXs.ini'),
    heads: findPath(init, 'cabezas.ind') ? indexEntries(readFileSync(findPath(init, 'cabezas.ind'))) : undefined,
    helmets: findPath(init, 'cascos.ind') ? indexEntries(readFileSync(findPath(init, 'cascos.ind'))) : undefined,
    graphics: text(init, 'graficos.ini') !== undefined ? parseGraphics(text(init, 'graficos.ini')) : undefined,
    pngSize: pngSizer(findPath(root, 'Graficos')),
    maps: new Map(),
  };
  if (mapDir && maps) {
    for (const name of readdirSync(mapDir)) {
      const m = /^mapa(\d+)\.csm$/i.exec(name);
      if (!m || (maps !== 'all' && !maps.includes(Number(m[1])))) continue;
      const bytes = readFileSync(join(mapDir, name));
      if (bytes.length === 0) continue; // mapa844.csm is zero bytes upstream; the server skips it too
      try { set.maps.set(Number(m[1]), readMapRefs(bytes)); } catch { set.maps.set(Number(m[1]), { error: true, grhs: [], objects: [], npcs: [] }); }
    }
  }
  return set;
}

/** ObjTypes that are never in an inventory (Declares.bas e_OBJType): trees, doors, signs, castle spawner, teleports, decorations,
 * ore deposits, anvils, forges, maps, chests, fishing pools. */
const WORLD_ONLY_TYPES = new Set([4, 6, 8, 10, 19, 20, 22, 27, 28, 37, 48, 52]);

const hasContent = section => section !== undefined && [...section.values()].some(v => v !== '');

/**
 * Returns { checks: { <check>: { refs, missing: [{ from, id }] } }, missingInputs }.
 * A reference is "missing" when its target section/entry does not exist or is empty ([OBJ1425] with no keys counts as missing).
 */
export function checkIntegrity(set) {
  const checks = {};
  const add = (check, from, id, ok) => {
    const c = (checks[check] ??= { refs: 0, missing: [] });
    c.refs++;
    if (!ok) c.missing.push({ from, id });
  };
  const npcOk = id => hasContent(set.npcs?.get(`npc${id}`));
  const objOk = id => hasContent(set.objs?.get(`obj${id}`));
  const questOk = id => hasContent(set.quests?.get(`quest${id}`));
  const spellOk = id => hasContent(set.spells?.get(`hechizo${id}`));
  const missingInputs = Object.entries({ npcs: set.npcs, objs: set.objs, spells: set.spells, quests: set.quests, bodies: set.bodies,
    heads: set.heads, helmets: set.helmets, graphics: set.graphics, weapons: set.weapons, shields: set.shields, fxs: set.fxs })
    .filter(([, v]) => !v).map(([k]) => k);

  // A static graphic is drawable when its PNG exists and the rectangle lies inside it; an animation when every frame is.
  const drawable = (id, depth = 0) => {
    const g = set.graphics?.get(id);
    if (!g) return false;
    if (g.frames) return depth < 2 && g.frames.length > 0 && g.frames.every(f => drawable(f, depth + 1));
    const size = set.pngSize?.(g.file);
    return !!size && g.x >= 0 && g.y >= 0 && g.width > 0 && g.height > 0 && g.x + g.width <= size.width && g.y + g.height <= size.height;
  };
  /**
   * A cuerpos.dat / armas.dat / escudos.dat entry draws when Std=0 and its four Walk/Dir graphics are drawable, or Std>0 with an
   * existing moldes.ini template and an existing FileNum PNG (Recursos.bas CargarCuerpos / CargarAnimArmas / CargarAnimEscudos).
   */
  const spriteDraws = (section, prefix) => {
    if (!hasContent(section)) return false;
    const std = num(section.get('std'));
    if (std > 0) return hasContent(set.molds?.get(`molde${std}`)) && !!set.pngSize?.(num(section.get('filenum')));
    return [1, 2, 3, 4].every(h => drawable(num(section.get(`${prefix}${h}`))));
  };
  const indexDraws = (index, id) => (index?.get(id) ?? []).filter(g => g > 0).every(g => drawable(g)) && index?.has(id);
  const sprite = (check, from, id, kind) => {
    const sections = { body: set.bodies, weapon: set.weapons, shield: set.shields };
    const prefix = { body: 'body', weapon: 'arma', shield: 'esc' }[kind];
    const section = sections[kind]?.get(`${prefix}${id}`);
    add(check, from, id, hasContent(section));
    if (hasContent(section)) add(`${check}Graphic`, from, id, spriteDraws(section, kind === 'body' ? 'walk' : 'dir'));
  };
  const indexed = (check, from, id, index) => {
    add(check, from, id, index?.has(id));
    if (index?.has(id)) add(`${check}Graphic`, from, id, indexDraws(index, id));
  };

  for (const [name, s] of set.npcs ?? []) {
    const m = /^npc(\d+)$/.exec(name);
    if (!m || !hasContent(s)) continue;
    const from = `NPC${m[1]}`;
    for (const key of ['body', 'bodyidle']) { const id = num(s.get(key)); if (id > 0) sprite('npc.body', `${from}.${key}`, id, 'body'); }
    const head = num(s.get('head')); if (head > 0) indexed('npc.head', from, head, set.heads);
    const arma = num(s.get('arma')); if (arma > 0) sprite('npc.weapon', from, arma, 'weapon');
    const esc = num(s.get('escudo')); if (esc > 0) sprite('npc.shield', from, esc, 'shield');
    const casco = num(s.get('casco')); if (casco > 0) indexed('npc.helmet', from, casco, set.helmets);
    for (const [key, value] of s) {
      if (/^obj\d+$/.test(key)) { const id = field(value, 0); if (id > 0) add('npc.shopObject', `${from}.${key}`, id, objOk(id)); }
      else if (/^quizadropea\d+$/.test(key)) { const id = field(value, 0); if (id > 0) add('npc.dropObject', `${from}.${key}`, id, objOk(id)); }
      else if (/^dropquest\d+$/.test(key)) {
        const q = field(value, 0), id = field(value, 1);
        if (q > 0) add('npc.quest', `${from}.${key}`, q, questOk(q));
        if (id > 0) add('npc.dropObject', `${from}.${key}`, id, objOk(id));
      } else if (/^questnumber\d+$/.test(key)) { const q = num(value); if (q > 0) add('npc.quest', `${from}.${key}`, q, questOk(q)); }
      else if (/^sp\d+$/.test(key)) { const id = num(value); if (id > 0) add('npc.spell', `${from}.${key}`, id, spellOk(id)); }
    }
  }

  for (const [name, s] of set.objs ?? []) {
    const m = /^obj(\d+)$/.exec(name);
    if (!m || !hasContent(s)) continue;
    const from = `OBJ${m[1]}`;
    const grh = num(s.get('grhindex'));
    if (grh > 0) {
      add('obj.grh', from, grh, set.graphics?.has(grh));
      if (set.graphics?.has(grh)) add('obj.grhFile', from, grh, drawable(grh));
      // Inventory icons are one 32x32 frame (frmMain picInv slots). A world-only object (tree, door, sign, deposit, anvil, ...) may be any size.
      // A carried object whose GrhIndex is a body/weapon sprite frame instead (the 2026-10 obj.dat: OBJ3488 "Escudo del Principiante"
      // GrhIndex 3485 = Graficos/1983.png 73,45 26x46, a cape frame) shows a wrong inventory picture. Keyed by object id.
      const type = num(s.get('objtype'));
      if (!WORLD_ONLY_TYPES.has(type)) {
        const g = set.graphics?.get(grh);
        add('obj.inventoryIcon', from, Number(m[1]), !!g && !g.frames && g.width === 32 && g.height === 32);
      }
    }
    for (const [key, value] of s) {
      if (/^(ropaje\w+|numropaje)$/.test(key)) { const id = num(value); if (id > 0) sprite('obj.body', `${from}.${key}`, id, 'body'); }
    }
    const type = num(s.get('objtype')), anim = num(s.get('anim'));
    // The server sends Anim as CharacterChange weapon/shield/helmet (FileIO.LoadOBJData: WeaponAnim/ShieldAnim/CascoAnim = "Anim").
    if (anim > 0 && type === 2) sprite('obj.weaponAnim', from, anim, 'weapon');
    if (anim > 0 && type === 16) sprite('obj.shieldAnim', from, anim, 'shield');
    if (anim > 0 && type === 17) indexed('obj.helmetAnim', from, anim, set.helmets);
    for (const key of ['indexabierta', 'indexcerrada', 'indexcerradallave']) {
      const id = num(s.get(key)); if (id > 0) add('obj.door', `${from}.${key}`, id, objOk(id));
    }
  }

  for (const [name, s] of set.spells ?? []) {
    const m = /^hechizo(\d+)$/.exec(name);
    if (!m || !hasContent(s)) continue;
    const from = `HECHIZO${m[1]}`;
    const fx = num(s.get('fxgrh')); if (fx > 0) add('spell.fx', from, fx, hasContent(set.fxs?.get(`fx${fx}`)));
    const npc = num(s.get('numnpc')); if (npc > 0) add('spell.npc', from, npc, npcOk(npc));
    for (const key of ['materializaobj', 'necesitaobj']) { const id = num(s.get(key)); if (id > 0) add('spell.object', `${from}.${key}`, id, objOk(id)); }
  }

  for (const [name, s] of set.quests ?? []) {
    const m = /^quest(\d+)$/.exec(name);
    if (!m || !hasContent(s)) continue;
    const from = `QUEST${m[1]}`;
    for (const [key, value] of s) {
      if (/^(requirednpc|requiredtargetnpc)\d+$/.test(key)) { const id = field(value, 0); if (id > 0) add('quest.npc', `${from}.${key}`, id, npcOk(id)); }
      else if (key === 'talkto') { const id = num(value); if (id > 0) add('quest.npc', `${from}.${key}`, id, npcOk(id)); }
      else if (/^(requiredobj|rewardobj)\d+$/.test(key)) { const id = field(value, 0); if (id > 0) add('quest.object', `${from}.${key}`, id, objOk(id)); }
      else if (key === 'nextquest' || key === 'requiredquest') { const id = num(value); if (id > 0) add('quest.quest', `${from}.${key}`, id, questOk(id)); }
      else if (/^requiredspell\d*$/.test(key)) { const id = num(value); if (id > 0) add('quest.spell', `${from}.${key}`, id, spellOk(id)); }
    }
  }

  for (const [file, ini] of Object.entries(set.crafting)) {
    for (const [name, s] of ini) {
      if (name === 'init') continue;
      const id = num(s.get('index')); if (id > 0) add('crafting.object', `${file}[${name}]`, id, objOk(id));
    }
  }

  for (const [map, refs] of set.maps) {
    if (refs.error) { add('map.parse', `mapa${map}`, 0, false); continue; }
    for (const id of new Set(refs.grhs)) add('map.grh', `mapa${map}`, id, set.graphics?.has(id));
    for (const o of refs.objects) add('map.object', `mapa${map}(${o.x},${o.y})`, o.id, objOk(o.id));
    for (const n of refs.npcs) add('map.npc', `mapa${map}(${n.x},${n.y})`, n.id, npcOk(n.id));
  }
  return { checks, missingInputs };
}

/** Dangling refs not covered by a baseline of known upstream gaps: { <check>: [ids] }. */
export function newGaps(result, knownGaps = {}) {
  const out = {};
  for (const [check, { missing }] of Object.entries(result.checks)) {
    const known = new Set(knownGaps[check] ?? []);
    const fresh = missing.filter(m => !known.has(m.id));
    if (fresh.length) out[check] = fresh;
  }
  return out;
}

/** Distinct missing ids per check, sorted: the shape of a knownGaps baseline. */
export function gapIds(result) {
  return Object.fromEntries(Object.entries(result.checks).filter(([, c]) => c.missing.length)
    .map(([check, c]) => [check, [...new Set(c.missing.map(m => m.id))].sort((a, b) => a - b)]));
}
