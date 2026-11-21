import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMap } from '../src/assets.js';

// Every map of the local resource tree must parse without error and with a ground layer. The pre-HOO pin (client-classic 619e69d, Recursos-prehoo)
// ships LEGACY four-layer .csm files with no signature; the HOO-era loader added the signed five-layer format (W5L2) and keeps the
// legacy path, which parseMap mirrors (Recursos.ReadCsmHeader inserts an empty third layer). Runs when AO_ASSETS points at a tree.
const root = process.env.AO_ASSETS;
const dir = root ? `${root}/Mapas` : '';
const maps = root && existsSync(dir) ? readdirSync(dir).filter(f => /^mapa\d+\.csm$/.test(f)) : [];

describe.skipIf(maps.length === 0)('maps in AO_ASSETS', () => {
  it('parse (legacy four-layer or signed five-layer), with the trees and roofs where the renderer reads them', () => {
    let legacy = 0, five = 0, empty = 0;
    for (const file of maps) {
      const bytes = new Uint8Array(readFileSync(`${dir}/${file}`));
      if (statSync(`${dir}/${file}`).size < 100) { empty++; continue; } // a placeholder map with no header
      const map = parseMap(bytes);
      expect(map.layers[0]!.filter(Boolean).length, `${file}: ground layer`).toBeGreaterThan(0);
      expect(map.trailingBytes, file).toBeLessThan(bytes.length); // the NPC and tile-exit sections are left unread
      if (new DataView(bytes.buffer).getInt32(0, true) === 0x324c3557) five++; else {
        legacy++;
        expect(map.layers[2]!.some(Boolean), `${file}: legacy files have no third layer`).toBe(false);
      }
    }
    console.log(`maps parsed from ${root}: legacy=${legacy} five-layer=${five} placeholder=${empty}`);
    expect(legacy + five).toBeGreaterThan(400);
  });
});
