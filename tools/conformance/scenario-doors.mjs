// Doors scenario: walk next to the plain door at (72,35) of map 1 and toggle it with LeftClick(x, y, counter).
// Server rule (HandleLeftClick): the world action is SKIPPED when any character, the player included, stands on (x,y) or (x,y+1).
import { makeWalker } from './helpers.mjs';
export default async function run(rec) {
  const w = makeWalker(rec);
  console.log('at (72,36)?', await w.goto([72, 36]));
  rec.mark = rec.records.length;
  await w.click(72, 35);          // player stands on (x,y+1) = (72,36): the server only looks
  await w.click(71, 35);          // (x+1,y) is the door and nobody is on (71,35)/(71,36): the door toggles
  rec.send(96, [71, 35]); await rec.sleep(500); // DoubleClick: read and ignored
  console.log('walk north', await w.step(1), await w.step(1));
  await w.step(3); await w.step(3);
  await w.click(71, 35);
  rec.send(79); await rec.sleep(500);
}
