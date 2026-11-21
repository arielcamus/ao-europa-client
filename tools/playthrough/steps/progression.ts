// AGPL-3.0-or-later. PRG-16..20: the natural skill cap ("skills rise by use only up to a per-level ceiling"), from Ariel's player knowledge.
// Source: Modulo_UsUaRiOs.bas SubirSkill (maxPermitido) and CheckUserLevel (Pts += LevelSkillPoints).
import { step } from '../harness.js';
import type { Ctx } from '../harness.js';
import type { ClientPacket } from '@ao/protocol';
import { SkillsClientPacketId as SK } from '@ao/protocol';
import { skills, SKILL, dbUpdateOwn } from './util.js';

/** One meditation round. The server's meditation tick is NOT 0.4 s in wall-clock terms (see MOV-17): rounds are long. */
const ROUND_MS = Number(process.env.AO_MEDITATE_MS ?? 100_000);
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
  await dbUpdateOwn(c, 'min_man=0');
  const p = c.player; // the GM helper cannot /MOD other characters (Consejero/SemiDios), so the own character is edited in the DB
  if (p.stats!.mana !== 0) c.blocked('could not drain mana through the DB');
  p.say('/MEDITAR'); await p.sleep(ms); p.say('/MEDITAR'); await p.sleep(600);
  return (await skills(p))[SKILL.Meditar]!;
}
step('PRG-17', async c => {
  mage(c, 'PRG-17');
  c.eq(c.player.stats!.level, 1, 'ELV 1');
  let v = (await skills(c.player))[SKILL.Meditar]!;
  if (v > 3) c.blocked(`the reused character already has Meditar ${v} (> cap 3) from an earlier run (PRG-19 assigns points): needs a FRESH character, which starts every skill at 0 (TCP.ResetUserSkills)`);
  for (let i = 0; i < 4 && v < 3; i++) v = await meditateRound(c, ROUND_MS);
  c.eq(v, 3, 'Meditar reached the level-1 cap 3 by use');
  for (let i = 0; i < 1; i++) v = await meditateRound(c, ROUND_MS);
  c.eq(v, 3, 'Meditar still 3 after 1 more meditation rounds (no gain at the cap)');
});
step('PRG-18', async c => {
  mage(c, 'PRG-18');
  await dbUpdateOwn(c, 'level=2, exp=0, free_skillpoints=15'); const p = c.player, m = p.mark();
  c.eq(p.stats!.level, 2, 'ELV 2 (set through the DB: the GM helper cannot /MOD others)'); 
  c.eq((p.rx.filter(r => r.name === 'LevelUp').pop()?.packet as any)?.skillPoints, 15, 'free points 10 + 5');
  let v = (await skills(p))[SKILL.Meditar]!;
  for (let i = 0; i < 4 && v < 5; i++) v = await meditateRound(c, ROUND_MS);
  c.eq(v, 5, 'Meditar rose again to the level-2 cap 5');
  for (let i = 0; i < 1; i++) v = await meditateRound(c, ROUND_MS);
  c.eq(v, 5, 'and stopped at 5');
});
// PRG-20 runs BEFORE PRG-19 (it needs a skill that can still rise): level 3 with exp just under the level-4 threshold (ExpLevelUp[3] = 1125),
// 15 unassigned points; meditating raises Meditar (cap 7 at level 3), each skill-up grants +5 exp, which crosses the threshold:
// CheckUserLevel adds LevelSkillPoints (5) on top of the points never spent.
step('PRG-20', async c => {
  mage(c, 'PRG-20');
  await dbUpdateOwn(c, 'level=3, exp=1120, free_skillpoints=15');
  const p = c.player; c.eq(p.stats!.level, 3, 'ELV 3 (DB)');
  const m = p.mark();
  for (let i = 0; i < 4 && !p.since(m).some(r => r.name === 'LevelUp'); i++) await meditateRound(c, ROUND_MS);
  const lu = p.since(m).filter(r => r.name === 'LevelUp').pop();
  c.ok(!!lu, 'a skill-up (+5 exp) crossed 1125 and CheckUserLevel sent LevelUp');
  c.eq((lu!.packet as any).skillPoints, 20, 'free points = 15 never spent + 5 for the new level');
  c.eq(p.stats!.level, 4, 'ELV 4');
});
step('PRG-19', async c => {
  mage(c, 'PRG-19');
  const p = c.player, pts = new Array(24).fill(0); pts[SKILL.Meditar] = 8;
  const before = (await skills(p))[SKILL.Meditar]!, cap = naturalCap(p.stats!.level);
  p.send({ id: SK.ModifySkills, points: pts } as unknown as ClientPacket); await p.sleep(1500);
  const above = (await skills(p))[SKILL.Meditar]!; c.eq(above, before + 8, 'assigned points are added to the skill');
  c.ok(above >= cap, `skill ${above} is at or above the level-${p.stats!.level} natural cap ${cap}`);
  let v = above; for (let i = 0; i < 1; i++) v = await meditateRound(c, ROUND_MS);
  c.eq(v, above, 'no natural gain at or above the cap');
});
