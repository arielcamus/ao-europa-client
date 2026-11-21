/*
 * Draws original Grh graphics (black colour key, nearest neighbour) into small canvases for DOM overlays such as the party frames,
 * like NpcDialog.portrait and ClassicUI.sheet do for their own art. AGPL-3.0-or-later; see NOTICE. Art is read only from the local mount.
 */
import type { WorldRenderer } from './renderer.js';

const sheets = new Map<number, Promise<HTMLCanvasElement>>();
/** `Graficos/<file>.png` with every pure-black pixel made transparent (clsTexManager colour key). */
export function keyedSheet(file: number): Promise<HTMLCanvasElement> {
  let pending = sheets.get(file);
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
      image.src = `/ao-assets/Graficos/${file}.png`;
    });
    sheets.set(file, pending);
  }
  return pending;
}

/** The first frame of a Grh, at its own size. */
export async function grhCanvas(renderer: WorldRenderer, grh: number): Promise<HTMLCanvasElement> {
  const frame = await renderer.graphic(grh);
  const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
  canvas.getContext('2d')!.drawImage(await keyedSheet(frame.file), frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  return canvas;
}

/**
 * A head (HeadData.Head(south)) in a canvas of its own size. The caller places it like Draw_Grh with the centre flag: x is moved by
 * `-Int(width / 2) + 16` and y by `32 - height` (TileWidth/TileHeight are pixel size / 32).
 */
export async function headCanvas(renderer: WorldRenderer, head: number): Promise<HTMLCanvasElement | undefined> {
  await renderer.graphic(1); // heads and bodies are part of the metadata
  const grh = renderer.headGrh(head);
  return grh ? grhCanvas(renderer, grh) : undefined;
}
