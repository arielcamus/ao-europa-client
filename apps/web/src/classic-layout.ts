/*
 * frmMain.frm / FrmLogear.frm geometry, classic client b648c1a9.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 * Positions are original VB6 twips / 15, relative to each control's parent.
 * Native bitmap sizes override AutoSize images (CombateIcon / globalIcon are 37x12 bitmaps at 8832,1812 / 8832,2004 twips, placed in index.html); bars use frmMain runtime widths.
 */
export const CLASSIC_WIDTH = 1024;
export const CLASSIC_HEIGHT = 768;
export const controls: Record<string, readonly [number, number, number, number]> = {
  renderer: [10, 150, 736, 608], RecTxt: [16, 32, 612, 85], SendTxt: [40, 120, 545.6, 24],
  MiniMap: [638.4, 40, 100, 100], btnZoomIn: [745, 70, 13, 13], btnZoomOut: [745, 98, 13, 13], NameMapa: [651, 3, 75, 11], Coord: [648, 14, 81, 15],
  NombrePJ: [752, 35, 271, 33], lblLvl: [832, 65, 119, 18], lblhora: [878, 134, 33, 15],
  ExpBar: [772, 103.2, 235, 16], exp: [772, 103, 236, 17],
  panel: [768, 160, 247, 325], picInv: [280 / 15, 740 / 15, 210, 256],
  picHechiz: [15, 40, 216, 227], imgInventario: [1, 1, 122, 28], imgHechizos: [125, 1, 122, 28],
  cmdlanzar: [0, 284, 161, 39], imgSpellInfo: [166, 282, 25, 23],
  'cmdMoverHechi-1': [225, 284, 21, 19], 'cmdMoverHechi-0': [3370 / 15, 4550 / 15, 21, 19],
  panelInf: [756, 521, 266, 245], 'panelinferior-0': [0, 0, 133, 28], 'panelinferior-1': [132, 0, 133, 28],
  Hpshp: [35.2, 80.8, 216, 16], MANShp: [35.2, 108.8, 216, 16],
  STAShp: [34.4, 139.2, 89, 9], AGUAsp: [156, 139.2, 32, 9], COMIDAsp: [219.2, 140, 32, 8],
  HpBar: [109, 81, 63, 16], manabar: [109, 109, 63, 16], stabar: [53, 137, 51, 15],
  AGUbar: [163, 137, 17, 15], hambar: [226, 137, 17, 15], GldLbl: [32, 39, 46, 18],
  lblWeapon: [40, 180, 32, 16], lblShielder: [124, 180, 32, 16], lblHelm: [208, 180, 32, 16],
  lblArmor: [40, 210, 32, 16], lblResis: [129, 210, 22, 16], lbldm: [205, 210, 38, 16],
  Image3: [284 / 15, 1894 / 15, 17, 14], 'Image4-1': [14977 / 15, 65 / 15, 21, 21],
  btnTotalExp: [855, 83, 17, 15], btnExp2: [890, 83, 17, 15], btnExp: [873, 83, 17, 15], btnExpRemaining: [907, 83, 17, 15],
  OpcionesBoton: [760, 3, 65, 21], imgManual: [830, 3, 65, 21], imgMAO: [900, 3, 65, 21],
  NameTxt: [710 / 15, 1580 / 15, 1840 / 15, 19], PasswordTxt: [188, 104, 1840 / 15, 19],
  cmdIngresar: [2750 / 15, 137, 132, 28],
};

/**
 * How the classic window grows on a screen larger than 1024x768 (option `screenScale`).
 * - `fill`: as large as fits; a whole number of DEVICE pixels per art pixel when that wastes under 12%, otherwise fractional. The art stays
 *   nearest neighbour (image-rendering: pixelated on #classic) and the world canvas renders at device pixels, so nothing is resampled twice.
 * - `whole`: the largest whole number of device pixels per art pixel that fits (on a Retina screen, 1.5x is 3 device pixels), letterboxed.
 */
export type ScreenScale = 'fill' | 'whole';
export const SCREEN_SCALES: readonly ScreenScale[] = ['fill', 'whole'];

/**
 * Uniform scale (CSS px per art px) of the 1024x768 classic window for a browser window of `width` x `height` CSS px at `dpr` device pixels per
 * CSS px. Smaller than the window (phones): shrink to fit, as before. Larger: see ScreenScale. Whole numbers are counted in device pixels
 * (1512x982 at DPR 2 fits 2.56 device px per art px: `whole` gives 2, i.e. CSS scale 1).
 */
export function classicScale(width: number, height: number, dpr = 1, mode: ScreenScale = 'fill'): number {
  const fit = Math.min(width / CLASSIC_WIDTH, height / CLASSIC_HEIGHT);
  if (!(fit > 0)) return 1;
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  if (fit <= 1 && fit * ratio < 1) return fit; // fewer device pixels than art pixels: no whole number fits
  const device = fit * ratio, whole = Math.floor(device + 1e-9);
  if (mode === 'whole') return whole / ratio;
  if (fit <= 1) return fit;
  return whole / device >= 0.88 ? whole / ratio : fit;
}

/** Device pixels per art pixel the world canvas should render at: the on-screen size, so the browser never resamples it (phones keep DPR, max 2). */
export function canvasResolution(scale: number, dpr: number): number {
  const device = scale * (dpr > 0 ? dpr : 1);
  return device >= 1 ? Math.min(4, device) : Math.min(dpr || 1, 2);
}

/**
 * The size of #classic-fit in CSS px: at least the scaled window, rounded up so that it and the space left around it are whole device pixels
 * (an odd leftover would centre the art half a device pixel off and blur every edge at a whole-number scale).
 */
export function fitBox(scaled: number, available: number, dpr: number): number {
  const d = dpr > 0 ? dpr : 1;
  let device = Math.ceil(scaled * d - 1e-6);
  const room = Math.round(available * d);
  if (room > device && (room - device) % 2) device += 1;
  return device / d;
}

let mode: ScreenScale = 'fill';
let current = { scale: 1, dpr: 1 };
const listeners = new Set<(scale: number, dpr: number) => void>();
let resize: (() => void) | undefined;
/** The current classic scale and devicePixelRatio. */
export function classicScaleNow() { return current; }
/** Called with the new scale whenever the window, the device pixel ratio or the mode changes. */
export function onClassicScale(listener: (scale: number, dpr: number) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setScreenScale(next: ScreenScale) { if (next !== mode && SCREEN_SCALES.includes(next)) { mode = next; resize?.(); } }

export function applyClassicLayout(initial: ScreenScale = 'fill') {
  mode = initial;
  document.querySelectorAll<HTMLElement>('[data-vb]').forEach(element => {
    const rect = controls[element.dataset.vb!];
    if (!rect) throw new Error(`Unknown classic control: ${element.dataset.vb}`);
    const [x, y, width, height] = rect;
    Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  });
  let watched: MediaQueryList | undefined;
  resize = () => {
    const dpr = window.devicePixelRatio || 1, width = document.documentElement.clientWidth, height = window.innerHeight;
    const scale = classicScale(width, height, dpr, mode);
    document.documentElement.style.setProperty('--classic-scale', String(scale));
    const fit = document.getElementById('classic-fit')!, classic = document.getElementById('classic');
    fit.style.width = `${fitBox(CLASSIC_WIDTH * scale, width, dpr)}px`; fit.style.height = `${fitBox(CLASSIC_HEIGHT * scale, height, dpr)}px`;
    if (classic) { classic.dataset.screenScale = mode; classic.dataset.devicePixels = (scale * dpr).toFixed(3); classic.dataset.crisp = String(scale * dpr >= 1); }
    const changed = scale !== current.scale || dpr !== current.dpr;
    current = { scale, dpr };
    if (changed) for (const listener of listeners) listener(scale, dpr);
    // Moving the window to another display changes devicePixelRatio without a resize event.
    watched?.removeEventListener('change', resize!);
    watched = window.matchMedia?.(`(resolution: ${dpr}dppx)`); watched?.addEventListener('change', resize!);
  };
  resize(); window.addEventListener('resize', resize);
}
