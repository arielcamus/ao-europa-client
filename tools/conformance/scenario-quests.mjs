// Quests on map 1 (Ullathorpe) with a level-1 warrior: the empty quest log, an NPC offer the character cannot take (Seraphia, quest 2,
// level 6 + class Trabajador), Makrom's level-1 offer (quest 407, "Una nueva aventura"): accept, the quest log with its progress,
// abandon. AO_QUEST_STEP selects the part: list | seraphia | makrom (default makrom). QuestAccept and the other quest ids are 259..262.
import { makeWalker } from './helpers.mjs';
const Q = { quest: 258, accept: 259, list: 260, details: 261, abandon: 262 };
// Two tiles away is enough: the server accepts a quest NPC within distance 5.
const near = (x, y) => [[x - 2, y], [x + 2, y], [x, y + 2], [x, y - 2], [x - 3, y], [x + 3, y]];
async function approach(w, rec, x, y) {
  for (const [tx, ty] of near(x, y)) { if (await w.goto([tx, ty])) { console.log('at', [tx, ty], 'next to', [x, y]); return true; } }
  return false;
}
export default async function run(rec) {
  const step = process.env.AO_QUEST_STEP ?? 'makrom';
  const w = makeWalker(rec);
  if (step === 'abandon') { rec.send(Q.abandon, [1]); await rec.sleep(1500); return; }   // clean-up: drop whatever sits in slot 1
  if (step === 'list') {
    rec.mark = rec.records.length; rec.send(Q.list); await rec.sleep(1200);
    rec.send(Q.details, [1]); await rec.sleep(1200);   // no quest in slot 1: the server ignores it
    return;
  }
  const [nx, ny] = step === 'seraphia' ? [77, 32] : (process.env.AO_NPC ?? '54,56').split(',').map(Number);
  console.log('approach', await approach(w, rec, nx, ny));
  rec.mark = rec.records.length;
  await w.click(nx, ny);
  await rec.sleep(800);
  if (step === 'makrom') {
    rec.send(Q.accept, [1]); await rec.sleep(1500);          // first offered quest
    rec.send(Q.list); await rec.sleep(1200);                 // quest log: one quest
    rec.send(Q.details, [1]); await rec.sleep(1200);         // its progress
    rec.send(Q.abandon, [1]); await rec.sleep(1500);         // abandon: console line + a fresh (empty) list
  }
}
