// Pets scenario (wp05): a druid with Domar 50 on map 37 (Gallinas, Domable 17) tames a chicken with the J key flow
// (Work 24 -> WorkRequestTarget -> WorkLeftClick 24), then runs the five pet commands on it.
// Steps: AO_PETS_STEP=fail (default) records the refused paths; =tame records taming + commands.
// DB prerequisite (see PR body): class_id 6 (Druid), skillpoint 24 = 50, pos_map 37 at (38,20), two tiles south of a lone Gallina (the spawn at (54,19) is next to a Lobo).
import { decodeServerPacket } from '../../packages/protocol/dist/index.js';
import { makeWalker, mapBlocked } from './helpers.mjs';
import { i32 } from './wire.mjs';

export default async function run(rec) {
  const step = process.env.AO_PETS_STEP ?? 'tame';
  const counters = { work: 0, workLeftClick: 0, leftClick: 0 };
  const w = makeWalker(rec, mapBlocked(37));
  const npcs = new Map(); let self, selfPos;
  const seen = new Set();
  const refresh = () => {
    for (const r of rec.records) {
      if (r.dir !== 's2c' || seen.has(r)) continue; seen.add(r);
      const p = decodeServerPacket(Buffer.from(r.hex, 'hex'));
      if (p.id === 47) self = p.charIndex;
      if (p.id === 31) selfPos = { x: p.x, y: p.y };
      if (p.id === 42) npcs.set(p.charIndex, { ...p });
      if (p.id === 44 && npcs.has(p.charIndex)) Object.assign(npcs.get(p.charIndex), { x: p.x, y: p.y });
      if (p.id === 43) npcs.delete(p.charIndex);
    }
  };
  const msgs = () => rec.records.filter(r => r.name === 'LocaleMsg').map(r => Buffer.from(r.hex, 'hex').readInt16LE(2));
  const me = () => { refresh(); const c = npcs.get(self); return { ...c, ...(selfPos ?? {}) }; };
  const near = () => { refresh(); const m = me(); return [...npcs.values()].filter(n => n.npc && n.charIndex !== self && n.npcNumber === 501).sort((a, b) => Math.abs(a.x - m.x) + Math.abs(a.y - m.y) - Math.abs(b.x - m.x) - Math.abs(b.y - m.y)); };
  rec.mark = rec.records.length;
  await rec.sleep(1500);
  console.log('self', me().x, me().y, 'chickens', near().length, near().slice(0, 3).map(n => [n.x, n.y]));
  const work = async () => { rec.send(97, [24, ...i32(++counters.work)]); await rec.sleep(400); };
  const aim = async (x, y) => { rec.send(2, [x, y, 24, ...i32(++counters.workLeftClick)]); await rec.sleep(1300); };
  if (step === 'fail') {
    await work(); await aim(me().x + 3, me().y);     // empty tile: "No hay ninguna criatura alli"
    return;
  }
  let tamed;

  for (let i = 0; i < 120 && !tamed; i++) {
    const m = me();
    const c = near().find(n => Math.abs(n.x - m.x) + Math.abs(n.y - m.y) <= 4 && !(n.x === m.x && n.y + 1 === m.y));
    if (!c) { await rec.sleep(1000); continue; }
    await work(); await aim(c.x, c.y);
    if (msgs().includes(657)) tamed = c;
  }
  console.log('tamed', tamed, msgs().slice(-6));
  if (!tamed) return;
  await rec.sleep(1500);
  const pet = [...npcs.values()].find(n => n.charIndex === tamed.charIndex) ?? tamed;
  // Select the pet (LeftClick sets TargetNPC) and run the commands.
  const select = async () => { const p = npcs.get(tamed.charIndex); refresh(); rec.send(95, [p.x, p.y, ...i32(++counters.leftClick)]); await rec.sleep(1800); };
  await select(); rec.send(42); await rec.sleep(1500);     // PetStand
  await select(); rec.send(43); await rec.sleep(1500);     // PetFollow
  rec.send(309); await rec.sleep(1500);                    // PetFollowAll
  await select(); rec.send(44); await rec.sleep(1500);     // PetLeave
  rec.send(282); await rec.sleep(1500);                    // PetLeaveAll (no pets left)
}
