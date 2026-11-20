// World FX: log in on Ullathorpe, idle for the time, weather and light packets the server sends on entry, then cross the x=36
// area border (AREA_DIM 12) east and back so the server sends AreaChanged.
import { makeWalker } from './helpers.mjs';
export default async function run(rec) {
  await rec.sleep(6000);
  const w = makeWalker(rec);
  for (const heading of [2, 2, 2, 2, 4, 4, 4, 4]) { console.log('step', heading, await w.step(heading)); await rec.sleep(150); }
  rec.send(79); await rec.sleep(1500);
}
