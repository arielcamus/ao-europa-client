/*
 * Classic resource readers, adapted 2026-11-20 from Recursos.bas/GameIni.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE. No game artwork is included.
 */
export interface WorldMap {
  name: string;
  layers: Uint32Array[];
  blocked: Uint8Array;
  /** Per-tile trigger id (e_Trigger); 0 when none. Drives the roof rule. */
  triggers: Uint16Array;
  /**
   * Objects stored in the map file (CargarMapa reads them into MapData.ObjGrh). The server never sends the "fixed" ones
   * (trees, signs, deposits, decorations; ModAreas.EsObjetoFijo), so the map file is the only source for them.
   */
  objects: MapFileObject[];
  /** The NPC and tile-exit sections after the objects stay opaque. */
  trailingBytes: number;
}
export interface MapFileObject { x: number; y: number; objIndex: number; amount: number;
}
export interface GraphicFrame { file: number; x: number; y: number; width: number; height: number }
export interface Animation { frames: GraphicFrame[]; frameMs: number }
type Graphic = GraphicFrame | { ids: number[]; duration: number };
export type GraphicIndex = Map<number, Graphic>;
export type Ini = Map<string, Map<string, string>>;

/** Preserve the indexed footprint when an upstream rectangle runs off its PNG. */
export function clipFrame(frame: GraphicFrame, sheetWidth: number, sheetHeight: number) {
  const width = Math.max(0, Math.min(frame.width, sheetWidth - frame.x));
  const height = Math.max(0, Math.min(frame.height, sheetHeight - frame.y));
  return { width, height, clipped: width !== frame.width || height !== frame.height };
}

class Cursor {
  offset = 0;
  view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(n: number): number {
    if (n < 0 || this.offset + n > this.bytes.length) throw new Error(`Truncated resource at byte ${this.offset}`);
    const start = this.offset; this.offset += n; return start;
  }
  u8() { return this.view.getUint8(this.take(1)); }
  i16() { return this.view.getInt16(this.take(2), true); }
  i32() { return this.view.getInt32(this.take(4), true); }
  text() {
    const size = this.view.getUint16(this.take(2), true);
    const start = this.take(size);
    return new TextDecoder('windows-1252').decode(this.bytes.subarray(start, start + size));
  }
}

export function tileIndex(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x > 100 || y > 100) {
    throw new Error(`Tile outside 1..100: ${x},${y}`);
  }
  return (y - 1) * 100 + x - 1;
}

export function parseMap(bytes: Uint8Array): WorldMap {
  const r = new Cursor(bytes);
  const first = r.i32();
  const five = first === 0x324c3557; // W5L2
  const count = (n: number) => {
    if (n < 0 || n > 10_000) throw new Error(`Invalid CSM section count ${n}`);
    return n;
  };
  const blockedCount = count(five ? r.i32() : first);
  const counts = Array.from({ length: five ? 5 : 4 }, () => count(r.i32()));
  // Header order (tMapHeader): triggers, lights, particles, NPCs, objects, tile exits.
  const [triggerCount, lightCount, particleCount, , objectCount] = Array.from({ length: 6 }, () => count(r.i32())) as [number, number, number, number, number, number];
  r.take(8); // tMapSize is often all zero; the classic world bounds are 1..100.
  const name = r.text();
  r.u8(); r.text(); r.take(9); // backup, restrict, two music IDs, safe
  r.text(); r.text(); r.text(); // zone, terrain, ambient
  r.take(16); r.text(); r.take(3); // light, letter, extras, weather
  const blocked = new Uint8Array(10_000);
  for (let i = 0; i < blockedCount; i++) {
    const index = tileIndex(r.i16(), r.i16());
    blocked[index] = r.u8();
  }
  const layers = Array.from({ length: 5 }, () => new Uint32Array(10_000));
  const order = five ? [0, 1, 2, 3, 4] : [0, 1, 3, 4];
  for (const [section, layer] of order.entries()) {
    for (let i = 0; i < counts[section]!; i++) {
      const index = tileIndex(r.i16(), r.i16());
      const grh = r.i32();
      if (grh <= 0) throw new Error(`Invalid CSM graphic ${grh}`);
      layers[layer]![index] = grh;
    }
  }
  // Section order after the layers (FileIO.CargarMapaFormatoCSM): triggers (x:i16, y:i16, trigger:i16).
  const triggers = new Uint16Array(10_000);
  for (let i = 0; i < triggerCount; i++) {
    const x = r.i16(), y = r.i16(), trigger = r.i16();
    if (x >= 1 && y >= 1 && x <= 100 && y <= 100) triggers[tileIndex(x, y)] = trigger; // tolerate stray editor tiles
  }
  // File order after the triggers (Recursos.CargarMapa): particles (x,y,i32), lights (x,y,RGBA,range), objects (x,y,index,amount).
  r.take(particleCount * 8); r.take(lightCount * 9);
  const objects: MapFileObject[] = [];
  for (let i = 0; i < objectCount; i++) {
    const x = r.i16(), y = r.i16(), objIndex = r.i16(), amount = r.i16();
    if (objIndex > 0 && x >= 1 && y >= 1 && x <= 100 && y <= 100) objects.push({ x, y, objIndex, amount });
  }
  return { name, layers, blocked, triggers, objects, trailingBytes: bytes.length - r.offset };
}

export function parseIni(text: string): Ini {
  const ini: Ini = new Map();
  let section = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).toLowerCase();
      section = ini.get(name) ?? new Map(); ini.set(name, section);
    } else {
      const match = /^([^;#=]+)=(.*)$/.exec(line);
      if (match) section.set(match[1]!.trim().toLowerCase(), match[2]!.trim());
    }
  }
  return ini;
}

export function parseGraphics(text: string): GraphicIndex {
  const graphics: GraphicIndex = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^Grh(\d+)=(.+)$/i.exec(line.trim());
    if (!match) continue;
    const id = Number(match[1]);
    const values = match[2]!.split('-').map(Number);
    const [count, file, x, y, width, height] = values;
    if (!Number.isInteger(count) || count! < 1 || count! > 1024 || values.some(n => !Number.isFinite(n))) {
      throw new Error(`Invalid graphic ${id}`);
    }
    if (count === 1) {
      // LoadGrhIni reads only the first six fields of a static record. Some local
      // indexes contain unused extra fields; never guess a different frame count.
      if (values.length < 6 || file! <= 0 || x! < 0 || y! < 0 || width! < 1 || height! < 1) throw new Error(`Invalid graphic ${id}`);
      graphics.set(id, { file: file!, x: x!, y: y!, width: width!, height: height! });
    } else {
      if (values.length !== count! + 2 || values.at(-1)! <= 0) throw new Error(`Invalid animation ${id}`);
      graphics.set(id, { ids: values.slice(1, -1), duration: values.at(-1)! });
    }
  }
  if (!graphics.size) throw new Error('Empty graphics index');
  return graphics;
}

export function graphicAnimation(index: GraphicIndex, id: number): Animation {
  const grh = index.get(id);
  if (!grh) throw new Error(`Missing graphic ${id}`);
  if ('file' in grh) return { frames: [grh], frameMs: 1000 };
  return {
    frames: grh.ids.map(frame => {
      const item = index.get(frame);
      if (!item || !('file' in item)) throw new Error(`Missing/static frame required: ${frame} in graphic ${id}`);
      return item;
    }),
    frameMs: grh.duration / grh.ids.length,
  };
}

export function parseHeads(bytes: Uint8Array): number[][] {
  const r = new Cursor(bytes);
  r.take(263); // fixed ANSI string(255), CRC:i32, MagicWord:i32
  const count = r.i16();
  if (count < 1 || count > 10_000) throw new Error('Invalid head count');
  const heads: number[][] = [[]];
  for (let i = 0; i < count; i++) heads.push([r.i32(), r.i32(), r.i32(), r.i32()]);
  if (r.offset !== bytes.length) throw new Error('Unexpected head index trailer');
  return heads;
}

export interface Body { walk: Animation[]; bodyX: number; bodyY: number; headX: number; headY: number }
export function readBody(bodies: Ini, molds: Ini, graphics: GraphicIndex, id: number): Body {
  const section = bodies.get(`body${id}`);
  if (!section) throw new Error(`Missing body ${id}`);
  // Some bodies (the ghost, 829) carry a trailing VB comment: "Walk1=51672 ' arriba".
  const value = (key: string) => Number((section.get(key) ?? '0').split("'")[0]);
  const bodyX = value('bodyoffsetx'), bodyY = value('bodyoffsety');
  let walk: Animation[];
  if (value('std') === 0) {
    walk = [1, 2, 3, 4].map(h => graphicAnimation(graphics, value(`walk${h}`)));
  } else {
    const mold = molds.get(`molde${value('std')}`);
    if (!mold) throw new Error(`Missing template for body ${id}`);
    const m = (key: string) => Number(mold.get(key) ?? 0);
    const rows = [3, 1, 4, 2]; // body sheet order: South, North, West, East
    walk = [];
    rows.forEach((heading, row) => {
      const frames = m(`dir${row + 1}`);
      if (!Number.isInteger(frames) || frames < 1 || frames > 256 || m('width') < 1 || m('height') < 1) throw new Error(`Invalid template for body ${id}`);
      walk[heading - 1] = {
        frameMs: 1 / (value('speed') || 1) / 0.018,
        frames: Array.from({ length: frames }, (_, frame) => ({
          file: value('filenum'), x: m('x') + frame * m('width'), y: m('y') + row * m('height'),
          width: m('width'), height: m('height'),
        })),
      };
    });
  }
  return { walk, bodyX, bodyY, headX: value('headoffsetx') + bodyX, headY: value('headoffsety') + bodyY };
}

export async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`/ao-assets/${path}`);
  if (!response.ok) throw new Error(`Local asset unavailable: ${path} (${response.status}). Set AO_ASSETS to your Recursos directory.`);
  return new Uint8Array(await response.arrayBuffer());
}
export async function fetchText(path: string): Promise<string> {
  return new TextDecoder('windows-1252').decode(await fetchBytes(path));
}
