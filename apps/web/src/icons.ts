/*
 * Small canvas pictures for the classic forms: an object or spell icon (Grh_Render_To_Hdc) and an NPC face and body
 * (engine.bas DibujarNPC). Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 * Artwork is read only from the local mount.
 */
import type { WorldRenderer } from './renderer.js';
import { assetUrl } from './assets.js';

export class Icons {
  private sheets = new Map<number, Promise<HTMLCanvasElement>>();
  constructor(private readonly renderer: WorldRenderer) {}

  /** A graphics file with the black colour key turned transparent, like the world renderer. */
  sheet(file: number): Promise<HTMLCanvasElement> {
    let pending = this.sheets.get(file);
    if (!pending) {
      pending = new Promise<HTMLCanvasElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < pixels.data.length; i += 4) if (!pixels.data[i] && !pixels.data[i + 1] && !pixels.data[i + 2]) pixels.data[i + 3] = 0;
          ctx.putImageData(pixels, 0, 0); resolve(canvas);
        };
        image.onerror = () => reject(new Error(`Missing local graphic ${file}`));
        image.src = assetUrl(`Graficos/${file}.png`);
      });
      this.sheets.set(file, pending);
    }
    return pending;
  }

  private canvas(width: number, height: number, background: string) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    return { canvas, ctx };
  }

  /** A graphic centred in a width x height box (Grh_Render_To_Hdc with x = (W - w) / 2, y = (H - h) / 2). */
  async graphic(grh: number, width: number, height: number, background: string): Promise<HTMLCanvasElement> {
    const { canvas, ctx } = this.canvas(width, height, background);
    if (grh <= 0) return canvas;
    const frame = await this.renderer.graphic(grh);
    ctx.drawImage(await this.sheet(frame.file), frame.x, frame.y, frame.width, frame.height,
      Math.floor((width - frame.width) / 2), Math.floor((height - frame.height) / 2), frame.width, frame.height);
    return canvas;
  }

  /**
   * DibujarNPC(PicBox, Head, Body, Heading 3): body centred, lifted so the head fits, head on top. HeadOffset.y of the body is
   * the head layer's y minus the body layer's y in the renderer's layer list (body first, head second for a south-facing NPC).
   */
  async npc(body: number, head: number, width: number, height: number, background: string): Promise<HTMLCanvasElement> {
    const { canvas, ctx } = this.canvas(width, height, background);
    await this.renderer.graphic(1); // metadata (bodies, heads) must be loaded first
    const layers = this.renderer.portraitLayers(body, head);
    const bodyLayer = layers[0], headLayer = layers[1];
    if (!bodyLayer) return canvas;
    const bodyFrame = bodyLayer.animation.frames[0]!;
    // engine.bas 3754 uses BodyData.HeadOffset.y (ini HeadOffsetY + BodyOffsetY, Recursos.bas); the live head layer sits at HeadOffset.y - 1.
    const headOffsetY = headLayer ? headLayer.y + 1 : 0;
    const x = Math.trunc((width - bodyFrame.width) / 2);
    const y = Math.min(height - bodyFrame.height + Math.trunc(headOffsetY / 2), Math.trunc((height - bodyFrame.height) / 2));
    ctx.drawImage(await this.sheet(bodyFrame.file), bodyFrame.x, bodyFrame.y, bodyFrame.width, bodyFrame.height, x, y, bodyFrame.width, bodyFrame.height);
    if (headLayer) {
      const headFrame = headLayer.animation.frames[0]!;
      ctx.drawImage(await this.sheet(headFrame.file), headFrame.x, headFrame.y, headFrame.width, headFrame.height,
        Math.trunc((width - headFrame.width) / 2) + 1, y + bodyFrame.height - headFrame.height + headOffsetY, headFrame.width, headFrame.height);
    }
    return canvas;
  }
}
