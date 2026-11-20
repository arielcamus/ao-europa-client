// Walk-to scenario: BFS over the CSM blocked flags to AO_TARGET="x,y" on map 1, learning the server's rejections.
import { makeWalker } from './helpers.mjs';
export default async function run(rec) {
  const [tx, ty] = (process.env.AO_TARGET ?? '57,45').split(',').map(Number);
  const w = makeWalker(rec); const ok = await w.goto([tx, ty]);
  console.log('target', [tx, ty], 'reached', ok, 'final', w.pos);
  rec.send(79); await rec.sleep(800);
}
