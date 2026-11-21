import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGraphics, parseHeads } from '../src/assets.js';
import { headsFor } from '../src/connect-text.js';

// Every head the character-creation picker offers must resolve to a graphic. Runs against the local pre-HOO art when AO_ASSETS is set.
const root = process.env.AO_ASSETS;
describe.skipIf(!root || !existsSync(join(root, 'init/cabezas.ind')))('character creation heads resolve to art', () => {
  it('every offered head has a south-facing Grh that exists in graficos.ind', () => {
    const heads = parseHeads(new Uint8Array(readFileSync(join(root!, 'init/cabezas.ind'))));
    const graphics = parseGraphics(readFileSync(join(root!, 'init/graficos.ini'), 'latin1'));
    const drawable = (head: number) => { const grh = heads[head]?.[2]; return !!grh && graphics.has(grh); };
    for (let race = 0; race < 6; race++) for (let gender = 0; gender < 2; gender++) {
      const offered = headsFor(race, gender, drawable);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.filter(h => !drawable(h)), `race ${race} gender ${gender}`).toEqual([]);
    }
  });
});
