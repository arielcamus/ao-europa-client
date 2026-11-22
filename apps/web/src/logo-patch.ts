/*
 * The classic "ARGENTUM ONLINE" logo is baked into the top-left of ventanaprincipal.bmp. This client shows the AO World logo instead
 * (index.html #ao-logo), so the shipped logo is painted over, in the browser's copy only, with the title-bar gradient around it.
 * AGPL-3.0-or-later; see NOTICE. Nothing is written to disk and the licensed art is not modified.
 */
/** Box of the baked logo in ventanaprincipal.bmp pixels: x, y, width, height. */
export const ARGENTUM_LOGO_BOX = [4, 3, 112, 28] as const;

/** Fill the box with a per-row linear blend between the pixel left of it and the pixel right of it (the title bar is a plain vertical gradient), in place. */
export function paintOverLogoPixels(px: Uint8ClampedArray, width: number, box: readonly [number, number, number, number] = ARGENTUM_LOGO_BOX): void {
  const [x0, y0, w, h] = box;
  for (let y = y0; y < y0 + h; y++) {
    const left = (y * width + x0 - 1) * 4, right = (y * width + x0 + w) * 4;
    for (let x = 0; x < w; x++) {
      const t = (x + 1) / (w + 1), to = (y * width + x0 + x) * 4;
      for (let c = 0; c < 3; c++) px[to + c] = Math.round(px[left + c]! * (1 - t) + px[right + c]! * t);
      px[to + 3] = px[left + 3]!;
    }
  }
}
export const paintOverArgentumLogo = (data: ImageData) => paintOverLogoPixels(data.data, data.width);
