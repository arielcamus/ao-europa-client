// Records the #35 / #38 follow-ups against the VB6 server (21 Nov 2026):
//  - quests/obj-quest-item.jsonl: UseItem on a quest object (Obj 3305 "Nota de Rescate", QuestId 123) -> ObjQuestListSend (S174).
//  - crafting/mine-flag-then-walk.jsonl: pickaxe extraction, FlagTrabajar (extraction continues), then one accepted step (it stops).
//  - crafting/alchemy-tailor-open.jsonl: Olla / Costurero -> AlquimiaObj + ShowAlquimiaForm, SastreObj + ShowSastreForm, CraftSastre 0.
// Usage: AO_EMAIL=... AO_PASSWORD=... [AO_ONLY=quest|work] node tools/real-server/crafting-quest-record.mjs   (pnpm --filter @ao/protocol build first)
// The character (a Trabajador: the pickaxe is class-restricted) holds Olla 887 (slot 16), Costurero 886 (17), Piquete 187 (18),
// Nota 3305 (19) and Ropaje Invernal 2807 (20, pass AO_DRESS_SLOT=20), standing at map 50 (67,63) next to the deposit at (68,63).
// The quest part wants level 16 (quest 123). The work part needs a dressed character: an undressed one (a newbie armour past level 12
// counts as none) loses stamina every few seconds and the extraction stops on 'Estás muy cansado'. AGPL-3.0-or-later.
import { Vb6Session, C, IC, sleep } from './items-session.mjs';
import { CraftingClientPacketId as CC, CraftingServerPacketId as CS, QuestServerPacketId as QS } from '../../packages/protocol/dist/index.js';

const fixtures = new URL('../../tests/fixtures/vb6/', import.meta.url).pathname;
const need = key => process.env[key] ?? (() => { throw new Error(`Set ${key}`); })();
const s = new Vb6Session({ email: need('AO_EMAIL'), password: need('AO_PASSWORD') });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 180000);
const names = new Map([[CC.StartAutomatedAction, 'StartAutomatedAction'], [CC.FlagTrabajar, 'FlagTrabajar'], [CC.CraftSastre, 'CraftSastre'], [CC.CraftAlquimista, 'CraftAlquimista']]);
const serverNames = new Map([...Object.entries(CS), ...Object.entries(QS)].map(([k, v]) => [v, k]));
const save = (file, from) => {
  for (const r of s.records.slice(from)) {
    if (r.dir === 'c2s' && names.has(r.id)) r.name = names.get(r.id);
    if (r.dir === 's2c' && r.name.startsWith('Unknown') && serverNames.has(r.id)) r.name = serverNames.get(r.id);
  }
  s.save(`${fixtures}${file}`, from); console.log(file, s.records.length - from, 'frames');
};
const count = (from, id) => s.records.slice(from).filter(r => r.dir === 's2c' && r.id === id).length;

await s.login();
console.log('logged in at', s.map, s.pos);
const only = process.env.AO_ONLY ?? 'all';
let from = s.records.length;
if (only === 'all' || only === 'quest') {
s.send({ id: IC.UseItem, slot: 19, fromInventory: true, counter: s.nextCounter('use') });
await sleep(1500);
save('quests/obj-quest-item.jsonl', from);
console.log('ObjQuestListSend frames:', count(from, QS.ObjQuestListSend));
}

if (only === 'all' || only === 'work') {
// Map 50 is snow: the Ropaje Invernal (2807, slot 20) keeps the character warm and dressed, so stamina lasts through the test.
// EquipItem toggles, and the server saves the equipped flag: only send it for a slot that is not equipped yet.
const equip = async slot => { if (!s.inventory?.get(slot)?.equipped) { s.send({ id: IC.EquipItem, slot, skin: false, counter: s.nextCounter('equip') }); await sleep(1200); } };
if (process.env.AO_DRESS_SLOT) await equip(Number(process.env.AO_DRESS_SLOT));
from = s.records.length;
await equip(18);
s.send({ id: IC.UseItem, slot: 18, fromInventory: true, counter: s.nextCounter('use') }); await sleep(1200);
s.send({ id: CC.StartAutomatedAction, x: 68, y: 63, skill: 19 });
await sleep(9000);
const beforeFlag = count(from, 113);
s.send({ id: CC.FlagTrabajar });
const flagAt = s.records.length;
await sleep(9000);
const afterFlag = count(flagAt, 113);
const walkFrom = s.records.length;
s.send({ id: C.Walk, heading: 4, counter: s.nextCounter('walk') }); s.send({ id: C.RequestPositionUpdate });
await sleep(10000);
const afterWalk = count(walkFrom, 113);
console.log('ParticleFX before FlagTrabajar', beforeFlag, 'after', afterFlag, 'after walk', afterWalk, 'pos', s.pos);
// Unequip the pickaxe again (EquipItem toggles).
s.send({ id: IC.EquipItem, slot: 18, skin: false, counter: s.nextCounter('equip') }); await sleep(1000);
save('crafting/mine-flag-then-walk.jsonl', from);

from = s.records.length;
s.send({ id: IC.EquipItem, slot: 16, skin: false, counter: s.nextCounter('equip') }); await sleep(1000);
s.send({ id: IC.UseItem, slot: 16, fromInventory: true, counter: s.nextCounter('use') }); await sleep(1500);
s.send({ id: IC.EquipItem, slot: 17, skin: false, counter: s.nextCounter('equip') }); await sleep(1000);
s.send({ id: IC.UseItem, slot: 17, fromInventory: true, counter: s.nextCounter('use') }); await sleep(1500);
// FrmSastre.Command3 with no row selected sends SastreRopas(0).Index, which is 0.
s.send({ id: CC.CraftSastre, object: 0 }); await sleep(1500);
for (const slot of [16, 17]) { s.send({ id: IC.EquipItem, slot, skin: false, counter: s.nextCounter('equip') }); await sleep(800); }
save('crafting/alchemy-tailor-open.jsonl', from);
}
s.close(); await sleep(500); process.exit(0);
