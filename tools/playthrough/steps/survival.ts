// AGPL-3.0-or-later. SUR-01..15 (survival: hunger and thirst, eating and drinking, potions, poison, natural regeneration). Every expected number is
// from the pinned server (server Dat copied from C:\ao\server-9ccd\Dat, code in argentum-online-server-classic/Codigo), cited per step.
// States are set with UPDATEs on the harness's OWN logged-out characters (sc-util.ts dbEdit); creatures come from the GM helper and only those are killed.
import { SkillsClientPacketId as SK } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { step } from '../harness.js';
import type { Ctx } from '../harness.js';
import { ensureEquipped, attack, actor, dbEdit, setUser, useSlot, equipSlot, slotOf, amountOf, series, localeIds, Msg, gmGoto, spawnCreature, killMine } from './sc-util.js';
import { attributes } from './util.js';

const APPLE = 3684, WATER = 3685, RED = 4335, BLUE = 4336, YELLOW = 4337, VIOLET = 4334;
const food = (c: Ctx) => c.player.hunger!;
/** After a relogin the packets since `m` say what the server sent while the character stood still. */
const mage = (c: Ctx) => actor(c, 'mage');

step('SUR-01', async c => {
  // HambreYSed (General.bas) runs once per second from PasarSegundo: AGUACounter counts to IntervaloSed = 4000/25 = 160 (FileIO.LoadIntervalos divides by 25), so
  // thirst loses 10 on the 161st second after login; COMCounter counts to IntervaloHambre = 4500/25 = 180, so hunger loses 10 on the 181st.
  const p = await mage(c);
  await dbEdit(c, 'mage', setUser('min_ham=50, min_sed=50'));
  const t0 = Date.now(), m = c.player.mark(); c.eq([food(c).food, food(c).water], [50, 50], 'logged in with 50/50');
  await c.player.until(() => (food(c).water ?? 50) < 50, 200_000, 'thirst tick');
  const sThirst = (Date.now() - t0) / 1000;
  await c.player.until(() => (food(c).food ?? 50) < 50, 40_000, 'hunger tick');
  const sHunger = (Date.now() - t0) / 1000;
  c.eq([food(c).food, food(c).water], [40, 40], 'one tick removes exactly 10 from each');
  c.near(sThirst, 158, 170, 'seconds from login to the first thirst tick (161 expected: IntervaloSed+1)');
  c.near(sHunger, 178, 192, 'seconds from login to the first hunger tick (181 expected: IntervaloHambre+1)');
  c.ok(sHunger - sThirst > 10 && sHunger - sThirst < 30, `hunger ticks ${(sHunger - sThirst).toFixed(1)} s after thirst (20 expected)`);
  c.note(`GMs are exempt (HambreYSed exits unless Privilegios = User): not asserted on the GM helper; full drain (26.8 and 30.2 minutes) is arithmetic on the same counters`);
  void p, void m;
});

step('SUR-03', async c => {
  // UseInvItem otUseOnce (InvUsuario.bas): MinHam += obj.MinHam (Obj.dat OBJ3684 Manzana Roja (P): MinHAM=15), capped at MaxHam = 100, then QuitarUserInvItem 1.
  await dbEdit(c, 'mage', setUser('min_ham=50, min_sed=100'));
  const p = c.player, slot = slotOf(p, APPLE)!, before = slot.amount;
  c.eq(food(c).food, 50, 'hunger 50 before'); useSlot(p, slot.slot);
  await p.until(() => food(c).food !== 50, 4000, 'UpdateHungerAndThirst');
  c.eq(food(c).food, 65, 'apple adds MinHAM 15');
  await p.until(() => amountOf(p, APPLE) === before - 1, 3000, 'one apple consumed');
  c.eq(amountOf(p, APPLE), before - 1, 'one apple consumed');
  // cap: 95 + 15 -> 100
  await dbEdit(c, 'mage', setUser('min_ham=95')); useSlot(c.player, slotOf(c.player, APPLE)!.slot);
  await c.player.until(() => food(c).food === 100, 4000, 'hunger capped'); c.eq(food(c).food, 100, 'capped at MaxHam 100');
});

step('SUR-04', async c => {
  // UseInvItem otDrinks: MinAGU += obj.MinSed (Obj.dat OBJ3685 Botella de Agua (P): MinAgu=15; its Texto says 30, the code uses the field), cap MaxAGU 100, consume 1.
  await dbEdit(c, 'mage', setUser('min_ham=100, min_sed=50'));
  const p = c.player, slot = slotOf(p, WATER)!, before = slot.amount;
  c.eq(food(c).water, 50, 'thirst 50 before'); useSlot(p, slot.slot);
  await p.until(() => food(c).water !== 50, 4000, 'UpdateHungerAndThirst');
  c.eq(food(c).water, 65, 'water bottle adds MinAgu 15 (the item text promises 30: data bug in Obj.dat, the server uses MinAgu)');
  await p.until(() => amountOf(p, WATER) === before - 1, 3000, 'bottle consumed'); c.eq(amountOf(p, WATER), before - 1, 'one bottle consumed');
});

step('SUR-05', async c => {
  // UseInvItem otPotions / ModifiesHp: HealingAmount = RandomNumber(MinModificador, MaxModificador) * GetSelfHealingBonus; Obj.dat OBJ4335 has Min=Max=13.
  // Throttle: IntervaloPermiteUsarClick (276 ms, intervalos.ini IntervaloUserPuedeUsarClic) and IntervaloPermiteGolpeUsar (800 ms) -> message 681.
  await dbEdit(c, 'mage', setUser('min_hp=3, min_ham=100, min_sed=100'));
  const p = c.player, slot = slotOf(p, RED)!, before = slot.amount;
  c.eq(p.stats!.hp, 3, 'HP 3 of 20 before');
  const m = p.mark(); useSlot(p, slot.slot); useSlot(p, slot.slot); // two uses in the same instant
  await p.sleep(1500);
  c.eq(p.stats!.hp, 16, 'one potion heals exactly 13 (3 -> 16); the instant second use was throttled');
  const used = before - amountOf(p, RED);
  c.ok(used === 1 || used === 0, `potions consumed ${used} (1 expected; 0 only inside IsConsumableFreeZone)`);
  c.note(`throttle message ids: ${localeIds(p, m).join(',') || 'none (silent click throttle)'}`);
  await p.sleep(900); useSlot(p, slotOf(p, RED)!.slot); await p.sleep(1200);
  c.eq(p.stats!.hp, 20, 'a later use heals 13 more but is capped at MaxHp 20');
});

step('SUR-06', async c => {
  // otPotions / ModifiesMp: MinMAN += Porcentaje(MaxMAN, Porcentaje field = 3) = 150*3/100 = 4.5 (VB6 Long conversion rounds half to even = 4), capped at MaxMAN.
  await dbEdit(c, 'mage', setUser('min_man=0, min_ham=100, min_sed=100'));
  const p = c.player, slot = slotOf(p, BLUE)!, before = slot.amount;
  c.eq(p.stats!.mana, 0, 'mana 0 before'); useSlot(p, slot.slot);
  await p.until(() => (p.stats?.mana ?? 0) > 0, 4000, 'mana update');
  c.ok([4, 5].includes(p.stats!.mana), `mana ${p.stats!.mana} = 3% of 150 (4.5, VB6 rounding)`);
  await p.sleep(500); c.eq(before - amountOf(p, BLUE), 1, 'one blue potion consumed');
});

step('SUR-07', async c => {
  // otPotions / ModifiesAgility: UserAtributos(Agilidad) += RandomNumber(2, 4) (Obj.dat OBJ4337), DuracionEfecto = 70 s (DuracionPociones, PasarSegundo) then back to UserAtributosBackUP.
  await dbEdit(c, 'mage', setUser('min_ham=100, min_sed=100'));
  const p = c.player, base = (await attributes(p)).agility, m = p.mark(); useSlot(p, slotOf(p, YELLOW)!.slot);
  await p.waitFor('FYA', m, 4000).catch(() => undefined); await p.sleep(500);
  const during = (await attributes(p)).agility, t0 = Date.now();
  c.near(during - base, 2, 4, `agility +${during - base} (2..4)`);
  let after = during; while (after !== base && Date.now() - t0 < 90_000) { await p.sleep(5000); after = (await attributes(p)).agility; }
  c.eq(after, base, 'agility back to the base value');
  c.near((Date.now() - t0) / 1000, 55, 85, 'seconds the effect lasted (70 expected, polled every 5 s)');
});

// SUR-09 first: it poisons the mage with a creature the GM helper spawns itself, measures the ticks and ends by curing with the violet potion (SUR-08's second half).
step('SUR-09', async c => {
  // EfectoVeneno (pinned General.bas), called from the game loop while Envenenado <> 0: Counters.Veneno counts to IntervaloVeneno = 90 loop ticks; each tick Damage = 1 + (RandomNumber(3,5) * MaxHp \ 100)
  // (VB6 precedence: 1 + ((r * MaxHp) \ 100)) = 1 for a 20 HP mage unless r = 5 (then 2), with message 47 and, when chat-combat is on, 390. Poison has no expiry. The serpent is NPC 502 (live NPCs.dat:
  // Veneno=1, MinHIT 3 MaxHIT 6, 22 HP), spawned by the GM helper in Forgat and removed as soon as the mage is poisoned.
  const g = c.gm; await dbEdit(c, 'mage', setUser('is_dead=0, min_hp=20, min_ham=100, min_sed=100, min_man=150, pos_map=751, pos_x=60, pos_y=57'));
  const p = c.player; await gmGoto(c, 751, p.x + 2, p.y);
  const mine = await spawnCreature(c, 502); const m = p.mark();
  let poisoned = false;
  try { await p.until(() => localeIds(p, m).includes(Msg.poisonTick) || (p.stats?.hp ?? 20) <= 12, 60_000, 'poison tick or low HP'); }
  finally { await killMine(c, mine); }
  await p.until(() => localeIds(p, m).includes(Msg.poisonTick), 6000, 'a poison tick').catch(() => undefined); poisoned = localeIds(p, m).includes(Msg.poisonTick);
  void g;
  if (!poisoned) { c.shared.cure = 'not poisoned'; c.blocked('the serpent did not poison within the window (poison chance per hit); the creature was removed'); }
  const t0 = p.mark(); await p.sleep(16_000);
  const ticks = p.since(t0).filter(r => r.name === 'LocaleMsg' && (r.packet as any).messageId === Msg.poisonTick).map(r => r.t);
  c.ok(ticks.length >= 3, `${ticks.length} poison ticks in 16 s`);
  const gaps = ticks.slice(1).map((t, i) => (t - ticks[i]!) / 1000); c.near(Math.min(...gaps), 2.5, 6, `tick gaps ${gaps.map(g => g.toFixed(1)).join(', ')} s (IntervaloVeneno+1 = 91 loop ticks, about 3.6 s)`);
  const raw = series(p, t0, 'UpdateHP').map(s => s.p.hp as number), hp = raw.filter((h, i) => i === 0 || h !== raw[i - 1]);
  const drops = hp.slice(1).map((h, i) => hp[i]! - h).filter(d => d > 0); c.ok(drops.length > 0 && drops.every(d => d >= 1 && d <= 2), `each tick took ${drops.join(',')} HP (1 or 2 for MaxHp 20)`);
  // cure: violet potion (HealsPoison)
  const before = amountOf(p, VIOLET), m2 = p.mark(); useSlot(p, slotOf(p, VIOLET)!.slot); await p.sleep(1500);
  c.ok(localeIds(p, m2).includes(Msg.cured), `violet potion answered message ${Msg.cured} (cured)`);
  c.eq(before - amountOf(p, VIOLET), 1, 'the cure consumed one potion');
  const m3 = p.mark(); await p.sleep(9000); c.ok(!localeIds(p, m3).includes(Msg.poisonTick), 'no poison tick in 9 s after the cure');
  c.shared.cure = 'cured';
});

step('SUR-08', async c => {
  // HealsPoison (InvUsuario.bas otPotions): Envenenado > 0 -> cleared, message 682, one potion consumed; otherwise message 683 and NOTHING consumed.
  const p = await mage(c), slot = slotOf(p, VIOLET)!, before = slot.amount, m = p.mark();
  useSlot(p, slot.slot); await p.sleep(1500);
  c.ok(localeIds(p, m).includes(Msg.notPoisoned), `not poisoned: message ${Msg.notPoisoned} (no estas envenenado)`);
  c.eq(amountOf(p, VIOLET), before, 'nothing consumed when not poisoned');
  if (c.shared.cure !== 'cured') c.note(`the poisoned half needs SUR-09 first (cure state: ${String(c.shared.cure ?? 'SUR-09 not run')})`);
  else c.note('poisoned half: asserted in SUR-09 (message 682 and one potion consumed)');
  c.note('the paralysis-removal potion type (HealsParalysis) has no starter potion; covered by CMB-20 with the Remover Paralisis spell');
});

step('SUR-10', async c => {
  // EfectoStamina -> Sanar (General.bas): only when neither hungry nor thirsty, not Desnudo, EnCombate = 0. HPCounter counts to SanaIntervaloSinDescansar = 200 loop ticks; each heal is
  // RandomNumber(Porcentaje(MaxHp,5), Porcentaje(MaxHp,10)) = RandomNumber(1, 2) for MaxHp 20, times GetSelfHealingBonus; the client gets UpdateHP + 'Has sanado' (519).
  await dbEdit(c, 'mage', setUser('min_hp=4, min_ham=100, min_sed=100'));
  const p = c.player, m = p.mark(); await p.sleep(40_000);
  const raw = series(p, m, 'UpdateHP'); const heals = raw.filter((h, i) => i === 0 || h.p.hp !== raw[i - 1]!.p.hp); c.ok(heals.length >= 3, `${heals.length} heals in 40 s`);
  const steps = heals.slice(1).map((h, i) => h.p.hp - heals[i]!.p.hp); c.ok(steps.every(d => d >= 1 && d <= 2), `each heal +${steps.join(',')} (1..2 = 5-10% of 20)`);
  const gaps = heals.slice(1).map((h, i) => (h.t - heals[i]!.t) / 1000); c.near(Math.min(...gaps), 4, 14, `heal gaps ${gaps.map(g => g.toFixed(1)).join(', ')} s (200 loop ticks)`);
  c.ok(localeIds(p, m).includes(Msg.healed), 'message 519 Has sanado');
  c.note('resting (SanaIntervaloDescansar = 50) needs a campfire and /DESCANSAR; covered as manual in the notes of SUR-10');
});

step('SUR-11', async c => {
  // RecStamina (General.bas): every StaminaIntervaloSinDescansar = 10 loop ticks add RandomNumber(1, CInt(Porcentaje(MaxSta, Suerte)) / 1.6) with Suerte = 5 for Supervivencia 0-10:
  // Porcentaje(60,5) = 3, 3/1.6 = 1.875 -> 1 or 2 per tick for a non-Trabajador. The mage has Supervivencia 0.
  await dbEdit(c, 'mage', setUser('min_sta=5, min_ham=100, min_sed=100'));
  const p = c.player, m = p.mark(); await p.sleep(12_000);
  const s = series(p, m, 'UpdateSta'); c.ok(s.length >= 5, `${s.length} stamina updates in 12 s`);
  const inc = s.slice(1).map((x, i) => x.p.stamina - s[i]!.p.stamina); c.ok(inc.every(d => d >= 1 && d <= 2), `each regen +${inc.join(',')} (1 or 2)`);
  const gaps = s.slice(1).map((x, i) => (x.t - s[i]!.t) / 1000); c.near(Math.max(...gaps), 0.1, 2, `regen gaps max ${Math.max(...gaps).toFixed(2)} s (10 loop ticks)`);
});

/** Stamina samples as [seconds, value], collapsing repeated packets with the same value. */
const staLosses = (s: ReturnType<typeof series>) => s.filter((x, i) => i === 0 || x.p.stamina !== s[i - 1]!.p.stamina);
function assertLoss(c: Ctx, p: import('../session.js').Sess, m: number, start: number, what: string) {
  const sta = staLosses(series(p, m, 'UpdateSta'));
  c.ok(sta.length >= 4, `${what}: ${sta.length} stamina updates in 20 s`);
  const vals = [start, ...sta.map(x => x.p.stamina as number)], drops = vals.slice(1).map((v, i) => vals[i]! - v);
  c.ok(drops.every(d => d >= 1 && d <= 22), `${what}: each loss ${drops.join(',')} is within 1..22 (RandomNumber(1, Porcentaje(60, (150 - 0) * 0.25 = 37.5) = 22.5))`);
  const gaps = sta.slice(1).map((x, i) => (x.t - sta[i]!.t) / 1000); c.near(Math.min(...gaps), 1, 3, `${what}: loss gaps ${gaps.map(g => g.toFixed(1)).join(', ')} s (IntervaloPerderStamina = 40 loop ticks, about 1.6 s)`);
}

step('SUR-02', async c => {
  // Pinned General.bas EfectoStamina: HambreOSed (MinHam = 0 Or MinAGU = 0) skips Sanar and RecStamina and calls PierdeEnergia(IntervaloPerderStamina = 40 ticks): every 41st tick
  // MinSta -= RandomNumber(1, Porcentaje(MaxSta, (150 - Supervivencia) * 0.25)) = 1..22 for MaxSta 60 and Supervivencia 0. No damage: HP just stops regenerating.
  await dbEdit(c, 'mage', setUser('min_hp=5, min_sta=60, min_ham=0, min_sed=0'));
  const p = c.player, m = p.mark(); c.eq([food(c).food, food(c).water], [0, 0], 'hunger and thirst at 0'); await p.sleep(20_000);
  c.eq(series(p, m, 'UpdateHP').length, 0, 'no HP regen in 20 s (Sanar skipped) and no damage');
  assertLoss(c, p, m, 60, 'hungry and thirsty');
  c.note('scroll refusal (904 demasiado hambriento) needs a parchment: asserted in CMB-16');
  await dbEdit(c, 'mage', setUser('min_hp=20, min_sta=60, min_ham=100, min_sed=100'));
});

step('SUR-12', async c => {
  // Same branch for a NAKED character (flags.Desnudo = 1 after unequipping the armour, InvUsuario.bas Desequipar): Sanar exits at once (Desnudo) and PierdeEnergia runs instead of RecStamina.
  // Resting doubles the interval (IntervaloPerderStamina * 2) and rain outdoors halves it (* 0.5); neither is reachable here (no campfire, weather not controllable).
  await dbEdit(c, 'mage', setUser('min_hp=5, min_sta=60, min_ham=100, min_sed=100'));
  const p = c.player; c.ok(await ensureEquipped(p, 3502, true), 'tunic equipped'); c.ok(await ensureEquipped(p, 3502, false), 'tunic unequipped (naked)');
  const m = p.mark(), s0 = p.stats!.stamina; await p.sleep(20_000);
  c.eq(series(p, m, 'UpdateHP').length, 0, 'naked: no HP regen (Sanar: Desnudo = 1)');
  assertLoss(c, p, m, s0, 'naked');
  const m2 = p.mark(); c.ok(await ensureEquipped(p, 3502, true), 'tunic worn again'); await p.sleep(9000);
  const up = staLosses(series(p, m2, 'UpdateSta')).filter((x, i, a) => i > 0 && x.p.stamina > a[i - 1]!.p.stamina);
  c.ok(up.length > 0, 'dressed again: stamina rises again (RecStamina)');
  await dbEdit(c, 'mage', setUser('min_hp=20, min_sta=60'));
});

step('SUR-13', async c => {
  // UsuarioAtaca (pinned SistemaCombate.bas): MinSta < 10 -> message 93 (estas muy cansado), ChatOverHead 'no tengo energia' and NO swing; otherwise QuitarSta(RandomNumber(1, 10)) before the swing
  // (the per-swing cost is measured in CMB-01). The character is HUNGRY here (MinHam = 0) so RecStamina cannot refill the 9 points between login and the swing (SUR-02).
  await dbEdit(c, 'war', setUser('is_dead=0, min_sta=9, min_ham=0, min_sed=100, min_hp=20'));
  const p = await actor(c, 'war'); const m = p.mark(); c.ok(p.stats!.stamina < 10, `stamina ${p.stats!.stamina} (< 10)`);
  attack(p); await p.sleep(1500);
  c.ok(localeIds(p, m).includes(Msg.tired), 'stamina under 10: attack refused with message 93 (estas muy cansado)');
  c.eq(series(p, m, 'ArmaMov').length, 0, 'no swing was made');
  c.ok(p.since(m).some(r => r.name === 'ChatOverHead'), 'the no-energy bubble (ChatOverHead) was sent');
  c.note('spell, work and steal stamina costs (Dardo 2, chop/mine/fish 5, smelting 2, craft 2, steal 15) are asserted in CMB-17 for the spell; the work costs need trees, ore, a forge and a thief and stay manual');
  await dbEdit(c, 'war', setUser('min_sta=60, min_ham=100, min_sed=100'));
});

step('SUR-14', async c => c.blocked('manual: needs a fire-casting creature or spell (Incinerar needs Magia 100 and 1500 mana); EfectoIncineramiento hits random(20,30) every IntervaloFuego/4'));
step('SUR-15', async c => c.blocked('manual: needs an empty bottle and a water tile (otEmptyBottle / otFullBottle); the starter characters carry neither'));
void SK;
