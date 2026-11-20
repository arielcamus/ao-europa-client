// Finanzas (bank) of Ullathorpe, west door (77,55) (obj 1424 closed / 1423 open), interior tiles carry trigger 29 (EMPEROR_CASTLE_ENTRY_9).
// Walk to (77,57), open the door if it is closed, step north into the doorway. The door is left open, as other players leave it.
import { makeWalker, doorState } from './helpers.mjs';
export default async function run(rec) {
  const w = makeWalker(rec); console.log('at (77,57)?', await w.goto([77, 57]));
  const state = doorState(rec, 77, 55); console.log('door (77,55) at login: obj', state);
  rec.mark = rec.records.length;
  if (state === 1424) { await w.click(77, 55); await rec.sleep(800); }
  console.log('north x4', await w.step(1), await w.step(1), await w.step(1), await w.step(1)); rec.send(79); await rec.sleep(500);
}
