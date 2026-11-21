/*
 * M2 map/body rendering adapted from AO Recursos.bas and engine.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { TRAP_GRH, TRAP_ALPHA } from './status.js';
import { Application, Container, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { clipFrame, fetchBytes, fetchText, graphicAnimation, parseGraphics, parseHeads, parseIni, parseMap, readBody, tileIndex, assetUrl } from './assets.js';
import type { Animation, Body, GraphicFrame, GraphicIndex, Ini, WorldMap } from './assets.js';
import type { Session } from './session.js';
import { DOOR_OBJECT_TYPE, ObjType, hayTecho, RoofLights, roofTriggers, TreeFade, fixedObjects, nearRoof, objectDraws, objectGraphicsFromIni, treeCoversPlayer, TREE_GRH_INDICES, layer4TreeCoversPlayer, rowSlot } from './map-objects.js';
import { loadObjectIni } from './object-catalog.js';
import type { GroundObject, ObjectGraphic } from './map-objects.js';
import { CharacterSprites } from './character-render.js';
import { FLAG_GRH, NPC_NAME_COLOR, OWN_CLAN_COLOR, TEAM_COLORS, clanTagColor, colorPj, parseColors, playerNameColor, privilegeTitle } from './character-data.js';
import type { Rgb } from './character-data.js';
import { spellTables } from './spells.js';
import type { ActiveFx } from './spells.js';
import { FxRenderer } from './fx-render.js';
import { RoofMeshPool } from './roof-mesh.js';
import { parseParticles } from './fx-particles.js';
import { fxTables, parseProjectiles } from './fx-world.js';
import type { FrameInfo } from './fx-world.js';
import { graphicFlags } from './movement.js';
import { canvasResolution, classicScaleNow, onClassicScale } from './classic-layout.js';

class SpritePool {
  private sprites: Sprite[] = [];
  private used = 0;
  constructor(readonly container: Container) {}
  reset() { this.used = 0; }
  /**
   * `slot` orders sprites in a sortable container (the row pass): sprites sort by slot, then by draw order this frame.
   * The draw index breaks ties so the order never depends on last frame's sort.
   */
  draw(texture: Texture, x: number, y: number, alpha = 1, tint = 0xffffff, slot?: number) {
    let sprite = this.sprites[this.used++];
    if (!sprite) { sprite = new Sprite(); this.sprites.push(sprite); this.container.addChild(sprite); }
    sprite.texture = texture; sprite.position.set(Math.round(x), Math.round(y)); sprite.alpha = alpha; sprite.tint = tint; sprite.visible = true;
    if (slot !== undefined) sprite.zIndex = slot * 65_536 + this.used;
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
  /** Layer-5 roofs as per-corner-coloured quads (RenderScreen passes the tile's four light_value colours). */
  private roofPool: RoofMeshPool | undefined;
  private observer: ResizeObserver | undefined;
  private unscale: (() => void) | undefined;
  private readonly world = new Container();
  private objectGraphics = new Map<number, ObjectGraphic>();
  private readonly roofs = new RoofLights();
  private roofTrig: Uint16Array = new Uint16Array(10_000);
  /** Light map, particles, projectiles, auras and weather (feat/world-fx); created in init(). */
  private fx: FxRenderer | undefined;
  private readonly trees = new TreeFade();
  private readonly trees4 = new TreeFade(); // row-layer trees: a separate timer per tile (the object and row-layer passes both step once a frame)
  /** The client's fixed objects (TileEngine_Map.EsObjetoFijo: trees, signs, deposits, decorations) from the map file; a sign the server also sends wins (map-objects.ts). */
  private fixed = new Map<number, GroundObject>();
  /** The map-file object on a tile, if any (the server sees these too). */
  fixedObjectAt(x: number, y: number): GroundObject | undefined { return this.fixed.get((y - 1) * 100 + x - 1); }
  private lastRender = 0;
  private readonly labelLayer = new Container();
  private labels: Text[] = [];
  private labelsUsed = 0;
  private sprites: CharacterSprites | undefined;
  private colors = new Map<string, Rgb>();
  /** Tile under the mouse: NPC names are only drawn there, as in Char_Render (TX, TY). */
  hoverTile: { x: number; y: number } | undefined;
  /** The HideNames key (binding 7, VB6 `Nombres`): names and titles over characters on or off. */
  showNames = true;
  /** Top-left of the visible world in native pixels, from the last frame (combat overlay, hover tile).*/
  camera = { x: 0, y: 0 };

  constructor(private readonly host: HTMLElement, private readonly report: (message: string) => void) {}
  /** The current frame is complete: every sheet with pixels inside the viewport is loaded (the margin band may still be loading). */
  get settled() { return this.readyMap !== undefined && this.loadedSheets > 0 && this.pendingVisible.size === 0; }
  async init() {
    await this.app.init({
      background: '#000000', antialias: false, preference: 'webgl',
      resolution: canvasResolution(classicScaleNow().scale, classicScaleNow().dpr, classicScaleNow().mode), autoDensity: true,
      width: this.host.clientWidth, height: this.host.clientHeight,
    });
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'Argentum map. Use arrow keys or W A S D to walk.');
    this.host.prepend(this.app.canvas);
    this.app.stage.addChild(this.world);
    for (let i = 0; i < 9; i++) {
      const container = new Container(); this.world.addChild(container); this.pools.push(new SpritePool(container));
    }
    // Pool 4 is the row pass: characters, big objects and the row layer, interleaved per map row (rowSlot). Pools 3 and 5 stay empty.
    this.pools[4]!.container.sortableChildren = true;
    this.world.addChild(this.labelLayer);
    this.fx = new FxRenderer({ animation: id => this.animation(id), texture: frame => this.texture(frame), hasGraphic: id => this.graphics.has(id) });
    this.roofPool = new RoofMeshPool(this.pools[6]!.container);
    this.fx.attach(this.world, this.app.stage, this.pools[6]!.container);
    this.observer = new ResizeObserver(() => this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight));
    // With ?scale=fill|whole the backing store follows the classic window's on-screen size (device pixels), so the browser never resamples the
    // frame: a 736x608 canvas shown at 2.56 device px per pixel renders 1882x1555, not 1472x1216 stretched again by the CSS scale.
    this.unscale = onClassicScale((scale, dpr, mode) => this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight, canvasResolution(scale, dpr, mode)));
    this.observer.observe(this.host);
    this.app.ticker.maxFPS = 60;
  }
  private loadMetadata(): Promise<void> {
    // Character extras degrade to "no equipment / no names" with one report, never block the map.
    const optional = <T>(load: Promise<T>, name: string) => load.catch(error => { this.report(`${name}: ${String(error)}`); return undefined; });
    return this.metadata ??= Promise.all([
      fetchText('init/graficos.ini'), fetchText('init/cuerpos.dat'), fetchText('init/moldes.ini'), fetchBytes('init/cabezas.ind'),
      loadObjectIni().catch(() => new Map() as Ini),
      optional(fetchText('init/armas.dat'), 'armas.dat'), optional(fetchText('init/escudos.dat'), 'escudos.dat'),
      optional(fetchBytes('init/cascos.ind'), 'cascos.ind'), optional(fetchText('init/colores.dat'), 'colores.dat'),
      optional(fetchBytes('init/particles.ind'), 'particles.ind'), optional(fetchText('init/ProjectileDef.dat'), 'ProjectileDef.dat'),
    ]).then(([graphics, bodies, molds, heads, objects, weapons, shields, helmets, colors, particles, projectiles]) => {
      if (particles) fxTables.streams = parseParticles(particles);
      if (projectiles) fxTables.projectiles = parseProjectiles(parseIni(projectiles));
      this.objectGraphics = objectGraphicsFromIni(objects);
      this.graphics = parseGraphics(graphics); this.bodies = parseIni(bodies);
      this.molds = parseIni(molds); this.heads = parseHeads(heads);
      this.colors = colors ? parseColors(colors) : new Map();
      this.sprites = new CharacterSprites({
        graphics: this.graphics, bodies: this.bodies, molds: this.molds, heads: this.heads,
        helmets: helmets ? parseHeads(helmets) : [], weapons: weapons ? parseIni(weapons) : new Map(),
        shields: shields ? parseIni(shields) : new Map(), animation: id => this.animation(id),
      });
    }).catch(error => { this.metadata = undefined; throw error; });
  }
  async loadMap(id: number) {
    const epoch = ++this.epoch;
    this.readyMap = undefined; this.map = undefined; this.fixed = new Map(); this.trees.clear(); this.trees4.clear();
    this.pools.forEach(pool => { pool.reset(); pool.finish(); });
    this.fx?.clear(); this.roofPool?.clear();
    // Keep texture memory bounded to the current map. Late loads are discarded.
    for (const texture of this.textures.values()) if (texture !== Texture.EMPTY) texture.destroy();
    for (const source of this.sources.values()) source.destroy(true);
    this.textures.clear(); this.sources.clear(); this.pending.clear(); this.failed.clear(); this.loadedSheets = 0; this.clippedFrames = 0;
    this.pendingVisible.clear(); this.deferred.clear(); this.deferredLoading = 0;
    const [bytes] = await Promise.all([fetchBytes(`Mapas/mapa${id}.csm`), this.loadMetadata()]);
    if (epoch !== this.epoch) return;
    this.map = parseMap(bytes); this.fixed = fixedObjects(this.map.objects, this.objectGraphics); this.mapName = this.map.name; this.roofTrig = roofTriggers(this.map.triggers); this.roofs.reset(this.roofTrig); this.readyMap = id;
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
  /** frmMapaGrande preview: the walk animation and head graphic of an NPC body / head for headings 1..4, and BodyData(body).HeadOffset.y. */
  async npcPreview(body: number, head: number): Promise<{ walk: (Animation | undefined)[]; head: (Animation | undefined)[]; headOffsetY: number }> {
    await this.loadMetadata();
    const data = body ? this.sprites?.body(body) : undefined;
    const headOffsetY = Number((this.bodies.get(`body${body}`)?.get('headoffsety') ?? '0').split("'")[0]);
    return {
      walk: [1, 2, 3, 4].map(h => data?.walk[h - 1]),
      head: [1, 2, 3, 4].map(h => { const grh = head ? this.heads[head]?.[h - 1] : 0; return grh ? this.animation(grh) : undefined; }),
      headOffsetY,
    };
  }
  /**
   * Sheets on demand, on-screen first (#79). The frame walks ten tiles past the viewport (big trees and buildings reach in from there),
   * and on a slow link the sheets used only out there must not delay the ones the player sees: they wait in `deferred` and download
   * two at a time once nothing visible is pending. A deferred sheet that comes into view starts at once.
   */
  private texture(frame: GraphicFrame, visible = true): Texture {
    const key = `${frame.file}/${frame.x}/${frame.y}/${frame.width}/${frame.height}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    const source = this.sources.get(frame.file);
    if (!source) { this.requestSheet(frame.file, visible); return Texture.EMPTY; }
    const crop = clipFrame(frame, source.width, source.height);
    if (crop.clipped) this.clippedFrames++;
    if (!crop.width || !crop.height) { this.textures.set(key, Texture.EMPTY); return Texture.EMPTY; }
    const texture = new Texture({
      source: source.source, frame: new Rectangle(frame.x, frame.y, crop.width, crop.height),
      orig: new Rectangle(0, 0, frame.width, frame.height), trim: new Rectangle(0, 0, crop.width, crop.height),
    });
    this.textures.set(key, texture); return texture;
  }
  private readonly pendingVisible = new Set<number>();
  private readonly deferred = new Set<number>();
  private deferredLoading = 0;
  private requestSheet(file: number, visible: boolean) {
    if (this.failed.has(file)) return;
    if (!visible) { if (!this.pending.has(file)) this.deferred.add(file); return; }
    this.pendingVisible.add(file);
    if (this.deferred.delete(file) || !this.pending.has(file)) this.loadSheet(file);
  }
  /** Start deferred (margin) sheets while nothing on screen is waiting. */
  private pumpDeferred() {
    for (const file of this.deferred) {
      if (this.pendingVisible.size > 0 || this.deferredLoading >= 2) return;
      this.deferred.delete(file); this.deferredLoading++; this.loadSheet(file, true);
    }
  }
  private loadSheet(file: number, margin = false) {
    if (this.pending.has(file) || this.failed.has(file)) { if (margin) this.deferredLoading--; return; }
    this.pending.add(file);
    const epoch = this.epoch;
    const image = new Image();
    const done = () => { this.pending.delete(file); this.pendingVisible.delete(file); if (margin) this.deferredLoading--; };
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
      done();
    };
    image.onerror = () => {
      if (epoch !== this.epoch) return;
      done(); this.failed.add(file); this.report(`Missing local graphic: Graficos/${file}.png`);
    };
    image.src = assetUrl(`Graficos/${file}.png`);
  }
  /** The viewport of the frame being drawn, in world pixels (draw() asks whether a sprite reaches into it). */
  private view = { x: 0, y: 0, width: 0, height: 0 };
  private draw(pool: SpritePool, animation: Animation, x: number, y: number, time: number, centered = true, alpha = 1, tint = 0xffffff, slot?: number) {
    const frame = animation.frames[Math.floor(time / animation.frameMs) % animation.frames.length]!;
    const left = x + (centered ? Math.floor((32 - frame.width) / 2) : 0), top = y + (centered ? 32 - frame.height : 0), v = this.view;
    const visible = left < v.x + v.width && left + frame.width > v.x && top < v.y + v.height && top + frame.height > v.y;
    pool.draw(this.texture(frame, visible), left, top, alpha, tint, slot);
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
  /** Sound data of the loaded map (tMapDat music, ambient, weather flags). */
  /** Static Blocked byte and trigger of a tile of the loaded map (MapData(x, y).Blocked / .Trigger), for the walk legality check. */
  legalTileAt(x: number, y: number) {
    if (!this.map) return undefined;
    const i = tileIndex(x, y), l = this.map.layers;
    return { blocked: this.map.blocked[i]! | graphicFlags(l[0]![i]!, l[1]![i]!, l[2]![i]!), trigger: this.map.triggers[i]! };
  }
  get mapAudio() { return this.map?.audio; }
  /** TileEngine.HayTecho at a tile: the player is under a roof (indoor rain sounds). */
  roofAt(x: number, y: number) { return hayTecho(this.roofTrig[(y - 1) * 100 + x - 1] ?? 0); }
  /**
   * What DoPasosFx reads under a character: the file number of layer 1 (GrhData(Graphic(1)).FileNum; an animation uses its first
   * frame's file) and the layer-3 (else layer-2) graphic that covers it.
   */
  terrainAt(x: number, y: number): { file: number; overlay: number } | undefined {
    if (!this.map || x < 1 || y < 1 || x > 100 || y > 100) return undefined;
    const tile = (y - 1) * 100 + x - 1;
    return { file: this.grhFile(this.map.layers[0]![tile] ?? 0), overlay: this.map.layers[2]![tile] || this.map.layers[1]![tile] || 0 };
  }
  /** GrhData(grh).FileNum; an animation reports the file of its first frame. */
  grhFile(grh: number): number {
    const entry = grh ? this.graphics.get(grh) : undefined;
    const first = entry && 'ids' in entry ? this.graphics.get(entry.ids[0] ?? 0) : entry;
    return first && 'file' in first ? first.file : 0;
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
    this.view = { x: Math.round(cameraX), y: Math.round(cameraY), width, height };
    const dt = this.lastRender ? Math.min(100, now - this.lastRender) : 16; this.lastRender = now;
    this.roofs.update(this.roofTrig[(session.position!.y - 1) * 100 + session.position!.x - 1] ?? 0, dt);
    this.pools.forEach(pool => pool.reset()); this.roofPool!.begin();
    const minX = Math.max(1, Math.floor(cameraX / 32) - 10), maxX = Math.min(100, Math.ceil((cameraX + width) / 32) + 10);
    const minY = Math.max(1, Math.floor(cameraY / 32) - 2), maxY = Math.min(100, Math.ceil((cameraY + height) / 32) + 10);
    // RenderScreen order: layer 1, then layers 2 and 3 as WHOLE passes (RenderWalkableMapLayers), then ONE pass of traps and ground
    // objects, then the row pass (characters, big objects, layer 4), then roofs. Index 2 of `layers` is VB6 Graphic(3), index 3 Graphic(4).
    const each = (visit: (x: number, y: number, tile: number) => void) => {
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) visit(x, y, (y - 1) * 100 + x - 1);
    };
    for (const layer of [0, 1, 2]) {
      each((x, y, tile) => { const id = this.map!.layers[layer]![tile]!; if (id) this.draw(this.pools[layer]!, this.animation(id), x * 32, y * 32, now, layer !== 0); });
    }
    each((x, y, tile) => {
      const pool = this.pools[2]!;
      // Traps (UpdateTrap) first, at alpha 100/255, then the object Select Case (every type, `Case Else` included).
      if (session.status.hasTrap(x, y)) this.draw(pool, this.animation(TRAP_GRH), x * 32, y * 32, now, true, TRAP_ALPHA);
      const object = session.mapObjects.objectAt(x, y) ?? this.fixed.get(tile);
      for (const draw of objectDraws(object, this.objectGraphics)) if (draw.pass === 'ground') this.draw(pool, this.animation(draw.grh), x * 32, y * 32, now, true);
    });
    each((x, y, tile) => {
      // RenderScreen "Layer 3 & chars": for each row y, the characters standing on row y, then that row's big objects and layer
      // Graphic(3). So an object one row south of a character (an altar in front of a priest) covers the character's lower body.
      const pool = this.pools[4]!, slot = rowSlot(y, 'objects');
      const object = session.mapObjects.objectAt(x, y) ?? this.fixed.get(tile);
      for (const draw of objectDraws(object, this.objectGraphics)) {
        if (draw.pass !== 'row') continue;
        // Trees fade when they cover the player.
        const alpha = draw.type === ObjType.Tree ? this.trees.step(tile, treeCoversPlayer(session.position!, x, y), dt) : 1;
        this.draw(pool, this.animation(draw.grh), x * 32, y * 32, now, true, alpha, undefined, slot);
      }
      const id = this.map!.layers[3]![tile]!;
      // Row-pass layer with FLAG_ARBOL (pinned Graphic(3) holding a tree Grh, TREE_GRH_INDICES) fades like the object trees, over a wider area (RenderScreen: |dx| <= 3, |dy| < 12).
      if (id) this.draw(pool, this.animation(id), x * 32, y * 32, now, true, TREE_GRH_INDICES.has(id) ? this.trees4.step(tile, layer4TreeCoversPlayer(session.position!, x, y), dt) : 1, undefined, slot);
    });
    each((x, y, tile) => {
      const id = this.map!.layers[4]![tile]!;
      if (!id) return;
      // Live VB6 roof rule: one alpha per roof trigger, 3x3 NearRoof, the player's own roof fades out.
      const trigger = nearRoof(this.roofTrig, x, y);
      // Roofs sit above the light map and the particles. RenderScreen draws them with the tile's FOUR vertex colours
      // (Copy_RGBAList_WithAlpha(TempColor, .light_value, RoofsLight(Trigger)) -> clsBatch.Draw, one colour per corner), not their mean.
      const animation = this.animation(id), frame = animation.frames[Math.floor(now / animation.frameMs) % animation.frames.length]!;
      this.roofPool!.add(this.texture(frame), x * 32 + Math.floor((32 - frame.width) / 2), y * 32 + 32 - frame.height,
        this.fx!.roofCorners(session.world, x, y), trigger ? this.roofs.alphaOf(trigger) : 1);
    });
    this.roofPool!.end();
    this.camera = { x: cameraX, y: cameraY };
    this.drawCharacters(session, position, now, cameraX, cameraY, width, height);
    this.drawEffects(session, now, position);
    this.renderWorldFx(session, now, dt, { minX, maxX, minY, maxY }, cameraX, cameraY, width, height);
    this.pools.forEach(item => item.finish());
    this.pumpDeferred();
  }
  /** Light, particles, projectiles, auras and weather: apply the parsed map once, advance the world FX, draw them. */
  private renderWorldFx(session: Session, now: number, dt: number, view: FrameInfo['view'], cameraX: number, cameraY: number, width: number, height: number) {
    const world = session.world, map = this.map;
    if (!map || !this.fx) return;
    if (world.appliedGeneration !== world.generation) world.setMap(map.info, map.lights, map.particles);
    const charPixel = (charIndex: number) => {
      if (charIndex === session.charIndex) { const p = session.visualPosition(now); return p ? { x: p.x * 32, y: p.y * 32 } : undefined; }
      const char = session.tracker.chars.get(charIndex);
      if (!char) return undefined;
      const at = session.tracker.visualPosition(char, now);
      return { x: at.x * 32, y: at.y * 32 };
    };
    world.update(now, { dt, view, charPixel, selfDead: session.dead });
    this.fx.render(world, {
      session, now, dt, cameraX, cameraY, width, height, charPixel,
      charBodyOffsetY: charIndex => this.bodyY(charIndex === session.charIndex ? session.self?.body ?? 0 : session.tracker.chars.get(charIndex)?.body ?? 0),
    });
  }
  /** BodyOffset.y of a body (negative above the tile): where Char_Render anchors a character's particle groups. */
  private bodyY(id: number) {
    let body = this.bodyCache.get(id);
    if (!body && id > 0) { try { body = readBody(this.bodies, this.molds, this.graphics, id); this.bodyCache.set(id, body); } catch { return 0; } }
    return body?.bodyY ?? 0;
  }
  /** Grh index of a head facing south (cabezas.ind), for overlays that draw only the head (party frames). */
  hasGraphic(id: number): boolean { return this.graphics.has(id); }
  headGrh(head: number): number | undefined { return this.heads[head]?.[2] || undefined; }
  /** Sprites of a stationary character with its equipment (account screen, character creation), in the VB6 layer order for `heading` (1 N, 2 E, 3 S, 4 W). */
  characterLayers(char: { body: number; head: number; weapon?: number; shield?: number; helmet?: number }, heading = 3) {
    return this.sprites?.layers({ weapon: 0, shield: 0, helmet: 0, ...char } as never, heading) ?? [];
  }
  /** ColoresPJ(index) from init/colores.dat (name colours of the account screen). */
  pjColor(index: number): Rgb { return colorPj(this.colors, index); }
  /** Sprites of a stationary south-facing character, for the NPC dialog portrait. */
  portraitLayers(body: number, head: number) {
    return this.sprites?.layers({ body, head, weapon: 0, shield: 0, helmet: 0 } as never, 3) ?? [];
  }
  private label(text: string, color: Rgb, x: number, y: number, size = 11, bottom = false) {
    let label = this.labels[this.labelsUsed++];
    if (!label) {
      label = new Text({ text, style: { fontFamily: 'Tahoma, Verdana, sans-serif', fontSize: size, fontWeight: 'bold', fill: '#ffffff', stroke: { color: '#000000', width: 3 }, align: 'center', wordWrap: true, wordWrapWidth: 170 } });
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
    const chars = [...tracker.chars.values()]; // self included: its CharacterCreate passes through the tracker too
    const placed = chars.map(char => {
      if (char.charIndex === session.charIndex) {
        const moving = !!session.motion && !session.motion.translate && now < session.motion.started + session.motion.duration;
        return { char, row: session.position?.y ?? Math.round(selfPosition.y), heading: session.self!.heading as number, x: selfPosition.x, y: selfPosition.y, moving, elapsed: moving ? Math.max(0, now - session.motion!.started) : 0 };
      }
      const view = tracker.visualPosition(char, now);
      return { char, row: char.y, heading: char.heading as number, ...view };
    }).filter(({ x, y }) => x * 32 > cameraX - 96 && x * 32 < cameraX + width + 96 && y * 32 > cameraY - 96 && y * 32 < cameraY + height + 96)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const pool = this.pools[4]!;
    for (const { char, row, heading, x, y, moving, elapsed } of placed) {
      const px = x * 32, py = y * 32;
      // RenderScreen draws a character in the row of its MapData tile (the destination while it walks), before that row's objects.
      const slot = rowSlot(row, 'characters');
      // SetInvisible: an invisible character is drawn at alpha 100/255 for those who may see it (itself) and not at all for the rest.
      const alpha = session.status.alphaOf(char.charIndex, session.charIndex, char.charIndex === session.charIndex);
      if (alpha === undefined) continue;
      for (const layer of sprites.layers(char, heading)) {
        // ArmaMov / EscudoMov (HandleArmaMov: only while the character is not moving): the weapon or shield animation runs once from the packet.
        let time = layer.walks && moving ? elapsed : 0;
        const swingStart = moving ? undefined : layer.part === 'weapon' ? session.combat.swings.get(char.charIndex) : layer.part === 'shield' ? session.status.shieldSwings.get(char.charIndex) : undefined;
        if (swingStart !== undefined) {
          const sinceSwing = now - swingStart, length = layer.animation.frames.length * layer.animation.frameMs;
          if (sinceSwing >= 0 && sinceSwing < length) time = sinceSwing;
        }
        this.draw(pool, layer.animation, px + layer.x, py + layer.y, time, true, alpha, undefined, slot);
      }
      // Quest marker (engine.bas Char_Render, .simbolo): grh 5257 + symbol, 48 px above the head, bobbing 8 px; drawn even with names hidden.
      const marker = char.npc && char.symbol && sprites.body(char.body) ? sprites.headOffset(char.body) : undefined;
      if (char.symbol && marker) this.draw(pool, this.animation(5257 + char.symbol), px + 6 + marker.x, py + marker.y - 48 - 8 * Math.sin((now % 31415) * 0.002) ** 2, now, false, 1, undefined, slot);
      // A blind player sees no names (engine.bas Char_Render: UserCiego -> MostrarNombre = False).
      if (!this.showNames || session.status.blind) { /* HideNames */ } else if (char.npc) {
        // NPC names appear only under the cursor, in (0,129,195).
        if (this.hoverTile && this.hoverTile.x === char.x && this.hoverTile.y === char.y && char.name) {
          this.label(char.name, NPC_NAME_COLOR, px + 16, py + 31);
          if (char.clan) this.label(char.clan, NPC_NAME_COLOR, px + 16, py + 43);
        }
      } else if (char.name) {
        const self = session.self;
        // Team > 0 (an event): TeamColors name, "<Equipo N>" tag and the carried flag (banderaIndex, UpdateFlag).
        const color = char.team > 0 ? TEAM_COLORS[Math.min(char.team, 10)]! : playerNameColor(this.colors, char.status, char.privileges, char.groupIndex > 0 && self !== undefined && self.groupIndex === char.groupIndex);
        this.label(char.name, color, px + 16, py + 31);
        const title = char.team > 0 ? `<Equipo ${char.team}>` : privilegeTitle(Math.round(char.privileges ? Math.log2(char.privileges) : 0)) ?? char.clan;
        // The tag: yellow for the player's own guild, else the colour of the guild's alignment (GetClanTagColor), else the name colour.
        const ownGuild = char.clanIndex > 0 && self !== undefined && self.clanIndex === char.clanIndex && char.charIndex !== session.charIndex && char.team <= 0;
        const tagColor = ownGuild ? OWN_CLAN_COLOR : char.clanIndex > 0 && char.team <= 0 ? clanTagColor(this.colors, char.clanAlignment) ?? color : color;
        if (title) this.label(title, tagColor, px + 16, py + 43);
        const flag = char.team > 0 ? FLAG_GRH[char.banderaIndex] : undefined;
        const body = flag ? sprites.body(char.body) : undefined;
        if (flag && body && this.graphics.has(flag)) this.draw(pool, this.animation(flag), px + 1 + body.bodyX, py - 45 + body.bodyY, now, true, 1, undefined, slot);
      }
      // Overhead speech is drawn once, by ChatBubbles from ChatState (chat #7); the tracker's dialog only feeds the NPC window.
    }
    for (let i = this.labelsUsed; i < this.labels.length; i++) this.labels[i]!.visible = false;
  }
  private selfBodyY(session: Session) { return this.bodyY(session.self?.body ?? 0); }
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
      // Meditation: engine.bas Draw_Animation at (+BodyOffset, +4), alpha 180 (Initialize: alpha False, i.e. normal blend). The classic FX 115-119 are
      // IsPNG=0 palette art that is mostly opaque in normal blend and hides the character, so they use the classic 0.13 look instead
      // (ao-libre TileEngine: additive, alpha 180); FX 120 and any other id keep the pinned normal blend.
      if (fx.meditation) { this.draw(this.pools[fx.fx >= 115 && fx.fx <= 119 ? 7 : 8]!, data.animation, x * 32 + data.offsetX, y * 32 + data.offsetY + 4 + body, now - fx.startedAt, true, 180 / 220); continue; }
      this.draw(this.pools[data.png ? 8 : 7]!, data.animation, x * 32 + data.offsetX, y * 32 + data.offsetY + 20 + body, now - fx.startedAt);
    }
  }
  destroy() {
    this.epoch++; this.observer?.disconnect(); this.unscale?.(); this.fx?.destroy();
    this.app.destroy(true, { children: true });
    for (const texture of this.textures.values()) if (texture !== Texture.EMPTY) texture.destroy();
    for (const source of this.sources.values()) source.destroy(true);
  }
}
