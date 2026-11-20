/*
 * Adapted from Argentum 20 client CODIGO/Recursos.bas: CargarMoldes,
 * CargarCuerpos, CargarCabezas; GameIni.bas tCabecera; Declares.bas tIndiceCabeza.
 * Copyright (C) 2022 Noland Studios. GNU AGPL version 3 or any later version.
 * WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See ../../../LICENSE and ../../../NOTICE.
 */
import { BinaryReader, FormatError } from './binary.js';
import { grhFrame } from './graphics.js';
import type { GraphicFrame, GraphicsIndex } from './graphics.js';

export type Ini = Map<string, Map<string, string>>;
export function parseIni(text: string): Ini {
  const sections: Ini = new Map();
  let current = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).toLowerCase();
      current = sections.get(name) ?? new Map();
      sections.set(name, current);
    } else if (line && !line.startsWith(';') && !line.startsWith('#')) {
      const equals = line.indexOf('=');
      if (equals > 0) current.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1).trim());
    }
  }
  return sections;
}
function value(section: Map<string, string>, key: string, fallback = 0): number {
  const raw = section.get(key);
  const result = raw === undefined ? fallback : Number.parseFloat(raw);
  if (!Number.isFinite(result)) throw new FormatError(`Invalid INI number ${key}=${raw}`);
  return result;
}
export interface Body {
  /** Heading order: north, east, south, west. */
  directions: { frames: GraphicFrame[]; durationMs: number }[];
  offset: { x: number; y: number };
  headOffset: { x: number; y: number };
}
/** Resolve only the requested body. No need to expand thousands of unused templates. */
export function bodyFromIni(bodies: Ini, molds: Ini, index: GraphicsIndex, id: number): Body {
  const section = bodies.get(`body${id}`);
  if (!section) throw new FormatError(`Missing body ${id}`);
  const offset = { x: value(section, 'bodyoffsetx'), y: value(section, 'bodyoffsety') };
  const body: Body = {
    directions: [], offset,
    headOffset: { x: offset.x + value(section, 'headoffsetx'), y: offset.y + value(section, 'headoffsety') },
  };
  const std = value(section, 'std');
  if (!std) {
    for (let heading = 1; heading <= 4; heading++) {
      const id = value(section, `walk${heading}`), grh = index.entries.get(id);
      if (!grh) throw new FormatError(`Missing body walk ${id}`);
      body.directions.push(grh.kind === 'frame' ? { frames: [grh.frame], durationMs: 1 } :
        { frames: grh.frames.map(frame => grhFrame(index, frame)), durationMs: grh.durationMs });
    }
  } else {
    const mold = molds.get(`molde${std}`);
    if (!mold) throw new FormatError(`Missing body template ${std}`);
    const width = value(mold, 'width'), height = value(mold, 'height');
    const file = value(section, 'filenum'), speed = value(section, 'speed') || 1;
    if (width <= 0 || height <= 0 || file <= 0 || speed <= 0) throw new FormatError('Invalid body template');
    // Template rows are SOUTH, NORTH, WEST, EAST, not protocol heading order.
    for (const [row, heading] of [3, 1, 4, 2].entries()) {
      const count = value(mold, `dir${row + 1}`);
      if (!Number.isInteger(count) || count < 1 || count > 255) throw new FormatError('Empty body direction');
      body.directions[heading - 1] = {
        durationMs: count / speed / 0.018,
        frames: Array.from({ length: count }, (_, frame) => ({
          file, x: value(mold, 'x') + frame * width, y: value(mold, 'y') + row * height, width, height,
        })),
      };
    }
  }
  return body;
}
export function parseHeads(bytes: Uint8Array): number[][] {
  const r = new BinaryReader(bytes);
  r.skip(255 + 4 + 4); // fixed ANSI description, CRC, MagicWord
  const count = r.u16();
  if (count > 10_000) throw new FormatError('Invalid head count');
  const heads = [[], ...Array.from({ length: count }, () => [r.i32(), r.i32(), r.i32(), r.i32()])];
  r.end();
  return heads;
}
