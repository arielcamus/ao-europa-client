// Audio scenario: walk a few tiles, hit the training dummy at (60,37) of map 1 (the server answers with PlayWave and CharSwing),
// then open and close the plain door at (71,35) (LeftClick). Everything the server says in PlayWave (55) is what the client plays.
import { makeWalker } from './helpers.mjs';
import { i32 } from './wire.mjs';
export default async function run(rec) {
  const w = makeWalker(rec);
  console.log('at (61,37)?', await w.goto([61, 37]));
  console.log('face the dummy', await w.step(4)); // west into (60,37): blocked, the server only turns us
  for (let n = 1; n <= 6; n++) { rec.send(80, [...i32(n)]); await rec.sleep(1300); } // Attack, counter from 1, paced like Intervals.hit
  console.log('at (72,36)?', await w.goto([72, 36]));
  await w.click(71, 35); // opens the door
  await w.click(71, 35); // closes it
  rec.send(79); await rec.sleep(500);
}
