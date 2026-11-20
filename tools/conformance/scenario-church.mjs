// Church (Templo) of Ullathorpe: walk to the doorway row (78,74) and step north into the interior (trigger 20, ONLY_PATREON_TILE).
import { makeWalker } from './helpers.mjs';
export default async function run(rec) {
  const w = makeWalker(rec); console.log('at (78,74)?', await w.goto([78, 74]));
  rec.mark = rec.records.length;
  console.log('north x3', await w.step(1), await w.step(1), await w.step(1)); rec.send(79); await rec.sleep(500);
}
