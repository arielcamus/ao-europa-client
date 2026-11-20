/*
 * M2 map/body rendering adapted from AO Recursos.bas and engine.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { Application, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { clipFrame, fetchBytes, fetchText, graphicAnimation, parseGraphics, parseHeads, parseIni, parseMap, readBody } from './assets.js';
import type { Animation, Body, GraphicFrame, GraphicIndex, Ini, WorldMap } from './assets.js';
import type { Session } from './session.js';
import { DOOR_OBJECT_TYPE, RoofFade, parseObjectGraphics, roofHidden, tileKey } from './map-objects.js';
import type { ObjectGraphic } from './map-objects.js';

class SpritePool {
  private sprites: Sprite[] = [];
  private used = 0;
  constructor(readonly container: Container) {}
  reset() { this.used = 0; }
  draw(texture: Texture, x: number, y: number, alpha = 1) {
    let sprite = this.sprites[this.used++];
    if (!sprite) { sprite = new Sprite(); this.sprites.push(sprite); this.container.addChild(sprite); }
    sprite.texture = texture; sprite.position.set(Math.round(x), Math.round(y)); sprite.alpha = alpha; sprite.visible = true;
  }
  finish() { for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false; }
}

export class WorldRenderer {
  readonly app = new Application();
  readyMap: number | undefined;
  mapName = '';
  loadedSheets = 0;
  clippedFrames = 0;
  private map: WorldMap | undefined;
  private graphics: GraphicIndex = new Map();
  private bodies: Ini = new Map();
  private molds: Ini = new Map();
  private heads: number[][] = [];
  private animations = new Map<number, Animation>();
  private bodyCache = new Map<number, Body>();
  private textures = new Map<string, Texture>();
  private sources = new Map<number, Texture>();
  private pending = new Set<number>();
  private failed = new Set<number>();
  private epoch = 0;
  private metadata: Promise<void> | undefined;
  private pools: SpritePool[] = [];
  private observer: ResizeObserver | undefined;
  private readonly world = new Container();
  private objectGraphics = new Map<number, ObjectGraphic>();
  private readonly roofs = new RoofFade();
  private lastRender = 0;

  constructor(private readonly host: HTMLElement, private readonly report: (message: string) => void) {}
  get settled() { return this.readyMap !== undefined && this.loadedSheets > 0 && this.pending.size === 0; }
  async init() {
    await this.app.init({
      background: '#000000', antialias: false, preference: 'webgl',
      resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true,
      width: this.host.clientWidth, height: this.host.clientHeight,
    });
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'Argentum map. Use arrow keys or W A S D to walk.');
    this.host.prepend(this.app.canvas);
    this.app.stage.addChild(this.world);
    for (let i = 0; i < 7; i++) {
      const container = new Container(); this.world.addChild(container); this.pools.push(new SpritePool(container));
    }
    this.observer = new ResizeObserver(() => this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight));
    this.observer.observe(this.host);
    this.app.ticker.maxFPS = 60;
  }
  private loadMetadata(): Promise<void> {
    return this.metadata ??= Promise.all([
      fetchText('init/graficos.ini'), fetchText('init/cuerpos.dat'), fetchText('init/moldes.ini'), fetchBytes('init/cabezas.ind'),
      fetchText('Dat/Obj.dat').catch(() => ''),
    ]).then(([graphics, bodies, molds, heads, objects]) => {
      this.objectGraphics = parseObjectGraphics(objects);
      this.graphics = parseGraphics(graphics); this.bodies = parseIni(bodies);
      this.molds = parseIni(molds); this.heads = parseHeads(heads);
    }).catch(error => { this.metadata = undefined; throw error; });
  }
  async loadMap(id: number) {
    const epoch = ++this.epoch;
    this.readyMap = undefined; this.map = undefined; this.roofs.clear();
    this.pools.forEach(pool => { pool.reset(); pool.finish(); });
    // Keep texture memory bounded to the current map. Late loads are discarded.
    for (const texture of this.textures.values()) if (texture !== Texture.EMPTY) texture.destroy();
    for (const source of this.sources.values()) source.destroy(true);
    this.textures.clear(); this.sources.clear(); this.pending.clear(); this.failed.clear(); this.loadedSheets = 0; this.clippedFrames = 0;
    const [bytes] = await Promise.all([fetchBytes(`Mapas/mapa${id}.csm`), this.loadMetadata()]);
    if (epoch !== this.epoch) return;
    this.map = parseMap(bytes); this.mapName = this.map.name; this.readyMap = id;
  }
  private animation(id: number) {
    let animation = this.animations.get(id);
    if (!animation) { animation = graphicAnimation(this.graphics, id); this.animations.set(id, animation); }
    return animation;
  }
  async graphic(id: number): Promise<GraphicFrame> {
    await this.loadMetadata();
    return this.animation(id).frames[0]!;
  }
  private texture(frame: GraphicFrame): Texture {
    const key = `${frame.file}/${frame.x}/${frame.y}/${frame.width}/${frame.height}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    const source = this.sources.get(frame.file);
    if (!source) { this.loadSheet(frame.file); return Texture.EMPTY; }
    const crop = clipFrame(frame, source.width, source.height);
    if (crop.clipped) this.clippedFrames++;
    if (!crop.width || !crop.height) { this.textures.set(key, Texture.EMPTY); return Texture.EMPTY; }
    const texture = new Texture({
      source: source.source, frame: new Rectangle(frame.x, frame.y, crop.width, crop.height),
      orig: new Rectangle(0, 0, frame.width, frame.height), trim: new Rectangle(0, 0, crop.width, crop.height),
    });
    this.textures.set(key, texture); return texture;
  }
  private loadSheet(file: number) {
    if (this.pending.has(file) || this.failed.has(file)) return;
    this.pending.add(file);
    const epoch = this.epoch;
    const image = new Image();
    image.onload = () => {
      if (epoch !== this.epoch) return;
      try {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas texture decoding unavailable');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        // Same black color key as clsTexManager.CreateTextureFromFileEx; original files stay untouched.
        for (let i = 0; i < pixels.data.length; i += 4) {
          if (pixels.data[i] === 0 && pixels.data[i + 1] === 0 && pixels.data[i + 2] === 0) pixels.data[i + 3] = 0;
        }
        context.putImageData(pixels, 0, 0);
        const texture = Texture.from(canvas); texture.source.scaleMode = 'nearest';
        this.sources.set(file, texture); this.loadedSheets++;
      } catch (error) { this.report(String(error)); this.failed.add(file); }
      this.pending.delete(file);
    };
    image.onerror = () => {
      if (epoch !== this.epoch) return;
      this.pending.delete(file); this.failed.add(file); this.report(`Missing local graphic: Graficos/${file}.png`);
    };
    image.src = `/ao-assets/Graficos/${file}.png`;
  }
  private draw(pool: SpritePool, animation: Animation, x: number, y: number, time: number, centered = true, alpha = 1) {
    const frame = animation.frames[Math.floor(time / animation.frameMs) % animation.frames.length]!;
    pool.draw(this.texture(frame), x + (centered ? Math.floor((32 - frame.width) / 2) : 0), y + (centered ? 32 - frame.height : 0), alpha);
  }
  /** Map tile under a pointer, using the same camera as render(); undefined outside the viewport. */
  tileAt(session: Session, clientX: number, clientY: number, now: number): { x: number; y: number } | undefined {
    const position = session.visualPosition(now);
    const rect = this.host.getBoundingClientRect();
    if (!position || !rect.width || !rect.height) return undefined;
    const sx = this.app.screen.width / rect.width, sy = this.app.screen.height / rect.height; // layout may be CSS-scaled
    const px = (clientX - rect.left) * sx, py = (clientY - rect.top) * sy;
    if (px < 0 || py < 0 || px > this.app.screen.width || py > this.app.screen.height) return undefined;
    const x = Math.floor((px + position.x * 32 + 16 - this.app.screen.width / 2) / 32);
    const y = Math.floor((py + position.y * 32 + 16 - this.app.screen.height / 2) / 32);
    return x >= 1 && y >= 1 && x <= 100 && y <= 100 ? { x, y } : undefined;
  }
  isDoor(objIndex: number) { return this.objectGraphics.get(objIndex)?.type === DOOR_OBJECT_TYPE; }
  render(session: Session | undefined, now: number) {
    const position = session?.visualPosition(now);
    if (!this.map || !position || !session?.self || this.readyMap !== session.resourceMap) return;
    // frmMain's 736×608 viewport is 23×19 native 32px tiles. The DOM scales
    // the entire classic window on phones, never the map independently.
    const zoom = 1;
    const width = this.app.screen.width / zoom, height = this.app.screen.height / zoom;
    this.world.scale.set(zoom);
    const cameraX = position.x * 32 + 16 - width / 2;
    const cameraY = position.y * 32 + 16 - height / 2;
    this.world.position.set(-Math.round(cameraX * zoom), -Math.round(cameraY * zoom));
    const dt = this.lastRender ? Math.min(100, now - this.lastRender) : 16; this.lastRender = now;
    this.pools.forEach(pool => pool.reset());
    const minX = Math.max(1, Math.floor(cameraX / 32) - 10), maxX = Math.min(100, Math.ceil((cameraX + width) / 32) + 10);
    const minY = Math.max(1, Math.floor(cameraY / 32) - 2), maxY = Math.min(100, Math.ceil((cameraY + height) / 32) + 10);
    for (let layer = 0; layer < 5; layer++) {
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        // VB6 finishes characters in a row, then draws that row's layer 4.
        // Split that layer around the self row; roofs remain above everything.
        const pool = this.pools[layer < 3 ? layer : layer === 4 ? 6 : y < session.position!.y ? 3 : 5]!;
        const tile = (y - 1) * 100 + x - 1;
        // Ground objects (doors included) sit between the second and third map layers.
        if (layer === 2) {
          const object = session.mapObjects.objectAt(x, y);
          const grh = object ? this.objectGraphics.get(object.objIndex)?.grh : undefined;
          if (grh) this.draw(pool, this.animation(grh), x * 32, y * 32, now, true);
        }
        const id = this.map.layers[layer]![tile]!;
        if (!id) continue;
        if (layer === 4) {
          // Client roof rule (HayTecho + same-trigger fade): roofs above the player's own building turn see-through.
          const alpha = this.roofs.step(tile, roofHidden(this.map.triggers, tileKey(session.position!.x, session.position!.y), tile), dt);
          this.draw(pool, this.animation(id), x * 32, y * 32, now, true, alpha);
        } else this.draw(pool, this.animation(id), x * 32, y * 32, now, layer !== 0);
      }
    }
    let body = this.bodyCache.get(session.self.body);
    if (!body) { body = readBody(this.bodies, this.molds, this.graphics, session.self.body); this.bodyCache.set(session.self.body, body); }
    const moving = session.motion && now < session.motion.started + session.motion.duration;
    // Held input may start a walk after this tick captured `now`.
    // Like visualPosition, clamp that first frame to the animation's start.
    const time = moving ? Math.max(0, now - session.motion!.started) : 0;
    const heading = session.self.heading - 1;
    const pool = this.pools[4]!;
    this.draw(pool, body.walk[heading]!, position.x * 32 + body.bodyX + (session.self.body < 488 ? 1 : 0), position.y * 32 + body.bodyY, time);
    const head = this.heads[session.self.head]?.[heading];
    if (head) this.draw(pool, this.animation(head), position.x * 32 + body.headX, position.y * 32 + body.headY, 0);
    this.pools.forEach(item => item.finish());
  }
  destroy() {
    this.epoch++; this.observer?.disconnect();
    this.app.destroy(true, { children: true });
    for (const texture of this.textures.values()) if (texture !== Texture.EMPTY) texture.destroy();
    for (const source of this.sources.values()) source.destroy(true);
  }
}
