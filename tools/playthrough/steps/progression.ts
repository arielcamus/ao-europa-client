// AGPL-3.0-or-later. PRG-16..20: the natural skill cap ("skills rise by use only up to a per-level ceiling"), from Ariel's player knowledge.
// Source: Modulo_UsUaRiOs.bas SubirSkill (maxPermitido) and CheckUserLevel (Pts += LevelSkillPoints).
import { step } from '../harness.js';
import type { Ctx } from '../harness.js';
import type { ClientPacket } from '@ao/protocol';
import { SkillsClientPacketId as SK } from '@ao/protocol';
import { skills, SKILL, mod } from './util.js';

/** SubirSkill: the per-level ceiling, transcribed from the VB6 integer arithmetic. */
export const naturalCap = (lvl: number) => lvl % 2 === 0 ? Math.floor(lvl / 2) * 5 : Math.floor(lvl / 2) * 5 + 3 - Math.floor((Math.floor((lvl - 1) / 2) * 5) % 10 / 5);

step('PRG-16', async c => {
  const remembered: [number, number][] = [[1, 3], [2, 5], [4, 10], [6, 15], [8, 20]];
  for (const [lvl, cap] of remembered) c.eq(naturalCap(lvl), cap, `cap at level ${lvl} (Ariel: ${cap})`);
  c.eq([3, 5, 7].map(naturalCap), [7, 13, 17], 'odd levels 3, 5, 7 = 7, 13, 17 (+3 or +2)');
  c.eq([10, 20, 30, 40, 47].map(naturalCap), [25, 50, 75, 100, 117], 'levels 10/20/30/40/47 (PRG-08 table)');
  c.note('Ariel\'s remembered numbers MATCH the pinned code exactly; the table is SubirSkill, not a guess');
});

const mage = (c: Ctx, what: string) => {
  if (!c.own) c.blocked(`${what} needs the harness's own mage character (a fresh one, or a reused one); creation failed ${c.creation.attempts}x (known server bug), and the fallback character is a level-1 warrior that cannot meditate`);
  if (c.player.stats!.characterClass !== 1) c.blocked(`${what}: character is not a mage`);
};
/** Drain mana through the GM, meditate until the skill moves or `ms` pass; returns the Meditar skill. */
async function meditateRound(c: Ctx, ms: number) {
  const p = c.player;
  mod(c, c.charName, 'MANA', 0); await p.sleep(900);
  if (p.stats!.mana !== 0) c.blocked('the GM helper cannot edit another character (/MOD refused: Consejero/SemiDios privileges); needed to drain mana');
  p.say('/MEDITAR'); await p.sleep(ms); p.say('/MEDITAR'); await p.sleep(600);
  return (await skills(p))[SKILL.Meditar]!;
}
step('PRG-17', async c => {
  mage(c, 'PRG-17');
  c.eq(c.player.stats!.level, 1, 'ELV 1');
  let v = (await skills(c.player))[SKILL.Meditar]!;
  for (let i = 0; i < 8 && v < 3; i++) v = await meditateRound(c, 9000);
  c.eq(v, 3, 'Meditar reached the level-1 cap 3 by use');
  for (let i = 0; i < 3; i++) v = await meditateRound(c, 9000);
  c.eq(v, 3, 'Meditar still 3 after 3 more meditation rounds (no gain at the cap)');
});
step('PRG-18', async c => {
  mage(c, 'PRG-18');
  const p = c.player, m = p.mark(); mod(c, c.charName, 'ELV', 2); await p.sleep(1500);
  c.eq(p.stats!.level, 2, 'ELV after GM /MOD'); 
  const lvl = p.since(m).filter(r => r.name === 'LevelUp').pop(); c.eq((lvl?.packet as any)?.skillPoints, 15, 'free points 10 + 5');
  let v = (await skills(p))[SKILL.Meditar]!;
  for (let i = 0; i < 8 && v < 5; i++) v = await meditateRound(c, 9000);
  c.eq(v, 5, 'Meditar rose again to the level-2 cap 5');
  for (let i = 0; i < 2; i++) v = await meditateRound(c, 9000);
  c.eq(v, 5, 'and stopped at 5');
});
step('PRG-19', async c => {
  mage(c, 'PRG-19');
  const p = c.player, pts = new Array(24).fill(0); pts[SKILL.Meditar] = 5;
  const before = (await skills(p))[SKILL.Meditar]!;
  p.send({ id: SK.ModifySkills, skills: pts } as unknown as ClientPacket); await p.sleep(1200);
  const above = (await skills(p))[SKILL.Meditar]!; c.eq(above, before + 5, 'assigned points may exceed the natural cap');
  let v = above; for (let i = 0; i < 3; i++) v = await meditateRound(c, 9000);
  c.eq(v, above, 'no natural gain above the cap');
});
step('PRG-20', async c => {
  mage(c, 'PRG-20');
  const p = c.player, m = p.mark(); const lvl0 = p.stats!.level;
  mod(c, c.charName, 'ELV', lvl0 + 3); await p.sleep(1500);
  const lu = p.since(m).filter(r => r.name === 'LevelUp').pop();
  c.ok(!!lu, `LevelUp reports the running free points: ${(lu?.packet as any)?.skillPoints}`);
});
