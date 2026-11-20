/*
 * Layer ordering/anchor translation from Argentum 20 CODIGO/TileEngine_RenderScreen.bas,
 * engine.bas: Draw_Grh, and Graficos_Renderizado.bas: character body/head drawing.
 * Copyright (C) 2022 Noland Studios. GNU AGPL version 3 or any later version.
 * WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See ../../../LICENSE and ../../../NOTICE.
 */
import { Container, Sprite, WebGLRenderer } from 'pixi.js';
import { graphicOffset, TILE_SIZE } from '@ao/formats';
import type { Body, GameMap, GraphicFrame } from '@ao/formats';
import type { CharacterCreate } from '@ao/protocol';
import { GameAssets } from './assets.js';

interface Tile {
  x: number; y: number; layer: number; frames: GraphicFrame[]; duration: number;
  left: number; top: number; right: number; bottom: number;
}
interface TileSprite { tile: Tile; sprite: Sprite }

export class WorldRenderer {
  private readonly renderer = new WebGLRenderer();
  private readonly stage = new Container();
  private readonly world = new Container();
  private readonly layers = Array.from({ length: 5 }, () => new Container());
  private readonly actor = new Container();
  private bodySprite = new Sprite();
  private headSprite = new Sprite();
  private map: GameMap | undefined;
  private tiles: Tile[] = [];
  private visible: TileSprite[] = [];
  private body: Body | undefined;
  private heads: GraphicFrame[] = [];
  private player: CharacterCreate | undefined;
  private movingUntil = 0;
  private walkStarted = 0;
  private cameraKey = '';
  private generation = 0;
  private zoom = 1;
  private showRoofs = true;
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private pending = 0;
  private width = 1;
  private height = 1;

  constructor(private readonly host: HTMLElement, readonly assets: GameAssets, private readonly fail: (error: Error) => void) {
    this.stage.addChild(this.world);
    this.world.addChild(...this.layers);
    this.layers[3]!.sortableChildren = true;
    this.actor.addChild(this.bodySprite, this.headSprite);
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }
  async init(): Promise<void> {
    await this.renderer.init({
      width: 1, height: 1, backgroundColor: 0x111c1d, autoDensity: true,
      resolution: window.devicePixelRatio || 1, antialias: false, roundPixels: true,
      manageImports: false,
    });
    this.renderer.canvas.setAttribute('aria-label', 'Argentum game world. Move with arrow keys, WASD, or the touch controls.');
    this.host.prepend(this.renderer.canvas);
    this.resizeObserver.observe(this.host);
    this.resize();
  }
  private resize(): void {
    if (this.disposed) return;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.resize(this.width, this.height, window.devicePixelRatio || 1);
    this.cameraKey = '';
  }
  async setMap(map: GameMap, player: CharacterCreate): Promise<void> {
    this.map = map;
    this.player = player;
    this.body = this.assets.body(player.body);
    this.heads = player.head ? this.assets.head(player.head) : [];
    this.tiles = map.layers.flatMap((layer, index) => layer.map(tile => {
      const frames = this.assets.frames(tile.grh);
      const animation = this.assets.graphics.entries.get(tile.grh)!;
      const baseX = (tile.x - 1) * TILE_SIZE, baseY = (tile.y - 1) * TILE_SIZE;
      const width = Math.max(...frames.map(frame => frame.width)), height = Math.max(...frames.map(frame => frame.height));
      const left = index === 0 ? baseX : baseX + 16 - Math.floor(width / 2);
      const top = index === 0 ? baseY : baseY + 32 - height;
      return { x: tile.x, y: tile.y, layer: index, frames, duration: animation.kind === 'animation' ? animation.durationMs : 0,
        left, top, right: left + width, bottom: top + height };
    }));
    // Sparse overlay records are sorted explicitly to reproduce VB6 y/x loops.
    this.tiles.sort((a, b) => a.layer - b.layer || a.y - b.y || a.x - b.x);
    await this.assets.ensure([...this.body.directions.flatMap(d => d.frames), ...this.heads]);
    this.cameraKey = '';
    await this.updateViewport();
  }
  setPlayer(player: CharacterCreate, moved: boolean, walkMs: number): void {
    this.player = player;
    if (moved) {
      this.walkStarted = performance.now();
      this.movingUntil = this.walkStarted + walkMs;
    }
  }
  setZoom(zoom: number): void { this.zoom = Math.max(1, Math.min(3, zoom)); this.cameraKey = ''; }
  get currentZoom(): number { return this.zoom; }
  setRoofs(show: boolean): void { this.showRoofs = show; }
  get isSettled(): boolean { return this.pending === 0 && this.visible.length > 0; }
  get spriteCount(): number { return this.visible.length + 2; }
  private camera(): { x: number; y: number } {
    const player = this.player!;
    return { x: (player.x - 0.5) * 32 - this.width / this.zoom / 2, y: (player.y - 0.5) * 32 - this.height / this.zoom / 2 };
  }
  private async updateViewport(): Promise<void> {
    if (!this.map || !this.player || this.disposed) return;
    const generation = ++this.generation;
    const camera = this.camera();
    const key = `${this.player.x},${this.player.y},${this.width},${this.height},${this.zoom}`;
    this.cameraKey = key;
    // Cull against artwork bounds, not tile anchors: a tall tree can start offscreen.
    const tiles = this.tiles.filter(tile => tile.right >= camera.x - 32 && tile.left <= camera.x + this.width / this.zoom + 32 &&
      tile.bottom >= camera.y - 32 && tile.top <= camera.y + this.height / this.zoom + 32);
    this.pending++;
    try {
      await this.assets.ensure(tiles.flatMap(tile => tile.frames));
      if (this.disposed || generation !== this.generation) return;
      for (const { sprite } of this.visible) sprite.destroy();
      this.visible = [];
      for (const tile of tiles) {
        const sprite = new Sprite(this.assets.texture(tile.frames[0]!));
        sprite.zIndex = (tile.y * 101 + tile.x) * 2 + 1;
        this.layers[tile.layer]!.addChild(sprite);
        this.visible.push({ tile, sprite });
      }
      this.layers[3]!.addChild(this.actor);
    } finally { this.pending--; }
  }
  draw(now: number): void {
    if (this.disposed || !this.map || !this.player || !this.body) return;
    if (this.renderer.resolution !== (window.devicePixelRatio || 1)) this.resize();
    const key = `${this.player.x},${this.player.y},${this.width},${this.height},${this.zoom}`;
    if (key !== this.cameraKey) void this.updateViewport().catch(error => this.fail(error as Error));
    const camera = this.camera();
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(-camera.x * this.zoom), Math.round(-camera.y * this.zoom));
    for (const { tile, sprite } of this.visible) {
      const frame = tile.frames[tile.duration ? Math.floor(now % tile.duration / tile.duration * tile.frames.length) : 0]!;
      sprite.texture = this.assets.texture(frame);
      const offset = tile.layer === 0 ? { x: 0, y: 0 } : graphicOffset(frame);
      sprite.position.set((tile.x - 1) * 32 + offset.x, (tile.y - 1) * 32 + offset.y);
    }
    const heading = Math.max(1, Math.min(4, this.player.heading)) - 1;
    const direction = this.body.directions[heading]!;
    // An input event can run after this RAF's timestamp was sampled. Clamp the
    // elapsed time so the first frame can never become index -1 on touch/resize.
    const elapsed = Math.max(0, now - this.walkStarted);
    const frame = direction.frames[now < this.movingUntil ? Math.floor(elapsed % direction.durationMs / direction.durationMs * direction.frames.length) : 0]!;
    this.bodySprite.texture = this.assets.texture(frame);
    const bodyOffset = graphicOffset(frame);
    this.bodySprite.position.set(bodyOffset.x + this.body.offset.x + (this.player.body < 488 ? 1 : 0), bodyOffset.y + this.body.offset.y);
    this.headSprite.visible = this.heads.length > 0;
    if (this.heads.length) {
      const head = this.heads[heading]!, offset = graphicOffset(head);
      this.headSprite.texture = this.assets.texture(head);
      this.headSprite.position.set(offset.x + this.body.headOffset.x, offset.y + this.body.headOffset.y);
    }
    this.actor.position.set((this.player.x - 1) * 32, (this.player.y - 1) * 32);
    this.actor.zIndex = (this.player.y * 101 + this.player.x) * 2;
    this.layers[4]!.visible = this.showRoofs;
    this.renderer.render(this.stage);
  }
  destroy(): void {
    this.disposed = true; this.generation++;
    this.resizeObserver.disconnect();
    this.stage.destroy({ children: true });
    this.renderer.destroy(true);
    this.assets.destroy();
  }
}
