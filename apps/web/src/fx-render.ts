/*
 * Drawing of the world FX: the light map, particles, projectiles, auras and the weather (rain, snow, fog). Adapted 2026-11-20 from
 * the classic client's TileEngine_RenderScreen.RenderScreen (particle, projectile and weather passes), Graficos_Particulas.Particle_Render,
 * TileEngine_Map.Engine_Weather_UpdateFog and engine.Renderizar_Aura. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See ../../../LICENSE and ../../../NOTICE.
 *
 * VB6 shades every sprite with four per-tile vertex colours. Here one multiply mesh, one quad per visible tile with those four
 * colours, is drawn over the ground, objects and characters (a single draw call, rebuilt only when the light changes).
 */
import { Container, Geometry, GlProgram, Mesh, Shader, Sprite, Texture, Buffer, BufferUsage } from 'pixi.js';
import type { Animation, GraphicFrame } from './assets.js';
import { averageTint } from './fx-particles.js';
import type { GroupDraw, Particle, ParticleGroup, Rgb } from './fx-particles.js';
import { FOG_LAYER_1_GRH, FOG_LAYER_2_GRH, METEO_SCREEN } from './fx-world.js';
import type { WorldFx } from './fx-world.js';
import type { Session } from './session.js';

/** What the renderer lends: animated Grh frames, their textures and whether a graphic exists. */
export interface FxHost {
  animation(id: number): Animation;
  texture(frame: GraphicFrame): Texture;
  hasGraphic(id: number): boolean;
}

const rgbToTint = (c: Rgb) => (c.r << 16) | (c.g << 8) | c.b;

/** A growing pool of sprites that is reset every frame. */
class SpriteBin {
  private sprites: Sprite[] = [];
  private used = 0;
  constructor(readonly container: Container) {}
  begin() { this.used = 0; }
  add(texture: Texture, x: number, y: number, tint: number, alpha: number, width?: number, height?: number, rotation = 0) {
    let sprite = this.sprites[this.used++];
    if (!sprite) { sprite = new Sprite(); this.sprites.push(sprite); this.container.addChild(sprite); }
    sprite.texture = texture; sprite.tint = tint; sprite.alpha = alpha; sprite.visible = true;
    // Rotation turns around the sprite centre (clsBatch.Draw): anchor the centre and move the position to it.
    const w = width ?? texture.width, h = height ?? texture.height;
    if (rotation) { sprite.anchor.set(0.5); sprite.rotation = rotation; sprite.position.set(Math.round(x + w / 2), Math.round(y + h / 2)); }
    else { sprite.anchor.set(0); sprite.rotation = 0; sprite.position.set(Math.round(x), Math.round(y)); }
    if (width !== undefined && height !== undefined) { sprite.width = width; sprite.height = height; } else sprite.scale.set(1);
  }
  end() { for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false; }
  /** Textures are destroyed on a map change: drop every reference. */
  clear() { for (const sprite of this.sprites) { sprite.visible = false; sprite.texture = Texture.EMPTY; } this.used = 0; }
}

const MAX_TILES_X = 48, MAX_TILES_Y = 40;
const VERTEX_SOURCE = `
in vec2 aPosition;
in vec4 aColor;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vColor = aColor;
}`;
const FRAGMENT_SOURCE = `
in vec4 vColor;
out vec4 finalColor;
void main() { finalColor = vec4(vColor.rgb, 1.0); }`;

/** The multiply light map: tile (x, y) covers pixels (x*32, y*32)..+32, vertices ordered bottom-left, top-left, bottom-right, top-right. */
class LightMesh {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly positions = new Float32Array(MAX_TILES_X * MAX_TILES_Y * 8);
  private readonly colors = new Uint8Array(MAX_TILES_X * MAX_TILES_Y * 16);
  private readonly positionBuffer: Buffer;
  private readonly colorBuffer: Buffer;
  private range = { minX: 0, maxX: -1, minY: 0, maxY: -1 };
  private version = -1;
  private quads = 0;

  constructor() {
    this.positionBuffer = new Buffer({ data: this.positions, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.colorBuffer = new Buffer({ data: this.colors, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const indices = new Uint32Array(MAX_TILES_X * MAX_TILES_Y * 6);
    for (let q = 0; q < MAX_TILES_X * MAX_TILES_Y; q++) indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.positionBuffer, format: 'float32x2', stride: 8, offset: 0 },
        aColor: { buffer: this.colorBuffer, format: 'unorm8x4', stride: 4, offset: 0 },
      },
      indexBuffer: indices,
    });
    const shader = new Shader({ glProgram: GlProgram.from({ vertex: VERTEX_SOURCE, fragment: FRAGMENT_SOURCE, name: 'ao-light-map' }), resources: {} });
    this.mesh = new Mesh({ geometry, shader });
    this.mesh.blendMode = 'multiply';
    this.mesh.state.depthTest = false;
  }

  /** Rebuild the vertex data for the visible tiles; positions only when the range moved, colours when the light changed. */
  update(world: WorldFx, minX: number, maxX: number, minY: number, maxY: number) {
    minX = Math.max(1, minX); minY = Math.max(1, minY); maxX = Math.min(100, maxX); maxY = Math.min(100, maxY);
    if (maxX - minX + 1 > MAX_TILES_X) maxX = minX + MAX_TILES_X - 1;
    if (maxY - minY + 1 > MAX_TILES_Y) maxY = minY + MAX_TILES_Y - 1;
    const moved = minX !== this.range.minX || maxX !== this.range.maxX || minY !== this.range.minY || maxY !== this.range.maxY;
    if (!moved && this.version === world.lights.version) return;
    const data = world.lights.data;
    let q = 0;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++, q++) {
      const px = x * 32, py = y * 32, p = q * 8, c = q * 16, at = ((y - 1) * 100 + x - 1) * 12;
      // BL, TL, BR, TR
      this.positions[p] = px; this.positions[p + 1] = py + 32; this.positions[p + 2] = px; this.positions[p + 3] = py;
      this.positions[p + 4] = px + 32; this.positions[p + 5] = py + 32; this.positions[p + 6] = px + 32; this.positions[p + 7] = py;
      for (let v = 0; v < 4; v++) {
        this.colors[c + v * 4] = data[at + v * 3]!; this.colors[c + v * 4 + 1] = data[at + v * 3 + 1]!; this.colors[c + v * 4 + 2] = data[at + v * 3 + 2]!; this.colors[c + v * 4 + 3] = 255;
      }
    }
    // The index buffer always covers the full capacity: quads past the visible ones collapse to a point.
    if (q < this.quads) this.positions.fill(0, q * 8, this.quads * 8);
    this.quads = q; this.range = { minX, maxX, minY, maxY }; this.version = world.lights.version;
    this.positionBuffer.update(); this.colorBuffer.update();
  }
}

/** Everything the FX renderer needs from one frame of the world renderer (camera, characters). */
export interface FxFrame {
  session: Session;
  now: number;
  dt: number;
  cameraX: number; cameraY: number; width: number; height: number;
  /** World pixel of a character's tile top-left, including its slide, plus its body offset (selfBodyY for the player). */
  charPixel: (charIndex: number) => { x: number; y: number } | undefined;
  charBodyOffsetY: (charIndex: number) => number;
}

export class FxRenderer {
  readonly lightMesh = new LightMesh();
  private readonly tileNormal = new SpriteBin(new Container());
  private readonly tileAdd = new SpriteBin(new Container());
  private readonly topNormal = new SpriteBin(new Container());
  private readonly topAdd = new SpriteBin(new Container());
  private readonly meteoNormal = new SpriteBin(new Container());
  private readonly meteoAdd = new SpriteBin(new Container());
  private readonly fogOne = new SpriteBin(new Container());
  private readonly fogTwo = new SpriteBin(new Container());
  private readonly tileLayer = new Container();
  private readonly topLayer = new Container();
  private readonly screenLayer = new Container();

  constructor(private readonly host: FxHost) {
    this.tileAdd.container.blendMode = 'add'; this.topAdd.container.blendMode = 'add'; this.meteoAdd.container.blendMode = 'add';
    this.tileLayer.addChild(this.tileNormal.container, this.tileAdd.container);
    this.topLayer.addChild(this.topNormal.container, this.topAdd.container);
    this.screenLayer.addChild(this.meteoNormal.container, this.meteoAdd.container, this.fogTwo.container, this.fogOne.container);
  }

  /**
   * Layer order inside `world`: ... characters, light map, particles and projectiles, roofs ...; the travelling spell particles and
   * auras go on top of the world; the weather is in screen space above everything but the DOM.
   */
  attach(world: Container, stage: Container, roofs: Container) {
    const at = world.getChildIndex(roofs);
    world.addChildAt(this.lightMesh.mesh, at);
    world.addChildAt(this.tileLayer, at + 1);
    world.addChild(this.topLayer);
    stage.addChild(this.screenLayer);
  }

  /** The four vertex colours of a roof tile (the light map does not cover the roof layer; RenderScreen passes .light_value to Draw_Grh). */
  roofCorners(fx: WorldFx, x: number, y: number) { return fx.lights.tileCorners(x, y); }

  private frameFor(grh: number, elapsed: number): GraphicFrame | undefined {
    if (!this.host.hasGraphic(grh)) return undefined;
    const animation = this.host.animation(grh);
    return animation.frames[Math.floor(Math.max(0, elapsed) / animation.frameMs) % animation.frames.length];
  }

  /**
   * Grh_Render / Grh_Render_Advance: a frame centred on the anchor the VB6 way (a frame that is not 32 px wide or tall is
   * recentred on the tile), tinted by the group colour, additive when the stream says AlphaBlend, optionally resized and rotated.
   */
  private drawParticle(bin: SpriteBin, add: SpriteBin, group: { draw: GroupDraw }, p: Particle, anchorX: number, anchorY: number, now: number) {
    if (!p.grh) return;
    const frame = this.frameFor(p.grh, now - p.spawnedAt);
    if (!frame) return;
    const texture = this.host.texture(frame);
    if (texture === Texture.EMPTY) return;
    const x = anchorX + p.x + (frame.width !== 32 ? 16 - Math.floor(frame.width / 2) : 0);
    const y = anchorY + p.y + (frame.height !== 32 ? 32 - frame.height : 0);
    const tint = rgbToTint(averageTint(group.draw.tint));
    const target = group.draw.alphaBlend ? add : bin;
    const resize = group.draw.resize && group.draw.resizeX > 0 && group.draw.resizeY > 0;
    // Grh_Render_Advance(Height := resizex, Width := resizey) draws a resizey x resizex box.
    target.add(texture, x, y, tint, 1, resize ? group.draw.resizeY : undefined, resize ? group.draw.resizeX : undefined, p.angle > 0 && p.angle <= 360 ? (p.angle * Math.PI) / 180 : 0);
  }
  private drawGroup(bin: SpriteBin, add: SpriteBin, group: ParticleGroup, anchorX: number, anchorY: number, now: number) {
    for (const p of group.particles) this.drawParticle(bin, add, group, p, anchorX, anchorY, now);
  }

  render(world: WorldFx, frame: FxFrame) {
    const { now, cameraX, cameraY, width, height } = frame;
    const minX = Math.floor(cameraX / 32) - 1, maxX = Math.ceil((cameraX + width) / 32) + 1;
    const minY = Math.floor(cameraY / 32) - 1, maxY = Math.ceil((cameraY + height) / 32) + 2;
    this.lightMesh.update(world, minX, maxX, minY, maxY);
    this.tileNormal.begin(); this.tileAdd.begin(); this.topNormal.begin(); this.topAdd.begin();
    this.meteoNormal.begin(); this.meteoAdd.begin(); this.fogOne.begin(); this.fogTwo.begin();

    // Map and floor particle groups at the tile centre (RenderScreen "Particles loop": screenX + 16, screenY + 16).
    for (const [tile, group] of world.tileGroups) {
      const x = (tile % 100) + 1, y = Math.floor(tile / 100) + 1;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      this.drawGroup(this.tileNormal, this.tileAdd, group, x * 32 + 16, y * 32 + 16, now);
    }
    // Character groups: tile centre, at the body offset (Char_Render: PixelOffsetX + BodyOffset.x + 16, PixelOffsetY + BodyOffset.y).
    for (const [charIndex, groups] of world.charGroups) {
      const at = frame.charPixel(charIndex);
      if (!at) continue;
      const y = at.y + frame.charBodyOffsetY(charIndex);
      for (const group of groups) this.drawGroup(this.tileNormal, this.tileAdd, group, at.x + 16, y, now);
    }
    // Projectiles (DrawSingleGrh at the tile-pixel position, rotated, never lit).
    for (const projectile of world.projectiles) {
      const grame = this.frameFor(projectile.grh, 0);
      if (!grame) continue;
      const texture = this.host.texture(grame);
      if (texture === Texture.EMPTY) continue;
      this.tileNormal.add(texture, projectile.x, projectile.y, 0xffffff, 1, undefined, undefined, projectile.rotation > 0 ? (projectile.rotation * Math.PI) / 180 : 0);
    }
    // Spell particles in flight, on top of the world (Effect_Render_All runs after the FX and weather passes).
    if (world.spellGroup) for (const traveler of world.travelers) {
      if (Number.isNaN(traveler.x)) continue;
      this.drawGroup(this.topNormal, this.topAdd, world.spellGroup, traveler.x, traveler.y, now);
    }
    this.drawAuras(world, frame);

    // Weather in screen space.
    if (world.meteo && (world.info.rain || world.info.snow)) this.drawGroup(this.meteoNormal, this.meteoAdd, world.meteo, METEO_SCREEN.x, METEO_SCREEN.y, now);
    if (world.info.fog && world.fogAlpha) this.drawFog(world);

    this.tileNormal.end(); this.tileAdd.end(); this.topNormal.end(); this.topAdd.end();
    this.meteoNormal.end(); this.meteoAdd.end(); this.fogOne.end(); this.fogTwo.end();
  }

  /** Engine_Weather_UpdateFog: two 512 px cloud layers of 13 tiles each, white with AlphaNiebla as alpha (layer 2 first, then layer 1). */
  private drawFog(world: WorldFx) {
    const alpha = world.fogAlpha / 255;
    const layer = (bin: SpriteBin, grh: number, columns: number, startX: number, startY: number, offsetX: number, offsetY: number) => {
      const frame = this.frameFor(grh, 0);
      if (!frame) return;
      const texture = this.host.texture(frame);
      if (texture === Texture.EMPTY) return;
      let x = startX, y = startY;
      for (let i = 0; i < 13; i++) {
        bin.add(texture, x * 512 + offsetX, y * 512 + offsetY, 0xffffff, alpha);
        x++;
        if (x > columns) { x = 0; y++; }
      }
    };
    layer(this.fogTwo, FOG_LAYER_2_GRH, 1 + Math.floor(736 / 512), 2, -1, world.fog.x2, world.fog.y2);
    layer(this.fogOne, FOG_LAYER_1_GRH, 2 + Math.floor(736 / 512), 0, 0, world.fog.x1, world.fog.y1);
  }

  /** engine.Renderizar_Aura: "grh:color:giro:lado", a (possibly spinning) Grh behind the body, tinted by the Long colour. */
  private drawAuras(world: WorldFx, frame: FxFrame) {
    for (const [charIndex, kinds] of world.auras) {
      const at = frame.charPixel(charIndex);
      if (!at) continue;
      for (const aura of kinds.values()) {
        if (!aura || aura === '0') continue;
        const [grhText, colorText, giroText] = aura.split(':');
        const grh = Number(grhText), color = Number(colorText), giro = Number(giroText);
        const drawn = this.frameFor(grh, frame.now);
        if (!drawn) continue;
        const texture = this.host.texture(drawn);
        if (texture === Texture.EMPTY) continue;
        // Long_2_RGBAList: bytes B, G, R, A.
        const tint = ((color >> 0) & 255) | (((color >> 8) & 255) << 8) | (((color >> 16) & 255) << 16);
        const angle = giro > 0 ? ((frame.now * 0.018 * giro) % 360) : 0;
        const x = at.x + (drawn.width !== 32 ? 16 - Math.floor(drawn.width / 2) : 0);
        const y = at.y + frame.charBodyOffsetY(charIndex) + 30 + (drawn.height !== 32 ? 32 - drawn.height : 0);
        this.tileNormal.add(texture, x, y, tint, 1, undefined, undefined, angle > 0 ? (angle * Math.PI) / 180 : 0);
      }
    }
  }

  /** WorldRenderer.loadMap destroys every texture: forget the sprites that point at them. */
  clear() { for (const bin of [this.tileNormal, this.tileAdd, this.topNormal, this.topAdd, this.meteoNormal, this.meteoAdd, this.fogOne, this.fogTwo]) bin.clear(); }
  destroy() { this.lightMesh.mesh.destroy(); }
}
