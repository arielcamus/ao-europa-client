// Carpintería of Ullathorpe (Halving <Carpintero> at (64,74)), door obj 2334/2333 at (65,79), interior tiles carry trigger 32 (EMPEROR_CASTLE_ENTRY_12).
// Walk to (65,81) (two tiles south: the server skips a click when the player stands on (x,y+1)), open the door if it is closed, step north into the doorway.
import { makeWalker, doorState } from './helpers.mjs';
export default async function run(rec) {
  const w = makeWalker(rec); console.log('at (65,81)?', await w.goto([65, 81]));
  const state = doorState(rec, 65, 79); console.log('door (65,79) at login: obj', state);
  rec.mark = rec.records.length;
  if (state === 2334) { await w.click(65, 79); await rec.sleep(800); }
  console.log('north x4', await w.step(1), await w.step(1), await w.step(1), await w.step(1)); rec.send(79); await rec.sleep(500);
}
