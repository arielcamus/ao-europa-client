// AGPL-3.0-or-later. DTH-* (death by a creature) and OTH-06 (trainer), with a creature the GM helper spawns itself.
import { step } from '../harness.js';
import type { ClientPacket } from '@ao/protocol';
import { SkillsClientPacketId as SK, DoorClientPacketId as DOOR } from '@ao/protocol';
import { relocate, gmGoto, spawnCreature, killMine, dbUpdateOwn, loadMap } from './util.js';
import { walkable } from '../maps.js';

step('DTH-01', async c => {
  if (!c.own) c.blocked('needs the own character');
  const f = loadMap(2)!;
  let spot: [number, number] | undefined;
  for (let r = 0; r < 40 && !spot; r++) for (let y = 50 - r; y <= 50 + r && !spot; y++) for (let x = 50 - r; x <= 50 + r && !spot; x++) if ([[0, 0], [1, 0], [2, 0], [-1, 0]].every(([dx, dy]) => walkable(f.map, x + dx!, y + dy!))) spot = [x, y];
  await dbUpdateOwn(c, `pos_map=2, pos_x=${spot![0]}, pos_y=${spot![1]}, min_hp=1`);
  const p = c.player; c.eq(p.map, 2, 'placed on map 2 (an unsafe field map) with 1 HP');
  await gmGoto(c, 2, p.x + 2, p.y);
  const mine = await spawnCreature(c, 501);
  const from = p.mark(); let died = false;
  try {
    await p.until(() => (p.stats?.hp ?? 1) <= 0 || p.since(from).some(r => r.name === 'UpdateHP' && (r.packet as any).hp <= 0), 75_000, 'player HP to reach 0').then(() => { died = true; }).catch(() => undefined);
  } finally { await killMine(c, mine); }
  c.ok(died, `the creature (${mine.name}, char ${mine.charIndex}) killed the 1 HP character`);
  await p.sleep(1500);
  const change = p.rx.filter(r => r.name === 'CharacterChange' && (r.packet as any).charIndex === p.charIndex).pop();
  c.note(`after death: last own CharacterChange body ${(change?.packet as any)?.body} (ghost body 829), hp ${p.stats?.hp}`);
  c.fixture('death-by-creature', p, from);
  // revive through the DB (own character, logged out): is_dead=0 and some HP
  await dbUpdateOwn(c, 'is_dead=0, min_hp=20, pos_map=751, pos_x=60, pos_y=57');
  c.note('reverted: is_dead=0, min_hp=20, back on 751');
});

step('OTH-06', async c => {
  // the trainer NPC (NPC 649 "Entrenador", NpcType 3) does not exist on any map: the GM spawns one, targets it and asks for the creature list
  const g = c.gm; await gmGoto(c, 751, 62, 57);
  const mark = g.mark(), mine = await spawnCreature(c, 649);
  try {
    g.send({ id: DOOR.LeftClick, x: mine.x, y: mine.y, counter: 0 } as ClientPacket); await g.sleep(900);
    const m = g.mark(); g.send({ id: SK.TrainList } as unknown as ClientPacket); await g.sleep(1500);
    const list = g.since(m).find(r => r.name === 'TrainerCreatureList');
    c.fixture('trainer-train-list', g, mark);
    c.ok(!!list, `TrainList answered with TrainerCreatureList: ${JSON.stringify(list?.packet ?? null).slice(0, 160)}`);
  } finally { await killMine(c, mine); }
});
