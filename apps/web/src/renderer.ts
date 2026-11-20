/*
 * M2 map/body rendering adapted from AO Recursos.bas and engine.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { Application, Container, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { clipFrame, fetchBytes, fetchText, graphicAnimation, parseGraphics, parseHeads, parseIni, parseMap, readBody } from './assets.js';
import type { Animation, Body, GraphicFrame, GraphicIndex, Ini, WorldMap } from './assets.js';
import type { Session } from './session.js';
import { DOOR_OBJECT_TYPE, ObjType, RoofLights, TreeFade, fixedObjects, nearRoof, objectDraws, parseObjectGraphics, treeCoversPlayer } from './map-objects.js';
import type { GroundObject, ObjectGraphic } from './map-objects.js';
import { CharacterSprites } from './character-render.js';
import { NPC_NAME_COLOR, parseColors, parseLocale, playerNameColor, privilegeTitle } from './character-data.js';
import type { LocaleData, Rgb } from './character-data.js';
import { spellTables } from './spells.js';
import type { ActiveFx } from './spells.js';

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
  private readonly roofs = new RoofLights();
  private readonly trees = new TreeFade();
  /** Trees, signs, deposits and decorations come from the map file, never from the server (ModAreas.EsObjetoFijo). */
  private fixed = new Map<number, GroundObject>();
  /** The map-file object on a tile, if any (the server sees these too). */
  fixedObjectAt(x: number, y: number): GroundObject | undefined { return this.fixed.get((y - 1) * 100 + x - 1); }
  private lastRender = 0;
  private readonly labelLayer = new Container();
  private labels: Text[] = [];
  private labelsUsed = 0;
  private sprites: CharacterSprites | undefined;
  private colors = new Map<string, Rgb>();
  /** Spanish locale + NPC names (sp_localindex.dat); set once the metadata has loaded. */
  locale: LocaleData | undefined;
  /** Tile under the mouse: NPC names are only drawn there, as in Char_Render (TX, TY). */
  hoverTile: { x: number; y: number } | undefined;
  /** The HideNames key (binding 7, VB6 `Nombres`): names and titles over characters on or off. */
  showNames = true;
  /** Top-left of the visible world in native pixels, from the last frame (combat overlay, hover tile).*/
  camera = { x: 0, y: 0 };

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
    for (let i = 0; i < 9; i++) {
      const container = new Container(); this.world.addChild(container); this.pools.push(new SpritePool(container));
    }
    this.world.addChild(this.labelLayer);
    this.observer = new ResizeObserver(() => this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight));
    this.observer.observe(this.host);
    this.app.ticker.maxFPS = 60;
  }
  private loadMetadata(): Promise<void> {
    // Character extras degrade to "no equipment / no names" with one report, never block the map.
    const optional = <T>(load: Promise<T>, name: string) => load.catch(error => { this.report(`${name}: ${String(error)}`); return undefined; });
    return this.metadata ??= Promise.all([
      fetchText('init/graficos.ini'), fetchText('init/cuerpos.dat'), fetchText('init/moldes.ini'), fetchBytes('init/cabezas.ind'),
      fetchText('Dat/Obj.dat').catch(() => ''),
      optional(fetchText('init/armas.dat'), 'armas.dat'), optional(fetchText('init/escudos.dat'), 'escudos.dat'),
      optional(fetchBytes('init/cascos.ind'), 'cascos.ind'), optional(fetchText('init/colores.dat'), 'colores.dat'),
      optional(fetchText('init/sp_localindex.dat'), 'sp_localindex.dat'),
    ]).then(([graphics, bodies, molds, heads, objects, weapons, shields, helmets, colors, locale]) => {
      this.objectGraphics = parseObjectGraphics(objects);
      this.graphics = parseGraphics(graphics); this.bodies = parseIni(bodies);
      this.molds = parseIni(molds); this.heads = parseHeads(heads);
      this.colors = colors ? parseColors(colors) : new Map();
      this.locale = locale ? parseLocale(parseIni(locale)) : undefined;
      this.sprites = new CharacterSprites({
        graphics: this.graphics, bodies: this.bodies, molds: this.molds, heads: this.heads,
        helmets: helmets ? parseHeads(helmets) : [], weapons: weapons ? parseIni(weapons) : new Map(),
        shields: shields ? parseIni(shields) : new Map(), animation: id => this.animation(id),
      });
    }).catch(error => { this.metadata = undefined; throw error; });
  }
  async loadMap(id: number) {
    const epoch = ++this.epoch;
    this.readyMap = undefined; this.map = undefined; this.fixed = new Map(); this.trees.clear();
    this.pools.forEach(pool => { pool.reset(); pool.finish(); });
    // Keep texture memory bounded to the current map. Late loads are discarded.
    for (const texture of this.textures.values()) if (texture !== Texture.EMPTY) texture.destroy();
    for (const source of this.sources.values()) source.destroy(true);
    this.textures.clear(); this.sources.clear(); this.pending.clear(); this.failed.clear(); this.loadedSheets = 0; this.clippedFrames = 0;
    const [bytes] = await Promise.all([fetchBytes(`Mapas/mapa${id}.csm`), this.loadMetadata()]);
    if (epoch !== this.epoch) return;
    this.map = parseMap(bytes); this.fixed = fixedObjects(this.map.objects, this.objectGraphics); this.mapName = this.map.name; this.roofs.reset(this.map.triggers); this.readyMap = id;
  }
  private animation(id: number) {
    let animation = this.animations.get(id);
    if (!animation) { animation = graphicAnimation(this.graphics, id); this.animations.set(id, animation); }
    return animation;
  }
  /** Frames of a Grh animation (effects such as the hit splash need every frame, graphic() only the first). */
  async frames(id: number): Promise<Animation> {
    await this.loadMetadata();
    return this.animation(id);
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
    this.roofs.update(this.map.triggers[(session.position!.y - 1) * 100 + session.position!.x - 1] ?? 0, dt);
    this.pools.forEach(pool => pool.reset());
    const minX = Math.max(1, Math.floor(cameraX / 32) - 10), maxX = Math.min(100, Math.ceil((cameraX + width) / 32) + 10);
    const minY = Math.max(1, Math.floor(cameraY / 32) - 2), maxY = Math.min(100, Math.ceil((cameraY + height) / 32) + 10);
    for (let layer = 0; layer < 5; layer++) {
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        // VB6 finishes characters in a row, then draws that row's layer 4.
        // Split that layer around the self row; roofs remain above everything.
        const pool = this.pools[layer < 3 ? layer : layer === 4 ? 6 : y < session.position!.y ? 3 : 5]!;
        const tile = (y - 1) * 100 + x - 1;
        const object = session.mapObjects.objectAt(x, y) ?? this.fixed.get(tile);
        // Objects (doors, trees, signs, items) sit between the second and third map layers, and big ones repeat in the row pass
        // with layer 4, over that row's characters (RenderScreen). Trees fade when they cover the player.
        if (object && (layer === 2 || layer === 3)) {
          for (const draw of objectDraws(object, this.objectGraphics)) {
            if (draw.pass !== (layer === 2 ? 'ground' : 'row')) continue;
            const alpha = draw.type === ObjType.Tree && draw.pass === 'row' ? this.trees.step(tile, treeCoversPlayer(session.position!, x, y), dt) : 1;
            this.draw(pool, this.animation(draw.grh), x * 32, y * 32, now, true, alpha);
          }
        }
        const id = this.map.layers[layer]![tile]!;
        if (!id) continue;
        if (layer === 4) {
          // Live VB6 roof rule: one alpha per roof trigger, 3x3 NearRoof, the player's own roof fades out.
          const trigger = nearRoof(this.map.triggers, x, y);
          this.draw(pool, this.animation(id), x * 32, y * 32, now, true, trigger ? this.roofs.alphaOf(trigger) : 1);
        } else this.draw(pool, this.animation(id), x * 32, y * 32, now, layer !== 0);
      }
    }
    this.camera = { x: cameraX, y: cameraY };
    this.drawCharacters(session, position, now, cameraX, cameraY, width, height);
    this.drawEffects(session, now, position);
    this.pools.forEach(item => item.finish());
  }
  /** Sprites of a stationary south-facing character, for the NPC dialog portrait. */
  portraitLayers(body: number, head: number) {
    return this.sprites?.layers({ body, head, weapon: 0, shield: 0, helmet: 0 } as never, 3) ?? [];
  }
  private label(text: string, color: Rgb, x: number, y: number, size = 11, bottom = false) {
    let label = this.labels[this.labelsUsed++];
    if (!label) {
      label = new Text({ text, style: { fontFamily: 'Tahoma, Verdana, sans-serif', fontSize: size, fontWeight: 'bold', fill: '#ffffff', stroke: { color: '#000000', width: 3 }, align: 'center', wordWrap: true, wordWrapWidth: 170 } });
      label.resolution = 2;
      this.labels.push(label); this.labelLayer.addChild(label);
    }
    if (label.text !== text) label.text = text;
    label.anchor.set(0.5, bottom ? 1 : 0);
    label.style.fill = `rgb(${color.r},${color.g},${color.b})`;
    label.position.set(Math.round(x), Math.round(y)); label.visible = true;
  }
  /** Everybody on screen, drawn bottom row first so nearer characters cover farther ones. */
  private drawCharacters(session: Session, selfPosition: { x: number; y: number }, now: number, cameraX: number, cameraY: number, width: number, height: number) {
    const sprites = this.sprites; this.labelsUsed = 0;
    if (!sprites) { this.labels.forEach(label => { label.visible = false; }); return; }
    const tracker = session.tracker;
    tracker.expireDialogs(now);
    const chars = [...tracker.chars.values()]; // self included: its CharacterCreate passes through the tracker too
    const placed = chars.map(char => {
      if (char.charIndex === session.charIndex) {
        const moving = !!session.motion && now < session.motion.started + session.motion.duration;
        return { char, heading: session.self!.heading as number, x: selfPosition.x, y: selfPosition.y, moving, elapsed: moving ? Math.max(0, now - session.motion!.started) : 0 };
      }
      const view = tracker.visualPosition(char, now);
      return { char, heading: char.heading as number, ...view };
    }).filter(({ x, y }) => x * 32 > cameraX - 96 && x * 32 < cameraX + width + 96 && y * 32 > cameraY - 96 && y * 32 < cameraY + height + 96)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const pool = this.pools[4]!;
    for (const { char, heading, x, y, moving, elapsed } of placed) {
      const px = x * 32, py = y * 32;
      for (const layer of sprites.layers(char, heading)) {
        this.draw(pool, layer.animation, px + layer.x, py + layer.y, layer.walks && moving ? elapsed : 0);
      }
      if (!this.showNames) { /* HideNames */ } else if (char.npc) {
        // NPC names appear only under the cursor, in (0,129,195).
        if (this.hoverTile && this.hoverTile.x === char.x && this.hoverTile.y === char.y && char.name) {
          this.label(char.name, NPC_NAME_COLOR, px + 16, py + 31);
          if (char.clan) this.label(char.clan, NPC_NAME_COLOR, px + 16, py + 43);
        }
      } else if (char.name) {
        const self = session.self;
        const color = playerNameColor(this.colors, char.status, char.privileges, char.groupIndex > 0 && self !== undefined && self.groupIndex === char.groupIndex);
        this.label(char.name, color, px + 16, py + 31);
        const title = privilegeTitle(Math.round(char.privileges ? Math.log2(char.privileges) : 0)) ?? char.clan;
        if (title) this.label(title, color, px + 16, py + 43);
      }
      // Overhead speech is drawn once, by ChatBubbles from ChatState (chat #7); the tracker's dialog only feeds the NPC window.
    }
    for (let i = this.labelsUsed; i < this.labels.length; i++) this.labels[i]!.visible = false;
  }
  private selfBodyY(session: Session) {
    const id = session.self?.body ?? 0;
    let body = this.bodyCache.get(id);
    if (!body && id > 0) { try { body = readBody(this.bodies, this.molds, this.graphics, id); this.bodyCache.set(id, body); } catch { return 0; } }
    return body?.bodyY ?? 0;
  }
  /**
   * Spell FX (CreateFX / FxPiso), engine.bas Char_Render FxList: a Grh from FXs.ini drawn at the
   * character's tile plus the FX offsets, 20px down, over the body. Pool 7 is additive (IsPNG=0,
   * the VB6 blended draw), pool 8 plain alpha (IsPNG=1). One pass lasts frameMs * frames.
   */
  private drawEffects(session: Session, now: number, self: { x: number; y: number }) {
    const spells = session.spells;
    if (!spells.effects.length) return;
    const info = (fx: ActiveFx) => {
      const section = fx.grh ? undefined : spellTables.fx.get(`fx${fx.fx}`);
      const grh = fx.grh ?? Number(section?.get('animacion') ?? 0);
      if (!grh || !this.graphics.has(grh)) return undefined;
      return { animation: this.animation(grh), offsetX: Number(section?.get('offsetx') ?? 0), offsetY: Number(section?.get('offsety') ?? 0), png: section?.get('ispng') === '1' || fx.grh !== undefined };
    };
    spells.prune(now, fx => { const a = info(fx); return a ? a.animation.frameMs * a.animation.frames.length : 0; });
    this.pools[7]!.container.blendMode = 'add'; this.pools[8]!.container.alpha = 220 / 255; this.pools[7]!.container.alpha = 220 / 255;
    for (const fx of spells.effects) {
      const data = info(fx);
      if (!data) continue;
      let x = fx.x, y = fx.y, body = 0;
      if (fx.charIndex !== undefined) {
        // Other characters use the tracker's slide position so an FX follows a walking NPC (npcs #8).
        const character = session.tracker.chars.get(fx.charIndex);
        if (fx.charIndex === session.charIndex) { x = self.x; y = self.y; body = this.selfBodyY(session); }
        else if (character) { const view = session.tracker.visualPosition(character, now); x = view.x; y = view.y; }
        else if (!x || !y) continue;
      }
      this.draw(this.pools[data.png ? 8 : 7]!, data.animation, x * 32 + data.offsetX, y * 32 + data.offsetY + 20 + body, now - fx.startedAt);
    }
  }
  destroy() {
    this.epoch++; this.observer?.disconnect();
    this.app.destroy(true, { children: true });
    for (const texture of this.textures.values()) if (texture !== Texture.EMPTY) texture.destroy();
    for (const source of this.sources.values()) source.destroy(true);
  }
}
