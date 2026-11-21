/*
 * The meditation aura by level. Server: Protocol.HandleMeditate picks Char.FX from Dat/Meditaciones.dat by level and faction
 * (server 9ccd7fad, FileIO.LoadMeditations) and sends MeditateToggle(charindex, fx, x, y); the client (Protocol.HandleMeditateToggle)
 * does StartFx(ActiveAnimation, fx, -1) and draws it in engine.bas Draw_Animation at (+BodyOffset, +4), alpha 180, until fx 0 arrives (FX 115-120 are the
 * composed meditation animations, Recursos.LoadComposedFx).
 * AGPL-3.0-or-later; no warranty. See NOTICE.
 *
 * Pre-HOO data gap: the pinned Dat names FX 153-172 but init/FXs.ini and fxs.ind (last changed 2024-04, 150 entries) have none of
 * them, so the pinned client itself draws nothing for levels 1-46 (FxData(153) is out of range). What the data does have is the
 * classic six-step meditation art (FX 115-120, the server's e_Meditaciones before Dec 2025), so an id missing from FXs.ini is drawn
 * with the classic step of its level tier. Nothing from the HOO client is used.
 */

/** Meditaciones.dat [FXsMEDITATIONSBYLEVEL] / [FXsMEDITATIONSCRIMINALBYLEVEL] defaults (FileIO.LoadMeditations): last level of the tier, citizen FX, criminal FX. */
export const MEDITATION_TIERS: readonly { to: number; citizen: number; criminal: number }[] = [
  { to: 12, citizen: 153, criminal: 154 }, { to: 17, citizen: 155, criminal: 156 }, { to: 24, citizen: 157, criminal: 158 },
  { to: 28, citizen: 159, criminal: 160 }, { to: 32, citizen: 161, criminal: 162 }, { to: 36, citizen: 163, criminal: 164 },
  { to: 39, citizen: 165, criminal: 166 }, { to: 42, citizen: 167, criminal: 168 }, { to: 44, citizen: 169, criminal: 170 },
  { to: 46, citizen: 171, criminal: 172 },
];
/** MeditationLevelMax (level 47 and up): FX 120, which FXs.ini has. */
export const MEDITATION_MAX_FX = 120;
/**
 * The classic art by tier: the server's e_Meditaciones before Dec 2025 was 1-14 -> 115, 15-24 -> 116, 25-35 -> 117, 36-44 -> 118, 45-46 -> 119, 47+ -> 120.
 * The ids 153-172 encode the new server's own tiers, which do not line up at 13-14 (tier 13-17 mixes 115 and 116) and 33-35 (tier 33-36 mixes 117 and 118):
 * each tier takes the classic art of the majority of its levels (13-17 -> 116, 33-36 -> 117).
 */
const CLASSIC_BY_TIER: readonly number[] = [115, 116, 116, 117, 117, 117, 118, 118, 118, 119];

/** The FX to draw for the one the server sent: itself when FXs.ini has it, else the classic step of its tier (any other id is kept as it is). */
export function meditationArt(fx: number, inTable: (fx: number) => boolean): number {
  if (inTable(fx)) return fx;
  const tier = MEDITATION_TIERS.find(t => t.citizen === fx || t.criminal === fx);
  if (!tier) return fx;
  return CLASSIC_BY_TIER[MEDITATION_TIERS.indexOf(tier)]!;
}
