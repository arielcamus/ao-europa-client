/*
 * Resource loading/colorkey adapted from Argentum 20 CODIGO/Recursos.bas and
 * clsTexManager.cls: LoadTexture (uncompressed PNG opaque-black key).
 * Copyright (C) 2022 Noland Studios. GNU AGPL version 3 or any later version.
 * WITHOUT ANY WARRANTY. See ../../../LICENSE and ../../../NOTICE.
 * Original files are read only. Cropping/colorkey are runtime format conversion.
 */
import { ImageSource, Rectangle, Texture } from 'pixi.js';
import { bodyFromIni, grhFrame, parseCsm, parseGraphicsIni, parseHeads, parseIni } from '@ao/formats';
import type { Body, GameMap, GraphicFrame, GraphicsIndex, Ini } from '@ao/formats';

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`/assets/${path}`);
  if (!response.ok) throw new Error(`Cannot load ${path} (${response.status}). Check AO_ASSETS.`);
  return new Uint8Array(await response.arrayBuffer());
}
const ansi = (bytes: Uint8Array) => new TextDecoder('windows-1252').decode(bytes);

export class GameAssets {
  private sources = new Map<number, ImageSource>();
  private textures = new Map<string, Texture>();
  private loading = new Map<number, Promise<void>>();
  private queue: (() => void)[] = [];
  private active = 0;
  private destroyed = false;

  private constructor(readonly graphics: GraphicsIndex, private readonly bodies: Ini,
    private readonly molds: Ini, private readonly heads: number[][]) {}

  static async load(): Promise<GameAssets> {
    const [graphics, bodies, molds, heads] = await Promise.all([
      bytes('init/graficos.ini'), bytes('init/cuerpos.dat'), bytes('init/moldes.ini'), bytes('init/cabezas.ind'),
    ]);
    return new GameAssets(parseGraphicsIni(ansi(graphics)), parseIni(ansi(bodies)), parseIni(ansi(molds)), parseHeads(heads));
  }
  async map(id: number): Promise<GameMap> { return parseCsm(await bytes(`Mapas/mapa${id}.csm`)); }
  body(id: number): Body { return bodyFromIni(this.bodies, this.molds, this.graphics, id); }
  head(id: number): GraphicFrame[] {
    const heads = this.heads[id];
    if (!heads?.length) throw new Error(`Missing head ${id}`);
    return heads.map(grh => grhFrame(this.graphics, grh));
  }
  frames(id: number): GraphicFrame[] {
    const entry = this.graphics.entries.get(id);
    if (!entry) throw new Error(`Missing graphic ${id}`);
    return entry.kind === 'frame' ? [entry.frame] : entry.frames.map(frame => grhFrame(this.graphics, frame));
  }
  async ensure(frames: GraphicFrame[]): Promise<void> {
    await Promise.all([...new Set(frames.map(frame => frame.file))].map(file => this.loadAtlas(file)));
  }
  private loadAtlas(file: number): Promise<void> {
    if (this.sources.has(file)) return Promise.resolve();
    const existing = this.loading.get(file);
    if (existing) return existing;
    const promise = new Promise<void>((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        void this.decode(file).then(resolve, reject).finally(() => { this.active--; this.pump(); });
      });
    });
    this.loading.set(file, promise);
    this.pump();
    return promise;
  }
  private pump(): void { while (!this.destroyed && this.active < 4 && this.queue.length) this.queue.shift()!(); }
  private async decode(file: number): Promise<void> {
    const response = await fetch(`/assets/Graficos/${file}.png`);
    if (!response.ok) throw new Error(`Missing graphic atlas ${file}.png (${response.status})`);
    const image = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { image.close(); throw new Error('Canvas 2D unavailable for PNG conversion'); }
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i] === 0 && pixels.data[i + 1] === 0 && pixels.data[i + 2] === 0 && pixels.data[i + 3] === 255) pixels.data[i + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    if (this.destroyed) return;
    // A few original GRHs extend below a power-of-two atlas (e.g.
    // 5322..5333 in 5068.png). Keep their UVs and the legacy Direct3D wrap mode.
    const source = new ImageSource({ resource: canvas, scaleMode: 'nearest', addressMode: 'repeat', autoGenerateMipmaps: false });
    this.sources.set(file, source);
  }
  texture(frame: GraphicFrame): Texture {
    const key = `${frame.file}/${frame.x}/${frame.y}/${frame.width}/${frame.height}`;
    const existing = this.textures.get(key);
    if (existing) return existing;
    const source = this.sources.get(frame.file);
    if (!source) throw new Error(`Atlas ${frame.file} is not loaded`);
    const texture = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    this.textures.set(key, texture);
    return texture;
  }
  get atlasCount(): number { return this.sources.size; }
  destroy(): void {
    this.destroyed = true;
    for (const texture of this.textures.values()) texture.destroy();
    for (const source of this.sources.values()) source.destroy();
    this.textures.clear(); this.sources.clear();
  }
}
