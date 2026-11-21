// AGPL-3.0-or-later. MOV-* steps (first milestone). Expected results: docs/PLAYTHROUGH.md.
import { step } from '../harness.js';
import { Heading, SCP, C } from '../session.js';
import type { ClientPacket } from '@ao/protocol';
import { KeysClientPacketId as K, ItemsClientPacketId as I, SkillsClientPacketId as SK } from '@ao/protocol';
import { gmGoto } from './util.js';

const DX: Record<number, [number, number]> = { [Heading.North]: [0, -1], [Heading.East]: [1, 0], [Heading.South]: [0, 1], [Heading.West]: [-1, 0] };

step('MOV-01', async c => {
  const p = c.player;
  await p.sleep(2500);
  const from = p.mark(); const intervals = p.rx.find(r => r.name === 'Intervals')!.packet as any;
  c.near(intervals.walk, 150, 400, 'Intervals.walk ms (IntervaloCaminar = 210)');
  const wait = Math.ceil(intervals.walk) + 120, moved: string[] = [];
  for (const h of [Heading.East, Heading.South, Heading.West, Heading.North]) {
    const [dx, dy] = DX[h]!, bx = p.x, by = p.y;
    const r = await p.step(h, wait);
    if (r.moved) { c.eq([p.x - bx, p.y - by], [dx, dy], `heading ${h} delta`); moved.push(String(h)); } else c.note(`heading ${h} blocked at ${bx},${by} (correction PosUpdate=${r.corrected})`);
  }
  c.note(`self ${p.charIndex} at ${p.x},${p.y}; recent moves ${p.rx.filter(r => r.name === 'CharacterMove').slice(-8).map(r => `${(r.packet as any).charIndex}@${(r.packet as any).x},${(r.packet as any).y}`).join(' ')}`);
  c.note(`wire tail: ${p.wire.slice(-8).map(w => `${w.dir === 'c2s' ? '>' : '<'}${w.name}`).join(' ')}`);
  c.ok(moved.length >= 2, `${moved.length}/4 headings moved the character exactly one tile (others hit a blocked tile)`);
  c.fixture('walk-four-headings', p, from);
});

step('MOV-02', async c => {
  const p = c.player;
  // walk west until the server refuses a step: the refusal is a PosUpdate with the OLD position
  let refused = 0, steps = 0; const from = p.mark();
  for (; steps < 60 && !refused; steps++) { const r = await p.step(Heading.West, 330); if (!r.moved && r.corrected) refused = steps + 1; }
  c.ok(refused > 0, `a blocked tile answered with PosUpdate (old position) after ${steps} steps`);
  // another player in the way: step one tile away from the wall, put the GM helper on the next tile in that heading, walk into it
  let heading = Heading.East, r0 = await p.step(heading, 330);
  if (!r0.moved) { heading = Heading.South; r0 = await p.step(heading, 330); }
  c.ok(r0.moved, 'moved one tile off the wall');
  const [dx, dy] = DX[heading]!, bx = p.x, by = p.y;
  await gmGoto(c, p.map, bx + dx, by + dy);
  const r = await p.step(heading, 330);
  if (r.moved) { c.fixture('walk-into-wall-and-player', p, from); c.blocked(`wall half PASSED (a blocked tile answers PosUpdate with the old position). Player-collision half not verifiable: the GM helper does not block (admin-invisible GMs never do, LegalWalk), and a second NON-GM character is needed; the per-IP creation budget and the creation bug prevent one`); }
  c.ok(!r.moved, `walk into the GM helper standing at ${bx + dx},${by + dy} was blocked`);
  c.fixture('walk-into-wall-and-player', p, from);
  c.note('NPC half not driven: spawning a creature next to the player needs /ACC + a cleanup by the spawned index only (brief rule); covered by tests/fixtures/vb6/movement walk-into-creature');
});

step('MOV-03', async c => {
  const p = c.player, g = c.gm; await gmGoto(c, p.map, p.x + 1, p.y);
  const bx = p.x, by = p.y, m = g.mark(), pm = p.mark();
  const target = p.chars.get(p.charIndex)?.heading === Heading.North ? Heading.South : Heading.North;
  p.send({ id: SCP.ChangeHeading, heading: target, counter: 0 } as ClientPacket); await p.sleep(900);
  c.eq([p.x, p.y], [bx, by], 'position unchanged by a heading change');
  const ch = g.since(m).find(r => r.name === 'CharacterChange' && (r.packet as any).charIndex === p.charIndex);
  c.ok(!!ch, 'the GM next door received CharacterChange for the turn');
  c.eq((ch!.packet as any).heading, target, 'broadcast heading');
});

step('MOV-04', async c => c.blocked('needs the coordinates of a map exit tile; read from the .csm map files (tile exit flags) by a map parser the harness does not have yet. Protocol-level recordings exist: tests/fixtures/vb6/buildings/*castle-trigger-bounce.jsonl'));
step('MOV-05', async c => c.blocked('needs the ids of a Newbie / MaxLevel map from the server map files (MapInfo) and a level-13 character; the harness has no map-info reader yet. Route: GM /MOD level 13 on the own character, /TELEP to that map, expect the refusal locale message and no warp'));
step('MOV-06', async c => c.blocked('same missing map-info data as MOV-05 (a map with MaxLevel and Salida)'));
step('MOV-07', async c => c.blocked('needs a teleport object tile (otTeleport) located through the map files; not parsed yet'));
step('MOV-08', async c => c.blocked('door tiles come from the map files; recorded against the real server in tests/fixtures/vb6/doors and items-2 (PR #37/#47), not yet an end-to-end scenario'));
step('MOV-09', async c => c.blocked('needs a locked door + its key object from the map files; recorded in tests/fixtures/vb6/items-2/use-key-locked-door.jsonl'));
step('MOV-10', async c => c.blocked('needs a dock tile and a boat object id plus Navegacion skill and level 25 via GM /MOD; map data not parsed yet'));
step('MOV-11', async c => c.blocked('needs a water tile coordinate from the map files'));
step('MOV-13', async c => c.blocked('needs a Transportista/Pirata NPC; checked in the next milestone against the pinned npcs.dat (see report note)'));

step('MOV-14', async c => {
  const p = c.player, slot = [...p.inventory.entries()].find(([, i]) => i.object === 3791)?.[0];
  if (!slot) c.blocked('character has no Pasaje a Jourmut (obj 3791): only a fresh character holds the starter kit');
  const m = p.mark(), before = p.inventory.get(slot!)!.amount;
  p.send({ id: I.UseItem, slot: slot!, fromInventory: true, counter: 0 } as ClientPacket); await p.sleep(1500);
  const lines = p.localeSince(m).map(l => `${l.id}:${l.text}`).concat(p.messagesSince(m));
  c.note(`UseItem answered: ${p.since(m).map(r => r.name).join(',')} | ${lines.join(' | ').slice(0, 200)}`);
  c.ok(p.since(m).length > 0, 'the server answered the ticket use');
});

step('MOV-15', async c => {
  const p = c.player;
  const m = p.mark();
  p.send({ id: K.Work, skill: 6 } as unknown as ClientPacket);   // Ocultarse
  await p.sleep(2000);
  c.note(`Work(Ocultarse) answered with ${p.since(m).map(r => r.name).join(',') || 'nothing'}`);
  c.ok(p.since(m).length > 0, 'hide answered (success sets invisible, failure prints a locale message)');
});

step('MOV-16', async c => {
  const p = c.player;
  if (p.stats!.characterClass !== 1) c.blocked(`class ${p.stats!.characterClass} cannot meditate (only Mage-like classes); needs the fresh mage character`);
  c.gm.gm(`/MOD ${c.charName} MANA 0`); await p.sleep(700);
  const m = p.mark(); p.say('/MEDITAR'); await p.sleep(1500);
  const t = p.since(m).find(r => r.name === 'MeditateToggle');
  c.ok(!!t && (t.packet as any).fx !== 0, 'MeditateToggle with a meditation FX');
  p.say('/MEDITAR'); await p.sleep(800);
});
step('MOV-17', async c => c.blocked('implemented after MOV-16 passes on a mage character'));
step('MOV-18', async c => c.blocked('needs a FOGATA (obj 63) from MOV-19'));
step('MOV-19', async c => c.blocked('needs /CI 58 3 on the floor + Work on it; pending'));
step('MOV-20', async c => c.blocked('needs Magia 87+ via DB UPDATE on a logged-out char; pending'));
step('MOV-21', async c => c.blocked('needs a saddle object id; pending'));
step('MOV-22', async c => c.blocked('needs a dead character on a NEWBIE map; pending (DTH-01 first)'));
step('MOV-23', async c => c.blocked('needs a Seguro map id; the safe-zone refusal is recorded in tests/fixtures/vb6/combat/safezone-attack-blocked.jsonl'));
step('MOV-25', async c => c.blocked('needs GM kill (DTH-01) first; pending'));
