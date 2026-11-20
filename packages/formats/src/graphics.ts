/*
 * Adapted from Argentum 20 client CODIGO/Recursos.bas: LoadGrhData;
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
