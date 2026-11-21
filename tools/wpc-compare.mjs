// AGPL-3.0-or-later. Before/after comparison for WP-C: node tools/wpc-compare.mjs <before.png> <after.png> <out.png> [x,y,w,h crop in image px] [zoom]
// Prints the number of differing pixels (and their bounding box) and writes before | after | diff side by side, cropped and zoomed.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [before, after, out, cropArg, zoomArg] = process.argv.slice(2);
const uri = f => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();
const result = await page.evaluate(async ([a, b, crop, zoom]) => {
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = ia.width, h = ia.height, read = i => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, w, h); };
  const da = read(ia), db = read(ib);
  let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; const diff = new ImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const d = Math.abs(da.data[p * 4] - db.data[p * 4]) + Math.abs(da.data[p * 4 + 1] - db.data[p * 4 + 1]) + Math.abs(da.data[p * 4 + 2] - db.data[p * 4 + 2]);
    if (d > 12) { n++; const x = p % w, y = (p / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); diff.data.set([255, 0, 255, 255], p * 4); } else diff.data.set([da.data[p * 4] >> 2, da.data[p * 4 + 1] >> 2, da.data[p * 4 + 2] >> 2, 255], p * 4);
  }
  const [cx, cy, cw, ch] = crop ? crop.split(',').map(Number) : [0, 0, w, h], z = Number(zoom || 1);
  const c = document.createElement('canvas'); c.width = cw * z * 3 + 8; c.height = ch * z; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const dc = document.createElement('canvas'); dc.width = w; dc.height = h; dc.getContext('2d').putImageData(diff, 0, 0);
  [ia, ib, dc].forEach((s, i) => x.drawImage(s, cx, cy, cw, ch, i * (cw * z + 4), 0, cw * z, ch * z));
  return { differing: n, bbox: n ? [x0, y0, x1, y1] : null, png: c.toDataURL('image/png') };
}, [uri(before), uri(after), cropArg ?? '', zoomArg ?? '1']);
import('node:fs').then(fs => fs.writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64')));
console.log(JSON.stringify({ differing: result.differing, bbox: result.bbox }));
await browser.close();
