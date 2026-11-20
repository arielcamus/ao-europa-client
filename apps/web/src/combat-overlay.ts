/*
 * Floating combat text and hit effects, adapted from engine.bas Char_TextRender
 * (DialogEffects: 1300 ms life, rises 0.025 px/ms, fades after 900 ms) and
 * TileEngine_Chars.SetCharacterFx. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. Artwork is read only from the local mount.
 */
import { fetchText, parseIni } from './assets.js';
import type { Animation, Ini } from './assets.js';
import { TEXT_LIFE_MS } from './combat.js';
import type { CharFx, FloatingText } from './combat.js';
import type { WorldRenderer } from './renderer.js';
import type { Session } from './session.js';

interface FxDef { animation: number; offsetX: number; offsetY: number }
interface FxNode { canvas: HTMLCanvasElement; animation: Animation; def: FxDef }

export class CombatOverlay {
  private layer = document.createElement('div');
  private fxTable: Ini = new Map();
  private texts = new Map<FloatingText, HTMLDivElement>();
  private effects = new Map<CharFx, FxNode | 'loading'>();
  private sheets = new Map<number, Promise<HTMLImageElement>>();

  constructor(host: HTMLElement, private readonly renderer: WorldRenderer, private readonly report: (message: string) => void) {
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '5' });
    this.layer.id = 'combat-layer';
    host.append(this.layer);
  }
  async init() { this.fxTable = parseIni(await fetchText('init/FXs.ini')); }
  private sheet(file: number) {
    let pending = this.sheets.get(file);
    if (!pending) {
      const image = new Image(); image.src = `/ao-assets/Graficos/${file}.png`;
      pending = image.decode().then(() => image); this.sheets.set(file, pending);
    }
    return pending;
  }
  private fxDef(index: number): FxDef | undefined {
    const section = this.fxTable.get(`fx${index}`);
    const animation = Number(section?.get('animacion') ?? 0);
    return section && animation > 0 ? { animation, offsetX: Number(section.get('offsetx') ?? 0), offsetY: Number(section.get('offsety') ?? 0) } : undefined;
  }
  private tile(session: Session, charIndex: number, now: number) {
    if (charIndex === session.charIndex) return session.visualPosition(now);
    const character = session.characters.get(charIndex);
    return character ? { x: character.x, y: character.y } : undefined;
  }
  update(session: Session | undefined, now: number) {
    if (!session || session.phase !== 'playing') { this.layer.replaceChildren(); this.texts.clear(); this.effects.clear(); return; }
    const combat = session.combat, camera = this.renderer.camera;
    combat.prune(now);
    for (const item of combat.floating) this.drawText(session, item, now, camera);
    for (const [item, node] of this.texts) if (!combat.floating.includes(item)) { node.remove(); this.texts.delete(item); }
    for (const item of combat.fx) this.drawFx(session, item, now, camera);
    for (const [item, node] of this.effects) {
      if (!combat.fx.includes(item)) { if (node !== 'loading') node.canvas.remove(); this.effects.delete(item); }
    }
  }
  private drawText(session: Session, item: FloatingText, now: number, camera: { x: number; y: number }) {
    const tile = this.tile(session, item.charIndex, now);
    let node = this.texts.get(item);
    if (!node) {
      node = document.createElement('div'); node.className = 'combat-text'; node.textContent = item.text;
      Object.assign(node.style, {
        position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap', font: 'bold 13px Verdana, Arial, sans-serif',
        color: item.color, textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000',
      });
      this.layer.append(node); this.texts.set(item, node);
    }
    if (!tile) { node.style.display = 'none'; return; }
    const age = now - item.start;
    node.style.display = '';
    node.style.opacity = String(age > 900 ? Math.max(0, (TEXT_LIFE_MS - age) * 0.0025) : 1);
    node.style.left = `${tile.x * 32 + 16 - camera.x}px`;
    node.style.top = `${tile.y * 32 - 28 - age * 0.025 + item.slide - camera.y}px`;
  }
  private drawFx(session: Session, item: CharFx, now: number, camera: { x: number; y: number }) {
    let node = this.effects.get(item);
    if (node === undefined) {
      const def = this.fxDef(item.fx);
      if (!def) { item.start = -Infinity; return; }
      this.effects.set(item, 'loading');
      void this.renderer.frames(def.animation).then(animation => {
        const canvas = document.createElement('canvas'), frame = animation.frames[0]!;
        canvas.width = frame.width; canvas.height = frame.height; canvas.className = 'combat-fx';
        Object.assign(canvas.style, { position: 'absolute', mixBlendMode: 'screen', imageRendering: 'pixelated' });
        if (this.effects.get(item) === 'loading') { this.layer.append(canvas); this.effects.set(item, { canvas, animation, def }); }
      }).catch(error => { this.effects.delete(item); item.start = -Infinity; this.report(String(error)); });
      return;
    }
    if (node === 'loading') return;
    const { canvas, animation, def } = node;
    const plays = Math.max(1, item.loops), duration = animation.frames.length * animation.frameMs * plays;
    const age = now - item.start;
    const tile = this.tile(session, item.charIndex, now);
    if (age > duration) { item.start = -Infinity; return; }
    if (!tile) { canvas.style.display = 'none'; return; }
    const frame = animation.frames[Math.floor(age / animation.frameMs) % animation.frames.length]!;
    canvas.style.display = '';
    if (canvas.width !== frame.width) canvas.width = frame.width;
    if (canvas.height !== frame.height) canvas.height = frame.height;
    canvas.style.left = `${tile.x * 32 + 16 - frame.width / 2 + def.offsetX - camera.x}px`;
    canvas.style.top = `${tile.y * 32 + 32 - frame.height + def.offsetY - camera.y}px`;
    void this.sheet(frame.file).then(sheet => { const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, frame.width, frame.height); ctx.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height); }).catch(() => undefined);
  }
}
