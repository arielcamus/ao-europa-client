/*
 * Particle streams and the particle simulation, adapted 2026-11-20 from the classic client's Graficos_Particulas.bas
 * (Particle_Group_Render, Particle_Render, General_Particle_Create, General_Char_Particle_Create, Engine_MeteoParticle_Set)
 * and Recursos.CargarParticulasBinary (init/particles.ind). Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See ../../../LICENSE and ../../../NOTICE.
 *
 * Pure logic: no Pixi, no clock of its own. The caller passes the elapsed milliseconds of the frame to ParticleGroup.tick,
 * exactly as the VB6 frame passes timerTicksPerFrame (elapsed ms * engineBaseSpeed 0.018) to Particle_Group_Render.
 */

/** One entry of particles.ind (VB6 `Stream`). Tints are stored as written in the file: R, G, B (see groupTint for the VB6 swap). */
export interface Stream {
  name: string;
  numParticles: number;
  x1: number; y1: number; x2: number; y2: number;
  angle: number;
  vecX1: number; vecX2: number; vecY1: number; vecY2: number;
  life1: number; life2: number;
  friction: number;
  spin: boolean; spinL: number; spinH: number;
  alphaBlend: boolean;
  gravity: boolean; gravStrength: number; bounceStrength: number;
  xMove: boolean; yMove: boolean;
  moveX1: number; moveX2: number; moveY1: number; moveY2: number;
  grhList: number[];
  tint: [Rgb, Rgb, Rgb, Rgb];
  /** Seconds-free simulation speed: the group steps when its frame counter passes this (ticks of 1/0.018 ms). */
  speed: number;
  /** `life_counter`: group lifetime in simulation steps, -1 forever. */
  lifeCounter: number;
  resize: boolean; resizeX: number; resizeY: number;
}
export interface Rgb { r: number; g: number; b: number }

/** engineBaseSpeed: timerTicksPerFrame = elapsed ms * 0.018. */
export const ENGINE_BASE_SPEED = 0.018;

/**
 * Recursos.CargarParticulasBinary: Integer count, then one VB6 `Get` of the Stream UDT per entry. Variable strings carry a
 * 2-byte length; the dynamic Long array `grh_list` is written as a SafeArray descriptor (Integer dims, then Long count and
 * Long lower bound per dimension) followed by the elements.
 */
export function parseParticles(bytes: Uint8Array): Stream[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const take = (n: number) => { if (n < 0 || offset + n > bytes.length) throw new Error(`Truncated particles.ind at byte ${offset}`); const at = offset; offset += n; return at; };
  const i16 = () => view.getInt16(take(2), true);
  const i32 = () => view.getInt32(take(4), true);
  const u8 = () => view.getUint8(take(1));
  const f32 = () => view.getFloat32(take(4), true);
  const count = i16();
  if (count < 0 || count > 10_000) throw new Error(`Invalid particle count ${count}`);
  const streams: Stream[] = [];
  for (let k = 0; k < count; k++) {
    const nameLength = i16(), nameAt = take(nameLength);
    const name = new TextDecoder('windows-1252').decode(bytes.subarray(nameAt, nameAt + nameLength));
    const numParticles = i32(); i32(); i32(); // NumOfParticles, NumGrhs, id
    const x1 = i32(), y1 = i32(), x2 = i32(), y2 = i32(), angle = i32();
    const vecX1 = i32(), vecX2 = i32(), vecY1 = i32(), vecY2 = i32(), life1 = i32(), life2 = i32(), friction = i32();
    const spin = u8() !== 0, spinL = f32(), spinH = f32(), alphaBlend = u8() !== 0, gravity = u8() !== 0;
    const gravStrength = i32(), bounceStrength = i32(), xMove = u8() !== 0, yMove = u8() !== 0;
    const moveX1 = i32(), moveX2 = i32(), moveY1 = i32(), moveY2 = i32();
    const dimensions = i16();
    if (dimensions !== 1) throw new Error(`particles.ind entry ${k + 1}: unexpected Grh_List dimensions ${dimensions}`);
    const grhCount = i32(); i32(); // element count, lower bound
    if (grhCount < 0 || grhCount > 1000) throw new Error(`particles.ind entry ${k + 1}: invalid Grh_List size ${grhCount}`);
    const grhList = Array.from({ length: grhCount }, i32);
    const tint = Array.from({ length: 4 }, () => ({ r: i32(), g: i32(), b: i32() })) as Stream['tint'];
    const speed = f32(), lifeCounter = i32(), resize = i16(), resizeX = i16(), resizeY = i16();
    streams.push({
      name, numParticles, x1, y1, x2, y2, angle, vecX1, vecX2, vecY1, vecY2, life1, life2, friction, spin, spinL, spinH, alphaBlend, gravity,
      gravStrength, bounceStrength, xMove, yMove, moveX1, moveX2, moveY1, moveY2, grhList, tint, speed, lifeCounter,
      resize: resize === -1, resizeX, resizeY,
    });
  }
  if (offset !== bytes.length) throw new Error(`particles.ind has ${bytes.length - offset} trailing bytes`);
  return streams;
}

/** VB `Rnd`-based RandomNumber(Lower, Upper): Int((Upper - Lower + 1) * Rnd + Lower), inclusive, any order of bounds. */
export type Random = () => number;
export const randomNumber = (rnd: Random, lower: number, upper: number) => Math.floor((upper - lower + 1) * rnd() + lower);
/** VB `\` integer division truncates toward zero. */
const idiv = (a: number, b: number) => b === 0 ? 0 : Math.trunc(a / b);

export interface Particle {
  x: number; y: number;
  vecX: number; vecY: number;
  /** Steps left; 0 = not spawned (or finished while the group drains). */
  alive: number;
  friction: number;
  /** Current Grh (0 = hidden), degrees of rotation, and the clock time it spawned (animated Grh phase). */
  grh: number;
  angle: number;
  spawnedAt: number;
}

/** What a character, tile or screen anchor needs to know to draw a group. */
export interface GroupDraw { alphaBlend: boolean; tint: [Rgb, Rgb, Rgb, Rgb]; resize: boolean; resizeX: number; resizeY: number }

export interface GroupOptions {
  /** `particle_life`: steps the group lives; 0 uses the stream's own life_counter. */
  life?: number;
  /** General_Char_Particle_Create with a Grh: the Grh replaces the stream's list, tints go white and alpha blending is off. */
  grh?: number;
  /** General_Char_Particle_Create assigns vertex 0 the colour (R, G, R); General_Particle_Create uses (B, G, R) for all four. */
  forChar?: boolean;
  noBorrar?: boolean;
}

/** Group lifetime flags of Particle_Group_Render. */
export class ParticleGroup {
  readonly particles: Particle[];
  readonly draw: GroupDraw;
  readonly grhList: number[];
  /** Stream index (1-based id on the wire). */
  readonly streamId: number;
  aliveSteps: number;
  neverDie: boolean;
  destruir = false;
  partCountLive = 0;
  frameAcc = 0;
  noBorrar: boolean;
  private readonly stream: Stream;

  constructor(streamId: number, stream: Stream, options: GroupOptions = {}) {
    this.streamId = streamId; this.stream = stream; this.noBorrar = options.noBorrar ?? false;
    const life = options.life ? options.life : stream.lifeCounter;
    this.aliveSteps = life; this.neverDie = life === -1;
    const white = options.grh !== undefined && options.grh > 0;
    this.grhList = white ? [options.grh!] : stream.grhList;
    this.draw = {
      alphaBlend: !white && stream.alphaBlend, resize: stream.resize, resizeX: stream.resizeX, resizeY: stream.resizeY,
      tint: groupTint(stream, options.forChar ?? false, white),
    };
    this.particles = Array.from({ length: stream.numParticles }, () => ({ x: 0, y: 0, vecX: 0, vecY: 0, alive: 0, friction: 1, grh: 0, angle: 0, spawnedAt: 0 }));
  }

  /** The group is finished: drained after Particle_Group_Remove or after its life counter ran out. */
  done = false;

  /**
   * One Particle_Group_Render call (without the drawing): frameAcc += ticks; when it passes the stream speed, every
   * particle takes one simulation step. Returns whether a step happened.
   */
  tick(ticks: number, now: number, rnd: Random): boolean {
    if (this.done) return false;
    const draining = this.aliveSteps === 0;
    if (draining) {
      this.destruir = true;
      if (this.partCountLive <= 2) { this.done = true; return false; }
    }
    this.frameAcc += ticks;
    let moved = false;
    if (this.frameAcc > this.stream.speed) { this.frameAcc = 0; moved = true; }
    if (moved) {
      for (const particle of this.particles) this.stepParticle(particle, now, rnd);
      // The alive counter only drops on a step, and never for a group that lives forever.
      if (!draining && !this.neverDie) this.aliveSteps--;
    }
    return moved;
  }

  /** Particle_Group_Remove / Char_Particle_Group_Remove: stop spawning and let the live particles finish. */
  remove() { this.neverDie = false; this.aliveSteps = 0; this.destruir = true; }

  private stepParticle(p: Particle, now: number, rnd: Random) {
    const s = this.stream;
    if (p.alive === 0 && !this.destruir) {
      // Start a new particle.
      p.grh = this.grhList[randomNumber(rnd, 1, this.grhList.length) - 1] ?? 0;
      p.spawnedAt = now;
      p.angle = 0;
      p.x = randomNumber(rnd, s.x1, s.x2) - 16;
      p.y = randomNumber(rnd, s.y1, s.y2) - 16;
      p.vecX = randomNumber(rnd, s.vecX1, s.vecX2);
      p.vecY = randomNumber(rnd, s.vecY1, s.vecY2);
      p.alive = randomNumber(rnd, s.life1, s.life2);
      p.friction = s.friction;
      this.partCountLive++;
    } else {
      if (p.alive === 0 && this.destruir) p.grh = 0;
      if (s.gravity) {
        p.vecY += s.gravStrength;
        if (p.y > 0) p.vecY = s.bounceStrength;
      }
      if (s.spin) p.angle += randomNumber(rnd, s.spinL, s.spinH) / 5;
      while (p.angle >= 360) p.angle -= 360;
      if (s.xMove) p.vecX = randomNumber(rnd, s.moveX1, s.moveX2);
      if (s.yMove) p.vecY = randomNumber(rnd, s.moveY1, s.moveY2);
    }
    p.x += idiv(p.vecX, p.friction);
    p.y += idiv(p.vecY, p.friction);
    p.alive--;
    if (p.alive === 0) this.partCountLive--;
  }

  /** Engine_MeteoParticle_Set: Particle_Group_Render(-1000, -1000) x 500 runs about 250 steps before the first visible frame. */
  warmUp(rnd: Random, now: number, steps = 250) {
    for (let i = 0; i < steps; i++) this.tick(this.stream.speed + 0.001, now, rnd);
  }
  /** Engine_MeteoParticle_Set(already_started = False): lift every particle by vecy2 * 30 so the weather fades in from above. */
  liftForLiveStart() { for (const p of this.particles) p.y -= this.stream.vecY2 * 30; }
}

/**
 * The four vertex colours of a group. General_Particle_Create writes SetRGBA(v, tint.B, tint.G, tint.R) for all four vertices,
 * where SetRGBA's parameters are (R, G, B): red and blue are swapped (the blue rain). General_Char_Particle_Create writes vertex 0
 * as (R, G, R) and the others (B, G, R). A custom Grh (ParticleFX with a Grh) forces white.
 */
export function groupTint(stream: Stream, forChar: boolean, white: boolean): [Rgb, Rgb, Rgb, Rgb] {
  if (white) { const w = { r: 255, g: 255, b: 255 }; return [w, w, w, w]; }
  const swapped = stream.tint.map(t => ({ r: t.b, g: t.g, b: t.r })) as [Rgb, Rgb, Rgb, Rgb];
  if (forChar) swapped[0] = { r: stream.tint[0].r, g: stream.tint[0].g, b: stream.tint[0].r };
  return swapped;
}

/** The mean of the four vertex colours: Pixi sprites take one tint, the VB6 batch shades four vertices of a few pixels. */
export function averageTint(tint: [Rgb, Rgb, Rgb, Rgb]): Rgb {
  return {
    r: Math.round((tint[0].r + tint[1].r + tint[2].r + tint[3].r) / 4),
    g: Math.round((tint[0].g + tint[1].g + tint[2].g + tint[3].g) / 4),
    b: Math.round((tint[0].b + tint[1].b + tint[2].b + tint[3].b) / 4),
  };
}
