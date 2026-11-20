// Finanzas (bank) of Ullathorpe: walk to the south gate row (77,57) and step north into (77,56)/(77,55), where the closed doors block.
import { makeWalker } from './helpers.mjs';
export default async function run(rec) {
  const w = makeWalker(rec); console.log('at (77,57)?', await w.goto([77, 57]));
  rec.mark = rec.records.length;
  console.log('north x3', await w.step(1), await w.step(1), await w.step(1)); rec.send(79); await rec.sleep(500);
}
