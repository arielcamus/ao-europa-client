/*
 * The special-fish fight ("super pez"), adapted 2026-11-21 from the classic client: Protocol.HandlePelearConPezEspecial (start),
 * TileEngine_RenderScreen.RenderScreen (the bar, the circles, the 20 s limit), General.IntentarObtenerPezEspecial (the P key) and
 * General.MoveTo (walking breaks the line). Constants from TileEngine.bas. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See NOTICE.
 *
 * A marker sweeps a 200 px bar; the player presses P while it is over the green zone. Three hits (or five tries) land the fish
 * (WriteFinalizarPescaEspecial); three misses, the 20 s limit or walking away break the line (WriteRomperCania).
 */
export const FISH_MAX_ATTEMPTS = 5;
/** VelocidadBarra. */
export const FISH_BAR_SPEED = 1;
/** startTimePezEspecial: the whole fight may last 20 s. */
export const FISH_TIME_LIMIT_MS = 20_000;
/** GRH_BARRA_PESCA, GRH_CURSOR_PESCA, GRH_CIRCULO_VERDE, GRH_CIRCULO_ROJO. */
export const FISH_GRH = { bar: 60666, cursor: 60667, hit: 38367, miss: 38366 } as const;
/** Draw positions (before gameplay_render_offset): the bar, the marker, and the circles (x = 394 + attempt * 10). */
export const FISH_LAYOUT = { barX: 239, barY: 550, cursorX: 271, cursorY: 558, circleX: 394, circleStep: 10, circleY: 573 } as const;
/** "El pez ha roto tu línea de pesca." (MENSAJE_PEZ_ROMPIO_LINEA_PESCA, 255,0,0 bold) and MENSAJE_SUPER_PEZ. */
export const MSG_FISH_BROKE = 'El pez ha roto tu línea de pesca.';
export const MSG_SUPER_FISH = '¡Oh! Creo que tengo un gran pez en mi línea. Para capturarlo presiona la tecla P cuando el marcador esté en la zona verde.';
/** The zone is 90..111 with a 15 px allowance for input lag (IntentarObtenerPezEspecial). */
export const FISH_ZONE = { from: 90 - 15, to: 111 + 15 } as const;

export type FishOutcome = 'landed' | 'broke' | undefined;

export class SpecialFishing {
  active = false;
  position = 1;
  direction = 1;
  /** intentosPesca(1..5): 0 not tried, 1 hit (green circle), 2 miss (red circle). Index 0 is unused like the VB6 array. */
  attempts: number[] = [0, 0, 0, 0, 0, 0];
  hits = 0;
  misses = 0;
  canTry = false;
  startedAt = 0;
  revision = 0;

  /** HandlePelearConPezEspecial. */
  start(now: number) {
    this.position = 1; this.direction = 1; this.attempts = [0, 0, 0, 0, 0, 0];
    this.active = true; this.hits = 0; this.misses = 0; this.startedAt = now; this.canTry = false; this.revision++;
  }
  stop() { if (this.active) { this.active = false; this.revision++; } }

  /**
   * The fishing block of RenderScreen for one frame, `elapsed` ms after the last one: the marker turns at the ends (re-arming the
   * try), is clamped, then moves; after 20 s the line breaks.
   */
  frame(now: number, elapsed: number): FishOutcome {
    if (!this.active) return undefined;
    if (this.position <= 0) { this.direction = 1; this.canTry = true; }
    else if (this.position > 199) { this.direction = -1; this.canTry = true; }
    if (this.position < 0) this.position = 0;
    else if (this.position > 199) this.position = 199;
    this.position += this.direction * FISH_BAR_SPEED * elapsed * 0.2;
    if (now - this.startedAt >= FISH_TIME_LIMIT_MS) { this.active = false; this.revision++; return 'broke'; }
    return undefined;
  }

  /** IntentarObtenerPezEspecial (the P key): one try per sweep. */
  press(): FishOutcome {
    if (!this.active || !this.canTry) return undefined;
    const hit = this.position >= FISH_ZONE.from && this.position <= FISH_ZONE.to;
    if (hit) this.hits++; else this.misses++;
    this.canTry = false;
    const tries = this.hits + this.misses;
    if (tries >= 1 && tries <= FISH_MAX_ATTEMPTS) this.attempts[tries] = hit ? 1 : 2;
    this.revision++;
    if (tries >= FISH_MAX_ATTEMPTS || this.hits >= 3) { this.active = false; return 'landed'; }
    if (this.misses >= 3) { this.active = false; return 'broke'; }
    return undefined;
  }
}
