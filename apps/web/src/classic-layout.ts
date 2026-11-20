/*
 * frmMain.frm / FrmLogear.frm geometry, classic client b648c1a9.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 * Positions are original VB6 twips / 15, relative to each control's parent.
 * Native bitmap sizes override AutoSize images; bars use frmMain runtime widths.
 */
export const CLASSIC_WIDTH = 1024;
export const CLASSIC_HEIGHT = 768;
export const controls: Record<string, readonly [number, number, number, number]> = {
  renderer: [10, 150, 736, 608], RecTxt: [16, 32, 612, 85], SendTxt: [40, 120, 545.6, 24],
  MiniMap: [638.4, 40, 100, 100], NameMapa: [651, 3, 75, 11], Coord: [648, 14, 81, 15],
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
  OpcionesBoton: [760, 3, 65, 21], imgManual: [830, 3, 65, 21], imgMAO: [900, 3, 65, 21],
  NameTxt: [710 / 15, 1580 / 15, 1840 / 15, 19], PasswordTxt: [188, 104, 1840 / 15, 19],
  cmdIngresar: [2750 / 15, 137, 132, 28],
};

/**
 * Uniform scale of the 1024x768 classic window for a browser window. Smaller than the window (phones): shrink to fit,
 * as before. Larger: grow to fill, snapping to a whole number when that wastes under 12% so the pixel art stays crisp.
 */
export function classicScale(width: number, height: number): number {
  const fit = Math.min(width / CLASSIC_WIDTH, height / CLASSIC_HEIGHT);
  if (!(fit > 0)) return 1;
  if (fit <= 1) return fit;
  const whole = Math.floor(fit);
  return whole / fit >= 0.88 ? whole : fit;
}

export function applyClassicLayout() {
  document.querySelectorAll<HTMLElement>('[data-vb]').forEach(element => {
    const rect = controls[element.dataset.vb!];
    if (!rect) throw new Error(`Unknown classic control: ${element.dataset.vb}`);
    const [x, y, width, height] = rect;
    Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  });
  const resize = () => {
    const scale = classicScale(document.documentElement.clientWidth, window.innerHeight);
    document.documentElement.style.setProperty('--classic-scale', String(scale));
    const fit = document.getElementById('classic-fit')!;
    fit.style.width = `${CLASSIC_WIDTH * scale}px`; fit.style.height = `${CLASSIC_HEIGHT * scale}px`;
  };
  resize(); window.addEventListener('resize', resize);
}
