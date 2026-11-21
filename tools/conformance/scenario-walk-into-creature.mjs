// Walk into a creature, then attack (fix/walk-into-char). Aotest is a GM here: /TELEP to an open tile, /ACC <npc> spawns our own creature next to us.
// AO_STEP=walk-only  : Walk into the creature (refused: PosUpdate), then Attack      -> the server swings at its OLD heading.
// AO_STEP=turn       : what VB6 General.MoveTo sends for a blocked step: ChangeHeading, then Attack -> the swing lands on the creature.
import { i32, str } from './wire.mjs';
const i16 = n => { const b = Buffer.alloc(2); b.writeInt16LE(n); return [...b]; };
const dirs = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] };
export default async function run(rec) {
  const mode = process.env.AO_STEP ?? 'turn';
  const counters = { walk: 0, attack: 0, heading: 0 };
  const self = Buffer.from(rec.records.find(r => r.name === 'UserCharIndexInServer').hex, 'hex').readInt16LE(2);
  const sleep = ms => rec.sleep(ms);
  rec.send(110, [...str('Aotest'), ...i16(1), 60, 50]); await sleep(1500); // /TELEP Aotest 1 60 50
  const before = rec.records.length;
  rec.send(181, i16(Number(process.env.AO_NPC ?? 501))); await sleep(1200); // /ACC: a creature next to us
  const created = rec.records.slice(before).filter(r => r.name === 'CharacterCreate').map(r => Buffer.from(r.hex, 'hex')).filter(b => b.readInt16LE(2) !== self);
  const npc = created.at(-1); if (!npc) throw new Error('no creature spawned');
  const npcPos = [npc[9], npc[10]], npcIndex = npc.readInt16LE(2);
  const mine = rec.records.filter(r => r.name === 'CharacterCreate' || r.name === 'CharacterMove').map(r => Buffer.from(r.hex, 'hex'));
  rec.send(79); await sleep(600);
  const where = () => { const p = Buffer.from(rec.records.filter(r => r.name === 'PosUpdate').at(-1).hex, 'hex'); return [p[2], p[3]]; };
  const npcNow = () => { // latest tile of our creature from CharacterCreate / CharacterMove (a chicken wanders every ~3 s)
    let at = npcPos; for (const r of rec.records) if (r.name === 'CharacterMove') { const b = Buffer.from(r.hex, 'hex'); if (b.readInt16LE(2) === npcIndex) at = [b[4], b[5]]; } return at; };
  const tool = Number(process.env.AO_TOOL_SLOT ?? 17); // Aotest wears a tool in slot 17: Attack answers LocaleMsg 694 until it is taken off (undone at the end)
  rec.send(5, [tool, 0, ...i32(1)]); await sleep(1500);
  const mark = rec.records.length; let tries = 0, fired = false;
  while (!fired && tries++ < 40) {
    rec.send(79); await sleep(250);
    const me = where(), n = npcNow();
    const h = Number(Object.entries(dirs).find(([, d]) => me[0] + d[0] === n[0] && me[1] + d[1] === n[1])?.[0]);
    if (!h) { // not adjacent: close in along the longer axis (free tiles only matter for this probe)
      const dx = n[0] - me[0], dy = n[1] - me[1], step = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1);
      rec.send(78, [step, ...i32(++counters.walk)]); await sleep(300); continue; }
    console.log('self', me, 'creature', npcIndex, n, 'heading to it', h, 'mode', mode);
    const at = rec.records.length;
    if (mode === 'walk-only') rec.send(78, [h, ...i32(++counters.walk)]); else rec.send(6, [h, ...i32(++counters.heading)]);
    await sleep(120);
    rec.send(80, i32(++counters.attack)); await sleep(1500); fired = true;
    const seen = rec.records.slice(at).filter(r => r.dir === 's2c' && !/UserOnline|CharacterMove|CharacterChange$/.test(r.name)).map(r => `${r.name}:${r.hex}`);
    console.log(mode, 'server replies:', seen.join(' | '));
  }
  rec.send(5, [tool, 0, ...i32(2)]); await sleep(800); // wear the tool again
  rec.mark = mark;
}
