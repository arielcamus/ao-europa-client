/*
 * Adapted from Argentum 20 client CODIGO/Recursos.bas: LoadGrhData, LoadGrhIni;
 * TileEngine.bas: InitGrh; TileEngine_Map.bas: Draw_Grh.
 * Copyright (C) 2022 Noland Studios. GNU AGPL version 3 or any later version.
 * WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See ../../../LICENSE and ../../../NOTICE.
 */
import { BinaryReader, FormatError } from './binary.js';

export interface GraphicFrame { file: number; x: number; y: number; width: number; height: number }
export type Grh = { kind: 'frame'; frame: GraphicFrame } |
  { kind: 'animation'; frames: number[]; durationMs: number };
export interface GraphicsIndex { version: number; maxId: number; entries: Map<number, Grh>; unresolvedAnimations: number[] }

/** Active classic client uses graficos.ini; graficos.ind remains a supported older format. */
export function parseGraphicsIni(text: string): GraphicsIndex {
  const maxId = Number(/^NumGrh\s*=\s*(\d+)/im.exec(text)?.[1]);
  if (!Number.isInteger(maxId) || maxId < 1 || maxId > 1_000_000) throw new FormatError('Invalid NumGrh');
  const index: GraphicsIndex = {
    version: Number(/^Version\s*=\s*([\d.]+)/im.exec(text)?.[1] ?? 0), maxId,
    entries: new Map(), unresolvedAnimations: [],
  };
  for (const line of text.split(/\r?\n/)) {
    const match = /^Grh(\d+)\s*=\s*(.+)/i.exec(line);
    if (!match) continue;
    const id = Number(match[1]), fields = match[2]!.split('-').map(field => Number.parseFloat(field));
    const count = fields[0]!;
    if (id < 1 || id > maxId || !Number.isInteger(count) || count < 1 || count > 4096) throw new FormatError(`Invalid GRH ${id}`);
    if (count === 1) {
      // Like LoadGrhIni, consume the six static fields; old unused entries can
      // have surplus fields and repeated IDs (last definition wins).
      const [file, x, y, width, height] = fields.slice(1, 6) as [number, number, number, number, number];
      if (fields.length < 6 || ![file, x, y, width, height].every(Number.isInteger) || file < 1 || x < 0 || y < 0 || width < 1 || height < 1) {
        throw new FormatError(`Invalid GRH frame ${id}`);
      }
      index.entries.set(id, { kind: 'frame', frame: { file, x, y, width, height } });
    } else {
      const frames = fields.slice(1, count + 1), durationMs = fields[count + 1]!;
      if (frames.length !== count || frames.some(frame => !Number.isInteger(frame) || frame < 1 || frame > maxId) || !Number.isFinite(durationMs) || durationMs <= 0) {
        throw new FormatError(`Invalid GRH animation ${id}`);
      }
      index.entries.set(id, { kind: 'animation', frames, durationMs });
    }
  }
  for (const [id, grh] of index.entries) {
    if (grh.kind === 'animation' && grh.frames.some(frame => index.entries.get(frame)?.kind !== 'frame')) index.unresolvedAnimations.push(id);
  }
  return index;
}

export function parseGraphics(bytes: Uint8Array): GraphicsIndex {
  const r = new BinaryReader(bytes);
  const index: GraphicsIndex = { version: r.i32(), maxId: r.count(1_000_000), entries: new Map(), unresolvedAnimations: [] };
  while (r.remaining) {
    const id = r.i32(), count = r.i16();
    if (id < 1 || id > index.maxId || index.entries.has(id) || count < 1 || count > 4096) {
      throw new FormatError(`Invalid GRH id/frames ${id}/${count}`);
    }
    if (count === 1) {
      const frame = { file: r.i32(), x: r.i16(), y: r.i16(), width: r.i16(), height: r.i16() };
      if (frame.file < 1 || frame.x < 0 || frame.y < 0 || frame.width < 1 || frame.height < 1) {
        throw new FormatError(`Invalid GRH frame ${id}`);
      }
      index.entries.set(id, { kind: 'frame', frame });
    } else {
      const frames = Array.from({ length: count }, () => r.i32()), durationMs = r.f32();
      if (frames.some(frame => frame < 1 || frame > index.maxId)) throw new FormatError(`Animation ${id} has missing/out-of-range frames`);
      if (!Number.isFinite(durationMs) || durationMs <= 0) throw new FormatError(`Invalid GRH speed ${id}`);
      index.entries.set(id, { kind: 'animation', frames, durationMs });
    }
  }
  // The installed index contains unused dangling/nested animations. Preserve them
  // for diagnostics; reject on resolution rather than preventing every map loading.
  for (const [id, grh] of index.entries) {
    if (grh.kind === 'animation' && grh.frames.some(frame => index.entries.get(frame)?.kind !== 'frame')) {
      index.unresolvedAnimations.push(id);
    }
  }
  return index;
}
export function grhFrame(index: GraphicsIndex, id: number, elapsedMs = 0): GraphicFrame {
  const grh = index.entries.get(id);
  if (!grh) throw new FormatError(`Missing GRH ${id}`);
  if (grh.kind === 'frame') return grh.frame;
  const frame = Math.floor(Math.max(0, elapsedMs) % grh.durationMs / grh.durationMs * grh.frames.length);
  const resolved = index.entries.get(grh.frames[frame]!);
  if (resolved?.kind !== 'frame') throw new FormatError(`Animation ${id} refers to a missing/non-static frame`);
  return resolved.frame;
}
/** The centered VB6 draw anchors art at the bottom/center of its 32px tile. */
export function graphicOffset(frame: GraphicFrame): { x: number; y: number } {
  return { x: 16 - Math.floor(frame.width / 2), y: 32 - frame.height };
}
