/*
 * NPC dialog window for talking NPCs, adapted 2026-11-20 from client Protocol.bas
 * HandleChatOverHeadImpl ("NPCDESC" -> mostrarCartel with the NPC's name, text and face)
 * and Carteles.bas. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no
 * warranty. See NOTICE. Artwork is read only from the local mount.
 */
import type { LocaleData } from './character-data.js';
import type { WorldRenderer } from './renderer.js';
import { fetchText, parseIni } from './assets.js';
import { grhCanvas } from './grh-canvas.js';

/** mostrarCartel's duration argument: 200 + 30 * Len(text), in cartel units. */
export const dialogLifeMs = (text: string) => 200 + 30 * text.length;
/**
 * RenderScreen_Cartel moves fade (1..255) and duration by timerTicksPerFrame * 40 each frame, i.e. 0.72 units per millisecond: the duration is
 * counted down only once the fade-in has reached 255, and the fade-out starts when it hits 0.
 */
export const CARTEL_UNITS_PER_MS = 0.72;
export const CARTEL_FADE_MS = 255 / CARTEL_UNITS_PER_MS;
/** Real time of the whole cartel: fade in, the duration, fade out. */
export const dialogTimeline = (text: string) => ({ fadeMs: CARTEL_FADE_MS, holdMs: dialogLifeMs(text) / CARTEL_UNITS_PER_MS });

let faceTable: Promise<Map<number, number>> | undefined;
/** NpcData(n).NpcFaceGrh from Dat/npcs.dat ([NPCn] NpcFaceGrh); 0 / missing when the NPC has none or the file cannot be read. */
export function loadNpcFaceGrhs(): Promise<Map<number, number>> {
  faceTable ??= fetchText('Dat/npcs.dat').then(text => {
    const faces = new Map<number, number>();
    for (const [section, fields] of parseIni(text)) {
      const match = /^npc(\d+)$/.exec(section), face = Number(fields.get('npcfacegrh') ?? 0);
      if (match && face > 0) faces.set(Number(match[1]), face);
    }
    return faces;
  }).catch(() => new Map<number, number>());
  return faceTable;
}

export class NpcDialog {
  private readonly root: HTMLElement;
  private timer: number | undefined;
  private timer2: number | undefined;
  private sheets = new Map<number, Promise<HTMLCanvasElement>>();
  private generation = 0;
  constructor(parent: HTMLElement, private readonly renderer: WorldRenderer) {
    this.root = document.createElement('div');
    this.root.id = 'npc-dialog'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', 'Diálogo del NPC');
    this.root.addEventListener('click', () => this.hide());
    parent.append(this.root);
  }
  get visible() { return !this.root.hidden; }
  hide() { this.generation++; this.root.hidden = true; this.clearTimers(); }
  private clearTimers() {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    if (this.timer2 !== undefined) window.clearTimeout(this.timer2);
    this.timer = this.timer2 = undefined;
  }

  /** The locale (NPC names and descriptions) may still be loading when the description arrives: wait for it, at most 10 s. */
  async showWhenReady(npcNumber: number, locale: () => LocaleData | undefined) {
    for (let waited = 0; !locale() && waited < 10_000; waited += 250) await new Promise(resolve => window.setTimeout(resolve, 250));
    await this.show(npcNumber, locale());
  }

  async show(npcNumber: number, locale: LocaleData | undefined) {
    const npc = locale?.npcs.get(npcNumber);
    if (!npc?.desc) return;
    const generation = ++this.generation;
    const portrait = await this.face(npcNumber).catch(() => undefined) ?? await this.portrait(npc.body, npc.head).catch(() => undefined);
    if (generation !== this.generation) return;
    const title = document.createElement('div'); title.className = 'npc-title'; title.textContent = npc.name.split(' <')[0]!;
    const text = document.createElement('div'); text.className = 'npc-text'; text.textContent = npc.desc;
    const body = document.createElement('div'); body.className = 'npc-body'; body.append(title, text);
    this.root.replaceChildren(...(portrait ? [portrait] : []), body);
    // cartel_fade 1 -> 255, hold for the duration, 255 -> 0, then cartel_visible = False.
    const { fadeMs, holdMs } = dialogTimeline(npc.desc);
    this.clearTimers();
    this.root.style.transition = 'none'; this.root.style.opacity = '0'; this.root.hidden = false;
    void this.root.offsetWidth; // commit opacity 0 before the fade-in starts
    this.root.style.transition = `opacity ${Math.round(fadeMs)}ms linear`; this.root.style.opacity = '1';
    this.timer = window.setTimeout(() => {
      this.root.style.opacity = '0';
      this.timer2 = window.setTimeout(() => this.hide(), fadeMs);
    }, fadeMs + holdMs);
  }

  /** The NpcFaceGrh icon, used only when the Grh really has a size (useNpcFaceGrh in HandleChatOverHeadImpl). */
  private async face(npcNumber: number): Promise<HTMLCanvasElement | undefined> {
    const grh = (await loadNpcFaceGrhs()).get(npcNumber);
    if (!grh) return undefined;
    await this.renderer.graphic(1);
    const canvas = await grhCanvas(this.renderer, grh);
    if (!canvas.width || !canvas.height) return undefined;
    canvas.className = 'npc-portrait npc-face';
    return canvas;
  }

  private sheet(file: number) {
    let pending = this.sheets.get(file);
    if (!pending) {
      pending = new Promise<HTMLCanvasElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          // Same black colour key as the world renderer.
          for (let i = 0; i < pixels.data.length; i += 4) if (!pixels.data[i] && !pixels.data[i + 1] && !pixels.data[i + 2]) pixels.data[i + 3] = 0;
          ctx.putImageData(pixels, 0, 0); resolve(canvas);
        };
        image.onerror = () => reject(new Error(`Missing local graphic ${file}`));
        image.src = `/ao-assets/Graficos/${file}.png`;
      });
      this.sheets.set(file, pending);
    }
    return pending;
  }
  private async portrait(body: number, head: number): Promise<HTMLCanvasElement | undefined> {
    await this.renderer.graphic(1); // metadata (bodies, heads) must be loaded first
    const layers = this.renderer.portraitLayers(body, head);
    if (!layers.length) return undefined;
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 96; canvas.className = 'npc-portrait';
    const ctx = canvas.getContext('2d')!;
    for (const layer of layers) {
      const frame = layer.animation.frames[0]!;
      ctx.drawImage(await this.sheet(frame.file), frame.x, frame.y, frame.width, frame.height,
        Math.floor((64 - 32) / 2) + layer.x + Math.floor((32 - frame.width) / 2), 90 - 32 + layer.y + 32 - frame.height, frame.width, frame.height);
    }
    return canvas;
  }
}
