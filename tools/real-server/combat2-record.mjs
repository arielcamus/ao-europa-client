// AGPL-3.0-or-later. Records wp03 (combat and spells completion) scenarios against the classic VB6 server as fixtures.
// Usage: node tools/real-server/combat2-record.mjs <scenario> <out.jsonl>   (account/char: spells@local.test / TSpells, see the PR body)
// Standalone recorder with its own per-family counters (it is not the browser session; the browser uses session.next).
import { Vb6Session, sleep, C, S, DC } from './bank-trade-session.mjs';
import { ItemsClientPacketId as IC, SpellClientPacketId as SC, KeysClientPacketId as K, StatusClientPacketId as ST } from '../../packages/protocol/dist/index.js';

const [scenario, out] = process.argv.slice(2);
const s = new Vb6Session({ email: process.env.AO_EMAIL ?? 'spells@local.test', password: process.env.AO_PASSWORD ?? 'spellspw1' });
const equip = slot => s.send({ id: IC.EquipItem, slot, skin: false, counter: s.nextCounter('equip') });
const use = slot => s.send({ id: IC.UseItem, slot, fromInventory: true, counter: s.nextCounter('use') });
const target = (x, y, skill) => s.send({ id: SC.WorkLeftClick, x, y, skill, counter: s.nextCounter('workLeft') });
const snake = () => [...s.chars.values()].filter(c => c.npc && c.npcNumber === 502).sort((a, b) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y) - Math.hypot(b.x - s.pos.x, b.y - s.pos.y))[0];
const quiet = (ms = 1200) => sleep(ms);

await s.login(); await sleep(1000);
const from = s.records.length;
const scenarios = {
  // Equip the bow, then the arrows (the server refuses arrows without a bow, message 2145), use the bow (the server asks for a target: Proyectiles), click the nearest snake: projectile + damage.
  async 'bow-shoot-snake'() {
    equip(11); await quiet(); equip(12); await quiet();
    use(11); await quiet();
    for (let i = 0; i < 4; i++) { const n = snake(); if (!n) break; target(n.x, n.y, 12); await quiet(1500); use(11); await quiet(600); }
  },
  // Dardo Mágico (spell slot 2, 10 mana) at the nearest snake: CastSpell, WorkRequestTarget, WorkLeftClick, FX, damage.
  async 'cast-dart-snake'() {
    for (let i = 0; i < 3; i++) {
      s.send({ id: SC.CastSpell, slot: 2, counter: s.nextCounter('cast') }); await quiet(700);
      const n = snake(); if (n) target(n.x, n.y, 1); await quiet(2500);
    }
  },
  // Wait for the snake's bite (poison), then drink the antidote (Poción Violeta, slot 2).
  async 'snake-poison-antidote'() { await sleep(5500); use(2); await quiet(2500); },
  // Using a scroll teaches the spell: ChangeSpellSlot + console line.
  async 'learn-spell-scroll'() { await quiet(3000); use(13); await quiet(2500); },
  // Hide with the key: Work skill Ocultarse.
  async 'hide-key'() { s.send({ id: K.Work, skill: 7, counter: s.nextCounter('work') }); await quiet(2500); s.send({ id: K.Work, skill: 7, counter: s.nextCounter('work') }); await quiet(2000); },
  // Safe toggles.
  async 'safe-toggles'() {
    s.send({ id: ST.SeguroClan }); await quiet(); s.send({ id: ST.SeguroClan }); await quiet();
    s.send({ id: ST.SeguroResu }); await quiet(); s.send({ id: ST.SeguroResu }); await quiet();
    s.send({ id: K.PartySafeToggle }); await quiet(); s.send({ id: K.PartySafeToggle }); await quiet();
  },
  // Stand next to the snake until it bites (poison + damage), drink the antidote (slot 2), then wait for the creature to finish us.
  async 'snake-poison-antidote-death'() {
    const n = snake(); if (!n) throw new Error('no snake');
    // walk towards it
    for (let i = 0; i < 25 && Math.hypot(n.x - s.pos.x, n.y - s.pos.y) > 1.5; i++) { const cur = s.chars.get(n.charIndex); const dx = cur.x - s.pos.x, dy = cur.y - s.pos.y; s.send({ id: C.Walk, heading: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1), counter: s.nextCounter('walk') }); s.send({ id: C.RequestPositionUpdate }); await sleep(420); }
    await sleep(4000); use(2); await quiet(1500);
    await sleep(15000);
  },
};
if (!scenarios[scenario]) throw new Error(`scenarios: ${Object.keys(scenarios).join(', ')}`);
await scenarios[scenario]();
await sleep(1500);
s.save(out, 0); console.log(scenario, 'records', s.records.length - from);
const ids = new Map(); for (const r of s.records.slice(from)) ids.set(`${r.dir}${r.id}${r.name}`, (ids.get(`${r.dir}${r.id}${r.name}`) ?? 0) + 1); console.log([...ids].map(([k, v]) => `${k}x${v}`).join(' '));
s.close();
