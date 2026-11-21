// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * Mobile mode (prototype): a separate in-world layout for phones and tablets, inspired by AO Forever's mobile client. NOT a VB6
 * form: the classic client has no touch layout, so this is the one deliberate departure from the pinned UI, and it only applies
 * while the player chooses it (auto on touch screens, `?layout=mobile|classic`, or the toggles). Desktop stays classic.
 *
 * It moves three existing nodes (#viewport, #console, #chat-form) into a full-screen layer and scales the 736x608 world with CSS,
 * so every overlay inside the viewport (bubbles, combat text, party frames, signs) keeps its coordinates and renderer.tileAt (which
 * reads getBoundingClientRect) maps taps to tiles unchanged. The protocol is untouched: every action is an existing session call.
 * The decisions are the pure rule table in mobile-rules.ts.
 */
import './mobile-mode.css';
import { Heading, MAGIC_SKILL } from '@ao/protocol';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';
import type { ClassicUI } from './classic-ui.js';
import type { Character } from './characters.js';
import { fetchText, parseIni } from './assets.js';
import type { Ini } from './assets.js';
import { sharedLocale } from './chat-locale.js';
import { PROJECTILE_SKILL } from './spells.js';
import { ObjType } from './object-catalog.js';
import { windows } from './window-stack.js';
import {
  VIEW_H, VIEW_W, ZOOM_LEVELS, affordable, chooseAction, clickTileFor, cheapestDamageCost, defaultPrefer, headingTowards, hostility, isAdjacent, isDamage, isHeal,
  isOffensive, joystickHeading, mobileZoom, shouldShowMeditate, spellFromDat,
} from './mobile-rules.js';
import type { ActionContext, MobileAction, MobileSpell, TargetKind, ZoomLevel } from './mobile-rules.js';

export interface MobileDeps {
  session: () => Session | undefined;
  renderer: WorldRenderer;
  ui: ClassicUI;
  /** main.ts attack(): the attack key (WriteAttack in the facing direction). */
  attack: () => void;
  /** main.ts gameKey(Meditate) and gameKey(ExitGame): the same checks as the keys. */
  meditate: () => void;
  exitGame: () => void;
  guard: (action: () => unknown) => void;
  /** The classic tap on a tile without a character: the door rule, else LeftClick on the tile. */
  leftClickAt: (event: PointerEvent) => void;
  /** Sign anchoring and the other "a world click closes X" side effects of the classic handler. */
  worldTapped: (event: PointerEvent) => void;
  openWorldMap: () => void;
  /** main.ts runCommand: a chat command line (/RESUCITAR, /CURAR) through the classic parser. */
  runCommand: (line: string) => void;
  dropSelected: () => void;
}
type Layout = 'mobile' | 'classic';
interface Pending { charIndex: number; skill: number; until: number }
interface Target { charIndex: number; kind: TargetKind }

const LONG_PRESS_MS = 450, TAP_SLOP = 14, JOY_RADIUS = 52, JOY_DEAD = 14;
/** Objects that lie on a tile but are not loot: trees, doors, signs, deposits, decoration, anvils, forges, teleports. */
const NOT_LOOT: readonly number[] = [ObjType.Trees, ObjType.Doors, ObjType.Signs, ObjType.Deposits, ObjType.Decoration, ObjType.Anvil, ObjType.Forge, ObjType.Teleport];
const storage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string | undefined) { try { if (value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode */ } },
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const button = (id: string, label: string, text = '') => {
  const b = el('button', { type: 'button', id, className: 'm-btn' });
  b.setAttribute('aria-label', label); b.textContent = text;
  return b;
};

/** URL wins (and is remembered), then the saved choice, then touch screens up to tablet size. */
export function initialLayout(): Layout {
  const asked = new URLSearchParams(location.search).get('layout');
  if (asked === 'mobile' || asked === 'classic') { storage.set('ao.layout', asked); return asked; }
  const saved = storage.get('ao.layout');
  if (saved === 'mobile' || saved === 'classic') return saved;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && Math.min(screen.width, screen.height) < 1100 ? 'mobile' : 'classic';
}

export class MobileMode {
  /** Read by main.ts's ticker next to the keys: the joystick's heading, undefined at rest. */
  heading: Heading | undefined;
  private layout: Layout = initialLayout();
  private active = false;
  private zoom: ZoomLevel = (ZOOM_LEVELS as readonly string[]).includes(storage.get('ao.mobileZoom') ?? '') ? storage.get('ao.mobileZoom') as ZoomLevel : 'cerca';
  private readonly root = el('div', { id: 'mobile-layer' });
  private readonly world = el('div', { id: 'mobile-world' });
  private readonly consoleBox = el('div', { id: 'mobile-console' });
  private readonly chatBox = el('div', { id: 'mobile-chat' });
  private readonly deck = el('div', { id: 'mobile-deck' });
  private readonly joyZone = el('div', { id: 'mobile-joystick' });
  private readonly joyBase = el('div', { className: 'm-joy-base' });
  private readonly joyKnob = el('div', { className: 'm-joy-knob' });
  private readonly actions = el('div', { id: 'mobile-actions' });
  private readonly act = button('m-act', 'Acción');
  private readonly meditateButton = button('m-meditate', 'Meditar', 'Meditar');
  private readonly pickupButton = button('m-pickup', 'Agarrar', 'Agarrar');
  private readonly hpPotion = button('m-potion-hp', 'Poción de vida');
  private readonly manaPotion = button('m-potion-mana', 'Poción de maná');
  private readonly drawerButton = button('m-drawer-btn', 'Hechizos e inventario', '🎒');
  private readonly top = el('div', { id: 'mobile-top' });
  private readonly drawer = el('div', { id: 'mobile-drawer', hidden: true });
  private readonly picker = el('div', { id: 'mobile-picker', hidden: true });
  private readonly ring = el('div', { id: 'm-target-ring', hidden: true });
  private readonly toggle = button('mobile-toggle', 'Modo móvil', 'Modo móvil');
  private moved: { node: HTMLElement; parent: Node; next: Node | null }[] = [];
  private joyPointer: number | undefined;
  private press: { id: number; x: number; y: number; timer: number; fired: boolean; event: PointerEvent } | undefined;
  private pending: Pending | undefined;
  private target: Target | undefined;
  private drinking: { kind: 'hp' | 'mana' } | undefined;
  private lastDrink = -Infinity;
  private drawerTab: 'spells' | 'inventory' | 'menu' = 'spells';
  private drawerRevision = -1;
  private lastHint = { text: '', at: -Infinity };
  private npcTable: Ini | undefined;
  private npcLoading = false;
  private readonly art = new Map<number, Promise<HTMLCanvasElement>>();

  constructor(private readonly deps: MobileDeps) {
    this.build();
    for (const name of ['resize', 'orientationchange']) window.addEventListener(name, () => { if (this.active) requestAnimationFrame(() => this.applyZoom()); });
    const release = () => this.releaseJoystick();
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    windows.watchElement('mobile-drawer', this.drawer, () => this.closeDrawer());
    windows.watchElement('mobile-picker', this.picker, () => { this.picker.hidden = true; });
    // `?debug`: live checks (tools/mobile-mode-real-shot.mjs) read where each character is drawn and what a tap on it would do.
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { aoMobile: unknown }).aoMobile = { chars: () => this.debugChars() };
  }
  private debugChars() {
    const session = this.deps.session(), self = session?.visualPosition(performance.now());
    const view = document.getElementById('viewport')?.getBoundingClientRect();
    if (!session || !self || !view) return [];
    const k = view.width / VIEW_W, cameraX = self.x * 32 + 16 - VIEW_W / 2, cameraY = self.y * 32 + 16 - VIEW_H / 2;
    return [...session.tracker.chars.values()].map(c => {
      const target = { charIndex: c.charIndex, kind: this.kindOf(session, c) };
      return {
        charIndex: c.charIndex, name: c.name, npcNumber: c.npcNumber, x: c.x, y: c.y, kind: target.kind, rule: this.decide(session, target).rule,
        clientX: view.left + (c.x * 32 + 16 - cameraX) * k, clientY: view.top + (c.y * 32 + 16 - cameraY) * k,
      };
    });
  }
  get layoutChoice(): Layout { return this.layout; }
  /** The mobile layout is on screen (the player is in the world and chose it). */
  get worldActive() { return this.active; }

  setLayout(layout: Layout) {
    this.layout = layout; storage.set('ao.layout', layout);
    document.documentElement.classList.toggle('mobile-mode', layout === 'mobile');
  }

  /** Every ~100 ms from main.ts updateUi: enter/leave the layout, refresh the HUD. */
  update(session: Session | undefined, playing: boolean) {
    document.documentElement.classList.toggle('mobile-mode', this.layout === 'mobile');
    const want = this.layout === 'mobile' && playing && !!session;
    if (want !== this.active) { if (want) this.enter(); else this.leave(); }
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.toggle.hidden = !(playing && this.layout === 'classic' && coarse);
    if (!this.active || !session) return;
    this.refreshHud(session);
    if (!this.drawer.hidden && session.ui.revision !== this.drawerRevision) this.renderDrawer(session);
  }

  /** Every frame from main.ts's ticker: the auto-target of a cast the mobile layout started, potion drinking, the target ring. */
  tick(session: Session | undefined, now: number) {
    if (!this.active || !session) return;
    const pending = this.pending;
    if (pending && now > pending.until) this.pending = undefined;
    else if (pending && session.spells.targeting?.skill === pending.skill) {
      const at = pending.charIndex === session.charIndex ? session.position : session.tracker.chars.get(pending.charIndex);
      this.pending = undefined;
      this.deps.guard(() => { if (at) { const tile = clickTileFor(at); session.spells.click(tile.x, tile.y); } else session.spells.cancel(); });
    }
    if (this.drinking) this.drink(session);
    this.placeRing(session, now);
  }

  /** The viewport's pointerdown, before the classic handler: true when the mobile layout took the event. */
  worldPointerDown(event: PointerEvent): boolean {
    if (!this.active) return false;
    const session = this.deps.session();
    event.preventDefault();
    if (!session?.ready) return true;
    this.picker.hidden = true;
    if (this.press) clearTimeout(this.press.timer);
    const press = { id: event.pointerId, x: event.clientX, y: event.clientY, fired: false, event, timer: 0 };
    const long = () => {
      press.fired = true;
      const hit = this.hit(session, press.event);
      if (hit) this.openPicker(session, hit, press.x, press.y);
    };
    press.timer = window.setTimeout(long, LONG_PRESS_MS);
    this.press = press;
    const move = (e: PointerEvent) => { if (e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) end(e, true); };
    const end = (e: PointerEvent, cancelled = e.type !== 'pointerup') => {
      if (e.pointerId !== press.id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      clearTimeout(press.timer);
      if (this.press === press) this.press = undefined;
      // A busy main thread (a phone, or this Mac under load) can deliver the release before the timer: the press length decides.
      if (!cancelled && !press.fired) { if (e.timeStamp - press.event.timeStamp >= LONG_PRESS_MS) long(); else this.tap(session, press.event); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return true;
  }

  // ---- layout ----

  private enter() {
    this.active = true;
    document.documentElement.classList.add('mobile-world');
    const take = (id: string, into: HTMLElement) => {
      const node = document.getElementById(id);
      if (!node || !node.parentNode) return;
      this.moved.push({ node, parent: node.parentNode, next: node.nextSibling });
      into.append(node);
    };
    take('viewport', this.world); take('console', this.consoleBox); take('chat-form', this.chatBox);
    document.getElementById('viewport')?.append(this.ring);
    void this.loadNpcTable(); // before the first tap, so a creature is never taken for a merchant
    this.applyZoom();
  }
  private leave() {
    this.active = false;
    this.releaseJoystick(); this.closeDrawer(); this.picker.hidden = true; this.pending = undefined; this.target = undefined; this.drinking = undefined;
    this.ring.remove();
    for (const { node, parent, next } of this.moved.reverse()) parent.insertBefore(node, next && next.parentNode === parent ? next : null);
    this.moved = [];
    document.documentElement.classList.remove('mobile-world');
    window.dispatchEvent(new Event('resize')); // classic-layout refits the 1024x768 window
  }
  private applyZoom() {
    const rect = this.world.getBoundingClientRect();
    this.root.style.setProperty('--mobile-zoom', String(mobileZoom(rect.width, rect.height, this.zoom)));
    // Classic windows (bank, shop, quests...) stay children of the 1024x768 box, centred over the screen at a readable scale.
    const scale = Math.max(0.5, Math.min(1.5, innerWidth / 560, innerHeight / 600));
    const style = document.documentElement.style;
    style.setProperty('--mobile-window-scale', String(scale));
    style.setProperty('--mobile-window-left', `${(innerWidth - 1024 * scale) / 2}px`);
    style.setProperty('--mobile-window-top', `${(innerHeight - 768 * scale) / 2}px`);
    this.top.querySelector('#m-zoom')!.textContent = `🔍 ${this.zoom}`;
  }

  private build() {
    const { root, world, deck, joyZone, actions } = this;
    joyZone.append(this.joyBase); this.joyBase.append(this.joyKnob); this.joyBase.hidden = true;
    joyZone.append(el('div', { className: 'm-joy-hint' }));
    actions.append(this.act, this.meditateButton, this.pickupButton, this.hpPotion, this.manaPotion, this.drawerButton);
    this.act.innerHTML = '<span class="m-act-label">Golpe</span><span class="m-act-sub"></span>';
    this.act.append(el('span', { className: 'm-pin', hidden: true }, '📌'));
    for (const potion of [this.hpPotion, this.manaPotion]) potion.append(el('span', { className: 'm-art' }), el('span', { className: 'm-count' }));
    deck.append(joyZone, actions);
    this.top.innerHTML = `
      <div class="m-who"><span id="m-name"></span> <span id="m-level"></span></div>
      <div class="m-bars">
        <div class="m-bar m-hp"><i></i><span id="m-hp-text"></span></div>
        <div class="m-bar m-mana"><i></i><span id="m-mana-text"></span></div>
      </div>
      <div class="m-where"><span id="m-map"></span> <span id="m-coords"></span></div>
      <div class="m-top-buttons">
        <button type="button" class="m-btn m-small" id="m-chat" aria-label="Chat">💬</button>
        <button type="button" class="m-btn m-small" id="m-zoom" aria-label="Zoom"></button>
        <button type="button" class="m-btn m-small" id="m-menu" aria-label="Menú">☰</button>
      </div>`;
    root.append(world, this.top, this.consoleBox, this.chatBox, deck, this.drawer, this.picker);
    document.body.append(root, this.toggle);
    this.toggle.hidden = true;
    this.toggle.onclick = () => this.setLayout('mobile');

    this.top.querySelector<HTMLElement>('#m-chat')!.onclick = () => document.getElementById('chat-open')?.click();
    this.top.querySelector<HTMLElement>('#m-zoom')!.onclick = () => {
      this.zoom = ZOOM_LEVELS[(ZOOM_LEVELS.indexOf(this.zoom) + 1) % ZOOM_LEVELS.length]!; storage.set('ao.mobileZoom', this.zoom); this.applyZoom();
    };
    this.top.querySelector<HTMLElement>('#m-menu')!.onclick = () => this.openDrawer('menu');
    this.consoleBox.addEventListener('click', () => this.consoleBox.classList.toggle('expanded'));

    // Joystick: floating, where the thumb lands; only its own pointer, so the other thumb can tap the world and the buttons.
    joyZone.addEventListener('pointerdown', event => {
      if (this.joyPointer !== undefined) return;
      event.preventDefault(); this.joyPointer = event.pointerId; joyZone.setPointerCapture(event.pointerId);
      const zone = joyZone.getBoundingClientRect();
      this.joyBase.hidden = false;
      this.joyBase.style.left = `${event.clientX - zone.left}px`; this.joyBase.style.top = `${event.clientY - zone.top}px`;
      this.joyBase.dataset.x = String(event.clientX); this.joyBase.dataset.y = String(event.clientY);
      this.moveKnob(0, 0);
    });
    joyZone.addEventListener('pointermove', event => {
      if (event.pointerId !== this.joyPointer) return;
      const dx = event.clientX - Number(this.joyBase.dataset.x), dy = event.clientY - Number(this.joyBase.dataset.y);
      this.moveKnob(dx, dy);
      this.heading = joystickHeading(dx, dy, JOY_DEAD);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      joyZone.addEventListener(name, event => { if (event.pointerId === this.joyPointer) this.releaseJoystick(); });
    }

    this.bindPress(this.act, () => this.primary(), () => {
      const session = this.deps.session();
      if (!session) return;
      const target = this.liveTarget(session) ?? { charIndex: -1, kind: 'hostile' as TargetKind };
      const r = this.act.getBoundingClientRect();
      this.openPicker(session, target, r.left, r.top);
    });
    this.meditateButton.onclick = () => this.deps.meditate();
    this.pickupButton.onclick = () => { const s = this.deps.session(); if (s) this.deps.guard(() => s.itemActions.pickUp()); };
    this.hpPotion.onclick = () => this.togglePotion('hp');
    this.manaPotion.onclick = () => this.togglePotion('mana');
    this.drawerButton.onclick = () => (this.drawer.hidden ? this.openDrawer(this.drawerTab) : this.closeDrawer());
  }
  private moveKnob(dx: number, dy: number) {
    const d = Math.hypot(dx, dy), k = d > JOY_RADIUS ? JOY_RADIUS / d : 1;
    this.joyKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }
  private releaseJoystick() {
    this.heading = undefined; this.joyPointer = undefined; this.joyBase.hidden = true;
  }
  /** Tap and long-press on a control. */
  private bindPress(node: HTMLElement, tap: () => void, long: () => void) {
    let timer = 0, fired = false, down = 0;
    node.addEventListener('pointerdown', event => { event.preventDefault(); fired = false; down = event.timeStamp; timer = window.setTimeout(() => { fired = true; long(); }, LONG_PRESS_MS); });
    node.addEventListener('pointerup', event => { clearTimeout(timer); if (!fired) { if (event.timeStamp - down >= LONG_PRESS_MS) long(); else tap(); } });
    for (const name of ['pointercancel', 'pointerleave'] as const) node.addEventListener(name, () => clearTimeout(timer));
    node.addEventListener('contextmenu', event => event.preventDefault());
  }

  // ---- targets and the rule table ----

  private async loadNpcTable() {
    if (this.npcTable || this.npcLoading) return;
    this.npcLoading = true;
    try { this.npcTable = parseIni(await fetchText('Dat/npcs.dat')); } catch { /* unknown NPCs stay "look only" */ } finally { this.npcLoading = false; }
  }
  private kindOf(session: Session, c: Character): TargetKind {
    if (c.charIndex === session.charIndex) return 'self';
    if (c.npcNumber > 0) {
      if (!this.npcTable) { void this.loadNpcTable(); return 'npc'; } // until the table is in, nothing is attacked by mistake
      return hostility(this.npcTable.get(`npc${c.npcNumber}`));
    }
    return 'player';
  }
  /** The character under a tap: its feet tile, or the tile above (the sprite is two tiles tall), the exact tile first. */
  private hit(session: Session, event: PointerEvent): Target | undefined {
    const tile = this.deps.renderer.tileAt(session, event.clientX, event.clientY, performance.now());
    if (!tile) return undefined;
    const chars = [...session.tracker.chars.values()];
    // A walking character is drawn between its old and new tile while the tracker already holds the new one: the old tile counts too.
    const on = (ch: Character, dy: number) => (ch.x === tile.x && ch.y === tile.y + dy) || (!!ch.motion && ch.motion.from.x === tile.x && ch.motion.from.y === tile.y + dy);
    // The head match is only for others: the tile right above the player is a door, a sign or the ground, never the player.
    const c = chars.find(ch => on(ch, 0)) ?? chars.find(ch => ch.charIndex !== session.charIndex && on(ch, 1));
    return c ? { charIndex: c.charIndex, kind: this.kindOf(session, c) } : undefined;
  }
  private liveTarget(session: Session): Target | undefined {
    const t = this.target;
    if (!t || !session.tracker.chars.has(t.charIndex)) return undefined;
    return { charIndex: t.charIndex, kind: this.kindOf(session, session.tracker.chars.get(t.charIndex)!) };
  }
  spells(session: Session): MobileSpell[] {
    return [...session.ui.spells.values()].filter(s => s.index > 0).map(s => spellFromDat(s.slot, s.index, sharedLocale.spellData.get(`hechizo${s.index}`)));
  }
  private charKey(session: Session) { return session.self?.name ?? ''; }
  private pinned(session: Session): number | 'melee' | undefined {
    const value = storage.get(`ao.mobilePin.${this.charKey(session)}`);
    return value === 'melee' ? 'melee' : value ? Number(value) : undefined;
  }
  private prefer(session: Session, spells: MobileSpell[]): 'magic' | 'melee' {
    const value = storage.get(`ao.mobilePrefer.${this.charKey(session)}`);
    return value === 'magic' || value === 'melee' ? value : defaultPrefer(spells);
  }
  private rangedSlot(session: Session): number | undefined {
    for (const [slot, item] of session.ui.inventory) {
      const info = item.equipped ? session.catalog?.get(item.object) : undefined;
      if (info?.type === ObjType.Weapon && info.projectile) return slot;
    }
    return undefined;
  }
  private context(session: Session, target: Target): ActionContext {
    const c = session.tracker.chars.get(target.charIndex), self = session.position, stats = session.ui.stats, spells = this.spells(session);
    return {
      kind: target.kind, dead: session.dead, mana: stats.mana ?? 0, hp: stats.hp ?? 0, maxHp: stats.maxHp ?? 0, stamina: stats.stamina,
      adjacent: !!(c && self && isAdjacent(self, c)), paralyzed: session.status.paralyzed, spells,
      pinned: this.pinned(session), prefer: this.prefer(session, spells), rangedSlot: this.rangedSlot(session),
    };
  }
  private decide(session: Session, target: Target): MobileAction { return chooseAction(this.context(session, target)); }

  private tap(session: Session, event: PointerEvent) {
    this.deps.worldTapped(event);
    const hit = this.hit(session, event);
    // The server is waiting for a target the player armed from the drawer (or a work tool): this tap is that target.
    if (session.spells.targeting && !this.pending) {
      const c = hit && (hit.charIndex === session.charIndex ? session.position : session.tracker.chars.get(hit.charIndex));
      const tile = c ? clickTileFor(c) : this.deps.renderer.tileAt(session, event.clientX, event.clientY, performance.now());
      if (tile) this.deps.guard(() => session.spells.click(tile.x, tile.y));
      return;
    }
    if (!hit) { this.deps.leftClickAt(event); return; }
    this.target = hit;
    this.perform(session, hit, this.decide(session, hit));
  }
  /** The big button: repeat on the current target, or the attack key when there is none. */
  private primary() {
    const session = this.deps.session();
    if (!session?.ready) return;
    const target = this.liveTarget(session);
    if (!target) { this.deps.attack(); return; }
    this.perform(session, target, this.decide(session, target));
  }
  private perform(session: Session, target: Target, action: MobileAction) {
    const c = target.charIndex === session.charIndex ? session.position : session.tracker.chars.get(target.charIndex);
    if (!c) return;
    const now = performance.now();
    this.deps.guard(() => {
      switch (action.kind) {
        case 'cast':
          if (session.spells.cast(action.spell.slot, action.spell.name)) this.pending = { charIndex: target.charIndex, skill: MAGIC_SKILL, until: now + 1500 };
          this.drinking = undefined; // AO Forever: casting stops the potion loop
          return;
        case 'ranged':
          if (session.itemActions.useKey(action.slot)) this.pending = { charIndex: target.charIndex, skill: PROJECTILE_SKILL, until: now + 1500 };
          return;
        case 'melee': {
          const self = session.position, heading = self && headingTowards(self, c);
          if (heading && session.self && session.self.heading !== heading) session.walk(heading); // the tile is occupied: walk() only turns (ChangeHeading)
          this.deps.attack();
          return;
        }
        case 'look': { const tile = clickTileFor(c); session.leftClick(tile.x, tile.y); return; }
        case 'command': { const tile = clickTileFor(c); session.leftClick(tile.x, tile.y); this.deps.runCommand(action.line); return; }
        case 'hint':
          if (action.text !== this.lastHint.text || now - this.lastHint.at > 2000) { session.ui.message(action.text); this.lastHint = { text: action.text, at: now }; }
          if (action.meditate) { this.meditateButton.classList.remove('flash'); void this.meditateButton.offsetWidth; this.meditateButton.classList.add('flash'); }
      }
    });
  }

  // ---- potions ----

  private potionSlot(session: Session, kind: 'hp' | 'mana'): number | undefined {
    for (const [slot, item] of [...session.ui.inventory].sort((a, b) => a[0] - b[0])) {
      const info = session.catalog?.get(item.object);
      if (info?.type !== ObjType.Potions) continue;
      const type = session.catalog?.ini.get(`obj${item.object}`)?.get('tipopocion');
      const match = type ? type === (kind === 'hp' ? '3' : '4') : (kind === 'hp' ? /vida|health/i : /man[aá]/i).test(info.name);
      if (match) return slot;
    }
    return undefined;
  }
  /** AO Forever: one tap keeps drinking (paced by the server's item interval inside useKey) until the bar is full; a second tap stops. */
  private togglePotion(kind: 'hp' | 'mana') {
    this.drinking = this.drinking?.kind === kind ? undefined : { kind };
    const session = this.deps.session();
    if (session && this.drinking) this.drink(session);
  }
  private drink(session: Session) {
    const kind = this.drinking!.kind, stats = session.ui.stats;
    const [value, max] = kind === 'hp' ? [stats.hp ?? 0, stats.maxHp ?? 0] : [stats.mana ?? 0, stats.maxMana ?? 0];
    const slot = this.potionSlot(session, kind);
    if (slot === undefined || value >= max || session.dead) { this.drinking = undefined; return; }
    // useKey paces itself by the server's IntervaloUsarItem, which is 0 until the Intervals packet: never more than ~4 a second here.
    const now = performance.now();
    if (now - this.lastDrink < Math.max(250, session.items.intervals.useItemKey)) return;
    this.lastDrink = now;
    this.deps.guard(() => session.itemActions.useKey(slot));
  }

  // ---- HUD ----

  private paintArt(holder: Element, grh: number) {
    if ((holder as HTMLElement).dataset.grh === String(grh)) return;
    (holder as HTMLElement).dataset.grh = String(grh);
    let art = this.art.get(grh);
    if (!art) { art = this.deps.ui.itemArt(grh); this.art.set(grh, art); }
    void art.then(source => {
      if ((holder as HTMLElement).dataset.grh !== String(grh)) return;
      const copy = el('canvas', { width: 32, height: 32 });
      copy.getContext('2d')!.drawImage(source, 0, 0);
      holder.replaceChildren(copy);
    }).catch(() => undefined);
  }
  private refreshHud(session: Session) {
    const stats = session.ui.stats, q = (id: string) => this.top.querySelector<HTMLElement>(`#${id}`)!;
    const hp = stats.hp ?? 0, maxHp = stats.maxHp ?? 0, mana = stats.mana ?? 0, maxMana = stats.maxMana ?? 0;
    q('m-name').textContent = session.self?.name ?? ''; q('m-level').textContent = stats.level ? `Nv ${stats.level}` : '';
    q('m-hp-text').textContent = `${hp}/${maxHp}`; q('m-mana-text').textContent = `${mana}/${maxMana}`;
    this.top.querySelector<HTMLElement>('.m-hp i')!.style.width = `${maxHp ? (100 * hp) / maxHp : 0}%`;
    this.top.querySelector<HTMLElement>('.m-mana i')!.style.width = `${maxMana ? (100 * mana) / maxMana : 0}%`;
    this.top.querySelector<HTMLElement>('.m-mana')!.hidden = maxMana <= 0;
    q('m-map').textContent = this.deps.renderer.mapName;
    q('m-coords').textContent = session.position ? `${session.map} · ${session.position.x},${session.position.y}` : '';

    const spells = this.spells(session);
    const hpSlot = this.potionSlot(session, 'hp'), manaSlot = this.potionSlot(session, 'mana');
    // AO Forever: the flasks show only when the bar is not full.
    this.potionButton(session, this.hpPotion, hpSlot, hp < maxHp, hp < 0.35 * maxHp, this.drinking?.kind === 'hp');
    this.potionButton(session, this.manaPotion, manaSlot, mana < maxMana, mana < 0.35 * maxMana, this.drinking?.kind === 'mana');
    const meditating = session.skills.meditating;
    this.meditateButton.hidden = !shouldShowMeditate({ dead: session.dead, mana, maxMana, meditating, cheapestDamageCost: cheapestDamageCost(spells), hasManaPotion: manaSlot !== undefined });
    this.meditateButton.textContent = meditating ? 'Meditando…' : 'Meditar';
    this.meditateButton.classList.toggle('on', meditating);
    const position = session.position, object = position && session.mapObjects.objectAt(position.x, position.y);
    const type = object ? session.catalog?.get(object.objIndex)?.type : undefined;
    this.pickupButton.hidden = !object || session.dead || (type !== undefined && NOT_LOOT.includes(type));

    // The big button says what a tap does now.
    const target = this.liveTarget(session), action = target ? this.decide(session, target) : undefined;
    const label = this.act.querySelector<HTMLElement>('.m-act-label')!, sub = this.act.querySelector<HTMLElement>('.m-act-sub')!;
    const [main, small] = !action ? ['Golpe', 'sin objetivo']
      : action.kind === 'cast' ? [action.spell.name, `${action.spell.mana} maná`]
      : action.kind === 'melee' ? ['Golpe', 'cuerpo a cuerpo']
      : action.kind === 'ranged' ? ['Disparar', 'arco']
      : action.kind === 'command' ? [action.label, action.line]
      : action.kind === 'look' ? ['Mirar', target?.kind === 'npc' || target?.kind === 'priest' ? 'hablar' : '']
      : ['…', action.text];
    label.textContent = main; sub.textContent = small;
    this.act.title = action ? `Regla: ${action.rule}` : 'Regla: sin objetivo (tecla de ataque)';
    this.act.dataset.rule = action?.rule ?? 'no-target';
    this.act.dataset.kind = action?.kind ?? 'melee';
    const pin = this.pinned(session), pinBadge = this.act.querySelector<HTMLElement>('.m-pin')!;
    pinBadge.hidden = pin === undefined;
    pinBadge.title = pin === 'melee' ? 'Fijado: golpe' : pin !== undefined ? `Fijado: ${spells.find(s => s.slot === pin)?.name ?? ''}` : '';
  }
  private potionButton(session: Session, node: HTMLElement, slot: number | undefined, missing: boolean, low: boolean, drinking: boolean) {
    const item = slot !== undefined ? session.ui.inventory.get(slot) : undefined;
    node.hidden = !item || !missing || session.dead;
    node.classList.toggle('low', low); node.classList.toggle('on', drinking);
    if (!item) return;
    const grh = session.catalog?.get(item.object)?.grh ?? 0;
    if (grh) this.paintArt(node.querySelector('.m-art')!, grh);
    node.querySelector('.m-count')!.textContent = String(item.amount);
  }
  private placeRing(session: Session, now: number) {
    const target = this.liveTarget(session), self = session.visualPosition(now);
    const c = target && session.tracker.chars.get(target.charIndex);
    if (!target || !c || !self) { this.ring.hidden = true; return; }
    const at = target.charIndex === session.charIndex ? self : session.tracker.visualPosition(c, now);
    const cameraX = self.x * 32 + 16 - VIEW_W / 2, cameraY = self.y * 32 + 16 - VIEW_H / 2;
    this.ring.hidden = false;
    this.ring.style.left = `${Math.round(at.x * 32 - cameraX)}px`; this.ring.style.top = `${Math.round(at.y * 32 - cameraY)}px`;
    this.ring.dataset.kind = target.kind;
  }

  // ---- drawer and picker ----

  private openDrawer(tab: 'spells' | 'inventory' | 'menu') {
    this.drawerTab = tab; this.drawer.hidden = false; this.drawerRevision = -1;
    const session = this.deps.session();
    if (session) this.renderDrawer(session);
  }
  private closeDrawer() { this.drawer.hidden = true; }
  private renderDrawer(session: Session) {
    this.drawerRevision = session.ui.revision;
    const tabs = el('div', { className: 'm-tabs' });
    for (const [key, name] of [['spells', 'Hechizos'], ['inventory', 'Inventario'], ['menu', 'Menú']] as const) {
      const t = el('button', { type: 'button', className: `m-tab${this.drawerTab === key ? ' on' : ''}` }, name);
      t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(this.drawerTab === key));
      t.onclick = () => this.openDrawer(key);
      tabs.append(t);
    }
    const close = el('button', { type: 'button', className: 'm-close' }, '✕');
    close.setAttribute('aria-label', 'Cerrar'); close.onclick = () => this.closeDrawer();
    tabs.append(close);
    const body = el('div', { className: 'm-drawer-body' });
    if (this.drawerTab === 'spells') this.renderSpells(session, body);
    else if (this.drawerTab === 'inventory') this.renderInventory(session, body);
    else this.renderMenu(body);
    this.drawer.replaceChildren(tabs, body);
  }
  private renderSpells(session: Session, body: HTMLElement) {
    const spells = this.spells(session), mana = session.ui.stats.mana ?? 0, pin = this.pinned(session), prefer = this.prefer(session, spells);
    const seg = el('div', { className: 'm-segment' }, el('span', {}, 'Preferir:'));
    for (const [value, name] of [['magic', 'Magia'], ['melee', 'Golpe']] as const) {
      const b = el('button', { type: 'button', className: prefer === value ? 'on' : '' }, name);
      b.onclick = () => { storage.set(`ao.mobilePrefer.${this.charKey(session)}`, value); this.drawerRevision = -1; this.renderDrawer(session); };
      seg.append(b);
    }
    body.append(seg);
    if (!spells.length) body.append(el('p', { className: 'm-empty' }, 'No conocés hechizos.'));
    for (const spell of spells) {
      const tag = isDamage(spell) ? 'Daño' : isHeal(spell) ? 'Curación' : isOffensive(spell) ? 'Estado' : spell.effect === 'positive' ? 'Ayuda' : 'Otro';
      const row = el('div', { className: `m-spell${affordable(spell, mana, session.ui.stats.stamina) ? '' : ' dim'}` });
      row.dataset.slot = String(spell.slot);
      const cast = el('button', { type: 'button', className: 'm-spell-cast' }, el('b', {}, spell.name), el('small', {}, `${tag} · ${spell.mana} maná`));
      cast.onclick = () => {
        this.closeDrawer();
        const target = this.liveTarget(session);
        // Only a creature, or yourself for a helpful spell, is targeted automatically; anything else (a player looked at earlier included)
        // takes the classic path, so a spell picked here can never land on a player by accident.
        if (target && (target.kind === 'hostile' || (target.kind === 'self' && spell.effect === 'positive'))) this.perform(session, target, { kind: 'cast', spell, rule: 'drawer' });
        else this.deps.guard(() => session.spells.cast(spell.slot, spell.name)); // classic flow: the next world tap is the target
      };
      const pinButton = el('button', { type: 'button', className: `m-spell-pin${pin === spell.slot ? ' on' : ''}` }, '📌');
      pinButton.setAttribute('aria-label', `Fijar ${spell.name} para criaturas`);
      pinButton.onclick = () => { storage.set(`ao.mobilePin.${this.charKey(session)}`, pin === spell.slot ? undefined : String(spell.slot)); this.drawerRevision = -1; this.renderDrawer(session); };
      row.append(cast, pinButton);
      body.append(row);
    }
  }
  private renderInventory(session: Session, body: HTMLElement) {
    const grid = el('div', { className: 'm-inventory' });
    const items = [...session.ui.inventory.values()].sort((a, b) => a.slot - b.slot);
    if (!items.length) body.append(el('p', { className: 'm-empty' }, 'Inventario vacío.'));
    for (const item of items) {
      const info = session.catalog?.get(item.object);
      const cell = el('button', { type: 'button', className: `m-item${item.equipped ? ' equipped' : ''}` }, el('span', { className: 'm-art' }), el('span', { className: 'm-count' }, String(item.amount)));
      cell.setAttribute('aria-label', `${info?.name ?? `Objeto ${item.object}`} x${item.amount}`);
      cell.dataset.slot = String(item.slot);
      if (info?.grh) this.paintArt(cell.querySelector('.m-art')!, info.grh);
      this.bindPress(cell, () => this.deps.guard(() => session.itemActions.activate(item.slot)), () => {
        this.deps.ui.selectSlot(item.slot);
        const bar = el('div', { className: 'm-item-actions' }, el('b', {}, info?.name ?? ''));
        for (const [name, run] of [
          ['Usar', () => session.itemActions.useKey(item.slot)], ['Equipar', () => session.itemActions.equip(item.slot)],
          ['Tirar', () => this.deps.dropSelected()],
        ] as const) { const b = el('button', { type: 'button' }, name); b.onclick = () => { this.deps.guard(run); bar.remove(); }; bar.append(b); }
        body.querySelector('.m-item-actions')?.remove();
        body.prepend(bar);
      });
      grid.append(cell);
    }
    body.append(grid);
  }
  private renderMenu(body: HTMLElement) {
    const classic = (name: string) => () => document.querySelector<HTMLElement>(`#menu-actions button[aria-label="${name}"]`)?.click();
    const entries: [string, () => void][] = [
      ['Estadísticas', classic('Estadísticas')], ['Skills', () => document.getElementById('skills-button')?.click()], ['Quests', classic('Quests')],
      ['Grupo', classic('Grupo')], ['Clanes', classic('Clanes')], ['Retos', classic('Retos')], ['Hogar', classic('Hogar')], ['Llavero', classic('Llavero')],
      ['Mapa', () => this.deps.openWorldMap()], ['Opciones', () => document.getElementById('settings')?.click()],
      ['Seguro', () => document.getElementById('safe-attack')?.click()], ['Chat', () => document.getElementById('chat-open')?.click()],
      ['Modo clásico', () => this.setLayout('classic')], ['Salir', () => this.deps.exitGame()],
    ];
    const grid = el('div', { className: 'm-menu' });
    for (const [name, run] of entries) {
      const b = el('button', { type: 'button' }, name);
      b.onclick = () => { this.closeDrawer(); run(); };
      grid.append(b);
    }
    body.append(grid);
  }
  /** Long-press: choose the spell for this target. Hostile creatures: the choice is also pinned (the next taps repeat it). Players: once. */
  private openPicker(session: Session, target: Target, x: number, y: number) {
    const spells = this.spells(session), mana = session.ui.stats.mana ?? 0;
    const sensible = (s: MobileSpell) => (target.kind === 'hostile' || target.kind === 'player' ? isOffensive(s) : s.effect === 'positive');
    const ordered = [...spells.filter(sensible), ...spells.filter(s => !sensible(s))];
    const c = target.charIndex >= 0 ? session.tracker.chars.get(target.charIndex) : undefined;
    const list = el('div', { className: 'm-picker-list' });
    // NPC names are not on the wire (the classic client reads them from its table): Dat/npcs.dat Name.
    const title = c ? (c.name || (c.npcNumber > 0 ? this.npcTable?.get(`npc${c.npcNumber}`)?.get('name') : undefined) || 'Objetivo') : 'Fijar para criaturas';
    const live = target.charIndex >= 0;
    const choose = (run: () => void) => () => { this.picker.hidden = true; run(); };
    for (const spell of ordered) {
      const b = el('button', { type: 'button', className: affordable(spell, mana, session.ui.stats.stamina) ? '' : 'dim' }, el('b', {}, spell.name), el('small', {}, `${spell.mana} maná`));
      b.onclick = choose(() => {
        if (target.kind === 'hostile') storage.set(`ao.mobilePin.${this.charKey(session)}`, String(spell.slot));
        if (live) { this.target = target; this.perform(session, target, { kind: 'cast', spell, rule: 'picker' }); }
      });
      list.append(b);
    }
    const melee = el('button', { type: 'button' }, el('b', {}, 'Golpe'), el('small', {}, 'cuerpo a cuerpo'));
    melee.onclick = choose(() => {
      if (target.kind === 'hostile') storage.set(`ao.mobilePin.${this.charKey(session)}`, 'melee');
      if (live) { this.target = target; this.perform(session, target, this.decide(session, target)); }
    });
    list.append(melee);
    if (target.kind === 'hostile') {
      const auto = el('button', { type: 'button' }, el('b', {}, 'Automático'), el('small', {}, 'quitar el fijado'));
      auto.onclick = choose(() => storage.set(`ao.mobilePin.${this.charKey(session)}`, undefined));
      list.append(auto);
    }
    const close = el('button', { type: 'button', className: 'm-close' }, '✕');
    close.onclick = () => { this.picker.hidden = true; };
    this.picker.replaceChildren(el('div', { className: 'm-picker-head' }, el('b', {}, title), close), list);
    this.picker.hidden = false;
    const w = Math.min(300, innerWidth - 24);
    this.picker.style.width = `${w}px`;
    this.picker.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x - w / 2))}px`;
    this.picker.style.top = `${Math.max(12, Math.min(innerHeight * 0.4, y - 40))}px`;
  }
}
