/*
 * Roof sprites (layer 5) shaded with the FOUR vertex colours of their tile, as the live VB6 renderer does
 * (TileEngine_RenderScreen.bas "Layer 5 - roofs": Copy_RGBAList_WithAlpha(TempColor, .light_value, RoofsLight(Trigger))
 * then Draw_Grh(.Graphic(5), ..., TempColor) -> Batch_Textured_Box_Pre with one colour per corner).
 * A Pixi Sprite has one tint, so each roof tile is a small textured quad with per-corner colours.
 * AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import { Buffer, BufferUsage, Container, Geometry, GlProgram, Mesh, Shader } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { Rgb } from './fx-particles.js';

const VERTEX = `
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
out vec2 vUV;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
}`;
// Pixi textures are premultiplied: scale rgb by colour * alpha and everything by alpha.
const FRAGMENT = `
in vec2 vUV;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
void main() {
  vec4 t = texture(uTexture, vUV);
  finalColor = vec4(t.rgb * vColor.rgb * vColor.a, t.a * vColor.a);
}`;

/** Corner order of the VB6 light_value array and of `cornerColors`: bottom-left, top-left, bottom-right, top-right. */
export type CornerColors = readonly [Rgb, Rgb, Rgb, Rgb];

type QuadSource = { width: number; height: number; uvs: { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number } };

/**
 * clsBatch.Draw vertex order: BL (color 0, Tx1/Ty2), TL (1, Tx1/Ty1), BR (2, Tx2/Ty2), TR (3, Tx2/Ty1); indices 0,1,2 2,3,1 split along TL-BR.
 * Pixi's texture uvs run TL (0), TR (1), BR (2), BL (3).
 */
export function fillQuad(out: { positions: Float32Array; uvs: Float32Array; colors: Uint8Array }, texture: QuadSource, x: number, y: number, corners: CornerColors, alpha: number) {
  const w = texture.width, h = texture.height, uv = texture.uvs;
  const { positions: p, uvs: u, colors: c } = out;
  x = Math.round(x); y = Math.round(y);
  p[0] = x; p[1] = y + h; p[2] = x; p[3] = y; p[4] = x + w; p[5] = y + h; p[6] = x + w; p[7] = y;
  u[0] = uv.x3; u[1] = uv.y3; u[2] = uv.x0; u[3] = uv.y0; u[4] = uv.x2; u[5] = uv.y2; u[6] = uv.x1; u[7] = uv.y1;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  for (let v = 0; v < 4; v++) { const k = corners[v]!; c[v * 4] = k.r; c[v * 4 + 1] = k.g; c[v * 4 + 2] = k.b; c[v * 4 + 3] = a; }
}

/** Frame-reset pool of per-corner-coloured textured quads. */
export class RoofMeshPool {
  private meshes: { mesh: Mesh<Geometry, Shader>; positions: Float32Array; uvs: Float32Array; colors: Uint8Array; pb: Buffer; ub: Buffer; cb: Buffer }[] = [];
  private shaders = new Map<object, Shader>();
  private used = 0;
  constructor(readonly container: Container) {}
  begin() { this.used = 0; }
  /** Draw `texture` at (x, y) top-left, each corner multiplied by its colour and everything by `alpha` (0..1). */
  add(texture: Texture, x: number, y: number, corners: CornerColors, alpha: number) {
    let item = this.meshes[this.used++];
    const shader = this.shader(texture);
    if (!item) {
      const positions = new Float32Array(8), uvs = new Float32Array(8), colors = new Uint8Array(16);
      const pb = new Buffer({ data: positions, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      const ub = new Buffer({ data: uvs, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      const cb = new Buffer({ data: colors, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer: pb, format: 'float32x2', stride: 8, offset: 0 },
          aUV: { buffer: ub, format: 'float32x2', stride: 8, offset: 0 },
          aColor: { buffer: cb, format: 'unorm8x4', stride: 4, offset: 0 },
        },
        indexBuffer: new Uint32Array([0, 1, 2, 2, 1, 3]),
      });
      const mesh = new Mesh({ geometry, shader });
      mesh.state.depthTest = false;
      this.container.addChild(mesh);
      item = { mesh, positions, uvs, colors, pb, ub, cb };
      this.meshes[this.used - 1] = item;
    }
    item.mesh.shader = shader; item.mesh.visible = true;
    fillQuad(item, texture, x, y, corners, alpha);
    item.pb.update(); item.ub.update(); item.cb.update();
  }
  end() { for (let i = this.used; i < this.meshes.length; i++) this.meshes[i]!.mesh.visible = false; }
  /** Textures are destroyed on a map change: drop the shaders that hold their sources. */
  clear() { this.shaders.clear(); for (const item of this.meshes) item.mesh.visible = false; this.used = 0; }
  private shader(texture: Texture): Shader {
    const source = texture.source;
    let shader = this.shaders.get(source);
    if (!shader) {
      shader = new Shader({ glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'ao-roof-quad' }), resources: { uTexture: source, uSampler: source.style } });
      this.shaders.set(source, shader);
    }
    return shader;
  }
}
