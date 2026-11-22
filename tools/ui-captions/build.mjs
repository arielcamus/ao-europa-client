// AGPL-3.0-or-later. Builds apps/web/src/ui-captions-data.ts: the captions baked into the interface bitmaps, from macOS Vision text recognition.
// macOS only (the recognizer is Vision); the output is committed and every entry was checked by eye against its bitmap.
//   swiftc -O tools/ui-captions/ocr.swift -o /tmp/ao-ocr
//   AO_ASSETS=~/Projects/ao-reference/Recursos-prehoo OCR=/tmp/ao-ocr node tools/ui-captions/build.mjs
// Each bitmap is upscaled 3x (sips) for recognition; boxes come back in bitmap pixels. CORRECTIONS fixes recognizer misreads (checked against
// the bitmap), DROP removes symbols and icons it read as letters, SKIP keeps whole bitmaps untouched (map art, signboards, launcher art).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const assets = process.env.AO_ASSETS, ocr = process.env.OCR;
if (!assets || !ocr) throw new Error('Set AO_ASSETS and OCR (see the header)');
const dir = path.join(assets, 'interface');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-captions-'));
const SKIP = /^(mapa2|mapa_referencias|referencias|VentanaMapa|patchnotes-.*|ventanalauncher|VentanaCargando|ventanatiendaao20|board|spanish-.*|VentanaEstadisticas|alquimia|global|globalapretado|info|infoapretado|ventanaprincipal|boton-jugar|boton-crear-personaje|ventanallavero|boton-cancelar)$/i;
// global / info: 6 px labels on 37x12 chat buttons, left as drawn.
// Written by hand: the recognizer reads the gear and "?" icons of ventanaprincipal as digits, and the two bilingual buttons (boton-jugar,
// boton-crear-personaje: Spanish | English) need one box per word.
const MANUAL = {
  'boton-jugar': [{ text: 'JUGAR', box: [27, 9, 57, 22] }],
  ventanallavero: [{ text: 'LLAVERO', box: [90, 19, 86, 22] }],
  'boton-crear-personaje': [{ text: 'CREAR', box: [16, 11, 54, 20] }, { text: 'CREATE', box: [80, 11, 64, 20] }],
  // sips cannot read es_boton-cancelar-*.bmp, so the recognizer never saw it (#113); box from ao-ocr on a 3x PNG of the default state.
  'boton-cancelar': [{ text: 'CANCELAR', box: [33, 6, 66, 14] }],
  ventanaprincipal: [
    { text: 'AJUSTES', box: [777, 7, 47, 17] }, { text: 'MANUAL', box: [846, 7, 49, 17] }, { text: 'MAO', box: [920, 7, 40, 17] },
    { text: 'INVENTARIO', box: [784, 166, 84, 16] }, { text: 'HECHIZOS', box: [912, 166, 76, 16] },
    { text: 'STATS', box: [796, 528, 52, 16] }, { text: 'MENU', box: [924, 528, 50, 16] },
  ],
};
const CORRECTIONS = {
  'itetn': 'item', 'deberi': 'deberá', 'mensje': 'mensaje', 'tal formulado': 'mal formulado', 'Dohle': 'Doble', 'infortnación': 'información', 'FA BRICAR': 'FABRICAR', ',LLAVERO': 'LLAVERO',
  'comectado': 'conectado', 'almnacenado': 'almacenado', 'fortnulado': 'formulado', 'climinado': 'eliminado',
};
const DROP = text => !/\p{L}{2}/u.test(text);
// Lines left as drawn: italic paragraphs and the coloured quest legend (its letters sit on icons).
const DROP_LINES = { ventanaclanes_solicitud_ingreso: /^(?!ENVIAR SOLICITUD$)/, ventananuevamision: /^(!|X |V |\* |Disponible$)/ };
// Windows whose mixed-case labels are a serif (Georgia) rather than the option rows' sans (Tahoma).
const BOOK = new Set(['cantidad', 'sastreria', 'ventanaalquimia', 'ventanacarpinteria', 'ventanaherreria', 'ventanabanco-depositar', 'ventanabanco-retirar',
  'ventanabanco-transferir', 'ventanacambiarcontrasena', 'ventanagrupo', 'ventanaretos', 'ventanagm', 'ventanaclanes', 'ventanaadminclan']);
const STATE = /-(default|over|off|on|pressed)$/;

function bmp(file) {
  const b = fs.readFileSync(file), v = new DataView(b.buffer, b.byteOffset);
  const off = v.getUint32(10, true), w = v.getInt32(18, true), h0 = v.getInt32(22, true), bits = v.getUint16(28, true), h = Math.abs(h0);
  const stride = Math.ceil(w * bits / 8 / 4) * 4, lum = new Float32Array(w * h);
  let pal; if (bits <= 8) { pal = []; const n = v.getUint32(46, true) || (1 << bits); for (let i = 0; i < n; i++) { const o = 14 + v.getUint32(14, true) + i * 4; pal.push([b[o + 2], b[o + 1], b[o]]); } }
  for (let y = 0; y < h; y++) { const row = h0 > 0 ? h - 1 - y : y; for (let x = 0; x < w; x++) {
    let c; if (bits === 8) c = pal[b[off + row * stride + x]]; else { const i = off + row * stride + x * bits / 8; c = [b[i + 2], b[i + 1], b[i]]; }
    lum[y * w + x] = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  } }
  return { w, h, lum };
}

const files = fs.readdirSync(dir).filter(f => /\.bmp$/i.test(f) && !/^(en|fr|it|pt)_/.test(f));
const bases = new Map();
for (const f of files) {
  const name = f.replace(/\.bmp$/i, '').replace(/^es_/, ''), base = name.replace(STATE, '');
  if (SKIP.test(base)) continue;
  const rank = ['-default', '', '-on', '-off', '-over'].indexOf(name.slice(base.length));
  const prev = bases.get(base);
  if (!prev || rank < prev.rank) bases.set(base, { file: f, rank });
}
const out = { ...MANUAL };
for (const [base, { file }] of [...bases].sort()) {
  if (out[base]) continue;
  const png = path.join(work, 'a.png'), big = path.join(work, 'b.png');
  // Many true-colour BMPs declare "important colors" in the header, which sips refuses (it skipped boton-lanzar, boton-ingresar, boton-volver...
  // silently, so their captions stayed bitmap text: Ariel, 22 Nov, "Lanzar"). Same fix as interface-assets.ts normalizeTrueColorBmp: zero the
  // palette metadata in a scratch copy; the pixels are untouched.
  const source = path.join(work, 'src.bmp'), raw = fs.readFileSync(path.join(dir, file));
  if (raw.length > 54 && raw.readUInt16LE(28) >= 24) { raw.writeUInt32LE(0, 46); raw.writeUInt32LE(0, 50); }
  fs.writeFileSync(source, raw);
  try { execFileSync('sips', ['-s', 'format', 'png', source, '--out', png], { stdio: 'ignore' }); } catch { console.warn('sips cannot read', file); continue; }
  const image = bmp(path.join(dir, file));
  execFileSync('sips', ['-z', String(image.h * 3), String(image.w * 3), png, '--out', big], { stdio: 'ignore' });
  const lines = execFileSync(ocr, [big], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const specs = [];
  for (const line of lines) {
    const [geometry, raw] = line.split('\t');
    let text = raw.trim();
    for (const [wrong, right] of Object.entries(CORRECTIONS)) text = text.replaceAll(wrong, right);
    if (DROP(text) || DROP_LINES[base]?.test(text)) continue;
    const [x, y, w, h] = geometry.split(' ').map(Number).map(v => v / 3);
    const box = [Math.max(0, Math.floor(x) - 1), Math.max(0, Math.floor(y) - 2), Math.ceil(w) + 2, Math.ceil(h) + 4];
    // Dark letters on a light ground: the box is darker on average than its median.
    const values = [];
    for (let yy = box[1]; yy < Math.min(image.h, box[1] + box[3]); yy++) for (let xx = box[0]; xx < Math.min(image.w, box[0] + box[2]); xx++) values.push(image.lum[yy * image.w + xx]);
    const mean = values.reduce((s, v) => s + v, 0) / values.length, median = values.sort((a, b) => a - b)[values.length >> 1];
    const spec = { text, box };
    if (/\p{Ll}/u.test(text)) spec.font = BOOK.has(base) ? 'book' : 'sans';
    if (mean < median - 3) spec.dark = true;
    specs.push(spec);
  }
  // Lines of a paragraph sit closer than the padding: split overlapping boxes halfway so no box reaches into the next line.
  for (const a of specs) for (const b of specs) {
    if (a === b || a.box[1] >= b.box[1]) continue;
    const overlapX = Math.min(a.box[0] + a.box[2], b.box[0] + b.box[2]) - Math.max(a.box[0], b.box[0]);
    const bottom = a.box[1] + a.box[3];
    if (overlapX > 0 && bottom > b.box[1]) {
      const cut = Math.round((bottom + b.box[1]) / 2);
      a.box[3] = cut - a.box[1]; b.box[3] -= cut - b.box[1]; b.box[1] = cut;
    }
  }
  if (specs.length) out[base] = specs;
}
const body = Object.entries(out).map(([base, specs]) => `  ${JSON.stringify(base)}: [\n${specs.map(s => `    ${JSON.stringify(s).replace(/"(text|box|font|dark)":/g, '$1: ')},`).join('\n')}\n  ],`).join('\n');
fs.writeFileSync(new URL('../../apps/web/src/ui-captions-data.ts', import.meta.url), `/*
 * The captions baked into the interface bitmaps (Recursos interface/es_*.bmp), redrawn as live text by ui-captions.ts.
 * AGPL-3.0-or-later; see NOTICE. Generated by tools/ui-captions/build.mjs (macOS Vision text recognition, corrections checked by eye against
 * each bitmap); e2e/ui-captions.spec.ts checks every entry against the original letters. Boxes are bitmap pixels; keys drop es_ and the state.
 */
import type { CaptionSpec } from './caption-erase.js';

export const CAPTIONS: Record<string, readonly CaptionSpec[]> = {
${body}
};
`);
console.log(Object.keys(out).length, 'bitmaps,', Object.values(out).reduce((s, v) => s + v.length, 0), 'captions');
