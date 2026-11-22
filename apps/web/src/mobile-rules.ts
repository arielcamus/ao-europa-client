// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * Mobile mode (prototype), the pure half: the contextual-action rule table, the joystick and the zoom. Not a VB6 port: the
 * classic client has no touch layout. Everything here is deterministic so the player can predict what a tap will do, and the
 * table is printed in docs (outputs/2026-11-22-ao-mobile-ui-proposal.md) row by row with the same rule ids.
 */
import { Heading } from '@ao/protocol';

export interface MobileSpell {
  slot: number; index: number; name: string; mana: number;
  /** Hechizos.dat StaRequerido: the server refuses the cast below it ("Estás muy cansado."). */
  stamina: number;
  /** Hechizos.dat SubeHP: 1 heals, 2 damages. */
  subeHp: number; minHp: number; maxHp: number;
  /** Hechizos.dat Target: 1 user, 2 npc, 3 both, 4 terrain. */
  target: number;
  effect: 'positive' | 'negative' | 'neutral';
  removesParalysis: boolean;
}
/** `priest`: an NPC of NpcType 1 (Revividor), the one that answers /RESUCITAR and /CURAR. */
export type TargetKind = 'self' | 'hostile' | 'npc' | 'priest' | 'player' | 'none';
export interface ActionContext {
  kind: TargetKind; dead: boolean; mana: number; hp: number; maxHp: number;
  /** Current stamina; casts also cost StaRequerido. Undefined = unknown (treated as enough). */
  stamina?: number | undefined;
  /** The target is one of the four tiles next to the player (melee range). */
  adjacent: boolean; paralyzed: boolean; spells: readonly MobileSpell[];
  /** The player's pin for hostile creatures: a spell slot, or melee. */
  pinned?: number | 'melee' | undefined;
  prefer: 'magic' | 'melee';
  /** The equipped projectile weapon's inventory slot (a bow), if any. */
  rangedSlot?: number | undefined;
}
export type MobileAction =
  | { kind: 'cast'; spell: MobileSpell; rule: string }
  | { kind: 'melee'; rule: string }
  | { kind: 'ranged'; slot: number; rule: string }
  | { kind: 'look'; rule: string }
  /** LeftClick the NPC (it becomes the server's TargetNPC), then the chat command. */
  | { kind: 'command'; line: string; label: string; rule: string }
  | { kind: 'hint'; text: string; meditate: boolean; rule: string };

const num = (section: Map<string, string> | undefined, key: string) => Number.parseInt(section?.get(key) ?? '', 10) || 0;

/** One spell slot read from its Dat/Hechizos.dat section (keys lower-cased by parseIni). TargetEffectType is missing on ~40% of the spells. */
export function spellFromDat(slot: number, index: number, section: Map<string, string> | undefined): MobileSpell {
  const subeHp = num(section, 'subehp'), declared = num(section, 'targeteffecttype'), removesParalysis = num(section, 'removerparalisis') === 1;
  const effect = declared === 1 ? 'positive' : declared === 2 ? 'negative'
    : subeHp === 2 || num(section, 'paraliza') === 1 || num(section, 'inmoviliza') === 1 ? 'negative'
    : subeHp === 1 || removesParalysis ? 'positive' : 'neutral';
  return {
    slot, index, name: section?.get('nombre') ?? `Hechizo ${index}`, mana: num(section, 'manarequerido'), stamina: num(section, 'starequerido'),
    subeHp, minHp: num(section, 'minhp'), maxHp: num(section, 'maxhp'), target: num(section, 'target'), effect, removesParalysis,
  };
}

export const isOffensive = (s: MobileSpell) => s.effect === 'negative' && (s.target === 2 || s.target === 3);
export const isDamage = (s: MobileSpell) => isOffensive(s) && s.subeHp === 2;
export const isHeal = (s: MobileSpell) => s.subeHp === 1 && (s.target === 1 || s.target === 3);
const average = (s: MobileSpell) => (s.minHp + s.maxHp) / 2;
/** Strongest first; ties: cheaper, then the lower slot. */
const strongest = (a: MobileSpell, b: MobileSpell) => average(b) - average(a) || a.mana - b.mana || a.slot - b.slot;

/** The server's two cast checks the client can see: mana and stamina (StaRequerido). */
export const affordable = (s: MobileSpell, mana: number, stamina = Infinity) => s.mana <= mana && s.stamina <= stamina;
export function bestDamage(spells: readonly MobileSpell[], mana: number, stamina = Infinity): MobileSpell | undefined {
  return spells.filter(s => isDamage(s) && affordable(s, mana, stamina)).sort(strongest)[0];
}
export function bestHeal(spells: readonly MobileSpell[], mana: number, stamina = Infinity): MobileSpell | undefined {
  return spells.filter(s => isHeal(s) && affordable(s, mana, stamina)).sort(strongest)[0];
}
export function cheapestDamageCost(spells: readonly MobileSpell[]): number | undefined {
  const costs = spells.filter(isDamage).map(s => s.mana);
  return costs.length ? Math.min(...costs) : undefined;
}
/** A character that knows an attack spell plays as a caster until the player says otherwise. */
export function defaultPrefer(spells: readonly MobileSpell[]): 'magic' | 'melee' {
  return spells.some(isOffensive) ? 'magic' : 'melee';
}

const look = (rule: string): MobileAction => ({ kind: 'look', rule });
const APPROACH = 'Acercate para golpear';

/** The rule table: first match wins. Each `rule` id is a row of the table in the proposal and of mobile-rules.test.ts. */
export function chooseAction(ctx: ActionContext): MobileAction {
  // The priest asks for "click izquierdo y luego escribe /Resucitar" (seen live): one tap does both.
  if (ctx.dead && ctx.kind === 'priest') return { kind: 'command', line: '/RESUCITAR', label: 'Resucitar', rule: 'dead-priest' };
  if (ctx.dead) return look('dead');
  if (ctx.kind === 'priest' && ctx.hp < ctx.maxHp) return { kind: 'command', line: '/CURAR', label: 'Curar', rule: 'priest-heal' };
  if (ctx.kind === 'priest') return look('npc');
  if (ctx.kind === 'npc') return look('npc');
  if (ctx.kind === 'player') return look('player');
  if (ctx.kind === 'none') return look('none');
  const stamina = ctx.stamina ?? Infinity, can = (s: MobileSpell) => affordable(s, ctx.mana, stamina);
  if (ctx.kind === 'self') {
    const unparalyze = ctx.paralyzed ? ctx.spells.find(s => s.removesParalysis && can(s)) : undefined;
    if (unparalyze) return { kind: 'cast', spell: unparalyze, rule: 'self-paralysis' };
    const heal = ctx.hp < ctx.maxHp ? bestHeal(ctx.spells, ctx.mana, stamina) : undefined;
    if (heal) return { kind: 'cast', spell: heal, rule: 'self-heal' };
    return look('self-look');
  }
  // Hostile creature.
  if (ctx.pinned === 'melee') return ctx.adjacent ? { kind: 'melee', rule: 'pin-melee' } : { kind: 'hint', text: APPROACH, meditate: false, rule: 'pin-melee' };
  const pinned = typeof ctx.pinned === 'number' ? ctx.spells.find(s => s.slot === ctx.pinned) : undefined;
  if (pinned && can(pinned)) return { kind: 'cast', spell: pinned, rule: 'pin-spell' };
  const short = (s: MobileSpell) => (s.mana > ctx.mana ? `Sin maná para ${s.name}` : `Sin energía para ${s.name}`);
  if (pinned) return ctx.adjacent ? { kind: 'melee', rule: 'pin-no-mana' } : { kind: 'hint', text: short(pinned), meditate: pinned.mana > ctx.mana, rule: 'pin-no-mana' };
  const damage = bestDamage(ctx.spells, ctx.mana, stamina);
  if (ctx.prefer === 'magic' && damage) return { kind: 'cast', spell: damage, rule: 'magic' };
  if (ctx.rangedSlot !== undefined) return { kind: 'ranged', slot: ctx.rangedSlot, rule: 'ranged' };
  if (ctx.adjacent) return { kind: 'melee', rule: 'melee-adjacent' };
  if (damage) return { kind: 'cast', spell: damage, rule: 'magic-fallback' };
  // Knows attacks but cannot pay for any: say which resource is short (meditating only brings mana back).
  const lacksMana = !ctx.spells.some(s => isDamage(s) && s.mana <= ctx.mana);
  if (ctx.spells.some(isDamage)) return { kind: 'hint', text: lacksMana ? 'Sin maná' : 'Sin energía', meditate: lacksMana, rule: 'no-mana' };
  return { kind: 'hint', text: APPROACH, meditate: false, rule: 'approach' };
}

/**
 * The Meditar button: shown while meditating; with mana missing it takes the blue potion's place when there is none (AO Forever's
 * rule), and it is shown anyway when mana is under 30% or below the cheapest attack spell.
 */
export function shouldShowMeditate(s: { dead: boolean; mana: number; maxMana: number; meditating: boolean; cheapestDamageCost?: number | undefined; hasManaPotion?: boolean }): boolean {
  if (s.dead || !(s.maxMana > 0)) return false;
  if (s.meditating) return true;
  if (s.mana >= s.maxMana) return false;
  return !s.hasManaPotion || s.mana < 0.3 * s.maxMana || (s.cheapestDamageCost !== undefined && s.mana < s.cheapestDamageCost);
}

/** Four-way joystick: the dominant axis wins; nothing inside the dead zone. Screen y grows downwards. */
export function joystickHeading(dx: number, dy: number, deadZone: number): Heading | undefined {
  if (Math.hypot(dx, dy) < deadZone) return undefined;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Heading.East : Heading.West) : (dy > 0 ? Heading.South : Heading.North);
}
/**
 * The tile to click to pick the character standing on `at`: the server's LookatTile (GameLogic.bas) looks at (x, y + 1) BEFORE (x, y),
 * so clicking the feet tile of a creature that stands right above the player picks the player ("No podés atacarte a vos mismo.",
 * seen live on map 2). Clicking the tile above the feet always finds the character first.
 */
export const clickTileFor = (at: { x: number; y: number }) => ({ x: at.x, y: at.y > 1 ? at.y - 1 : at.y });
export const isAdjacent = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
export function headingTowards(from: { x: number; y: number }, to: { x: number; y: number }): Heading | undefined {
  if (!isAdjacent(from, to)) return undefined;
  return to.x > from.x ? Heading.East : to.x < from.x ? Heading.West : to.y > from.y ? Heading.South : Heading.North;
}

export type ZoomLevel = 'cerca' | 'medio' | 'lejos';
export const ZOOM_LEVELS: readonly ZoomLevel[] = ['cerca', 'medio', 'lejos'];
/** frmMain's world is 736x608 (23x19 tiles of 32 px). */
export const VIEW_W = 736, VIEW_H = 608;
/**
 * Fewest whole tiles each zoom level keeps on screen. Portrait counts tiles ACROSS (the narrow side), landscape counts tiles
 * DOWN and across: `cerca` in landscape is the classic server view range, 17x13 tiles (RANGO_VISION 8/6 around the player).
 */
export const ZOOM_TILES: Readonly<Record<'portrait' | 'landscape', Record<ZoomLevel, { w: number; h: number }>>> = {
  portrait: { cerca: { w: 11, h: 0 }, medio: { w: 15, h: 0 }, lejos: { w: 23, h: 19 } },
  landscape: { cerca: { w: 17, h: 13 }, medio: { w: 21, h: 17 }, lejos: { w: 23, h: 19 } },
};
/**
 * CSS scale of the 736x608 world for a world area of areaW x areaH CSS px on a screen with `dpr` device pixels per CSS px.
 * The largest scale that still shows the level's tiles (ZOOM_TILES; tablets, short side >= 600, add 4 tiles each way), snapped
 * DOWN to a crisp one: a whole number of device pixels per art pixel (zoom * dpr is an integer), so pixelated scaling never
 * doubles one art pixel and not its neighbour. When the snap would cost more than 20% of the size (a dpr-1 screen, or `lejos`
 * on a phone) the exact fit is used instead: readable beats crisp.
 */
export function mobileZoom(areaW: number, areaH: number, level: ZoomLevel, dpr = 1): number {
  if (!(areaW > 0 && areaH > 0)) return 1;
  const orientation = areaW > areaH ? 'landscape' : 'portrait', extra = Math.min(areaW, areaH) >= 600 && level !== 'lejos' ? 4 : 0;
  const want = ZOOM_TILES[orientation][level];
  const fits = [areaW / ((want.w + extra) * 32)];
  if (want.h) fits.push(areaH / ((want.h + extra) * 32));
  const raw = Math.min(...fits);
  return crispZoom(raw, dpr);
}
/** `raw` snapped down to k/dpr (k whole), unless that loses more than 20%. */
export function crispZoom(raw: number, dpr: number): number {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const snapped = Math.floor(raw * ratio + 1e-6) / ratio;
  return snapped > 0 && snapped >= raw * 0.8 ? snapped : raw;
}

/** Dat/npcs.dat [NPCn]: attackable creatures are the targets of a plain tap; merchants, bankers and priests only get a LeftClick. */
export function hostility(section: Map<string, string> | undefined): 'hostile' | 'npc' | 'priest' {
  if (!section) return 'npc';
  const type = section.get('npctype');
  if (type === '1') return 'priest';
  // Guards (Imperial 2, Chaos 8) carry Hostile=1 too, and trainers, bankers and the other service NPCs are never a tap target.
  // Only common creatures (0) and dragons (6) are; the review found NPC 260/261/271/981 (guards) would have been attacked.
  if (type !== undefined && type !== '0' && type !== '6') return 'npc';
  if (section.get('hostile') === '1') return 'hostile';
  return section.get('attackable') === '1' && section.get('comercia') !== '1' && (type === undefined || type === '0') ? 'hostile' : 'npc';
}
