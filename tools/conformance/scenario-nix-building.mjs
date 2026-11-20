// Ciudad de Nix (map 34): ordinary building x37-44,y42-47 whose interior carries trigger 24 (EMPEROR_CASTLE_ENTRY_4), door obj 2336/2335 at (43,47).
// Needs the character placed at (43,50) on map 34 (saved position in the server DB, docs/DATA-PATCHES.md). Open the door if closed, walk north into the building.
import { makeWalker, mapBlocked, doorState } from './helpers.mjs';
export default async function run(rec) {
  const w = makeWalker(rec, mapBlocked(34)); console.log('at (43,49)?', await w.goto([43, 49]));
  const state = doorState(rec, 43, 47); console.log('door (43,47) at login: obj', state);
  rec.mark = rec.records.length;
  if (state === 2336) { await w.click(43, 47); await rec.sleep(800); }
  console.log('north x4', await w.step(1), await w.step(1), await w.step(1), await w.step(1)); rec.send(79); await rec.sleep(500);
}
