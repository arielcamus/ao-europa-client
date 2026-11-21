/*
 * Glue between the session, the renderer and the audio engine: builds the engine, the director (what makes sound) and the options
 * window, unlocks the browser's AudioContext on the first user gesture, and plays the UI clicks of clsGraphicalButton.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import { AudioDirector } from './audio-director.js';
import type { AudioWorld } from './audio-director.js';
import { AudioEngine, parseCatalog } from './audio-engine.js';
import { AudioOptions } from './audio-options.js';
import { parseZones, terrainOf } from './audio-rules.js';
import { fetchText, assetUrl } from './assets.js';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';

/** The part of the world the director reads, over whichever session is current. */
export class SessionWorld implements AudioWorld {
  session: Session | undefined;
  constructor(private readonly renderer: WorldRenderer) {}
  get resourceMap() { return this.session?.resourceMap; }
  get position() { return this.session?.position; }
  get charIndex() { return this.session?.charIndex; }
  get dead() { return this.session?.dead ?? false; }
  get motion() { const m = this.session?.motion; return m && !m.translate ? { started: m.started, to: m.to } : undefined; }
  get mapReady() { return Boolean(this.session) && this.renderer.readyMap === this.session!.resourceMap; }
  char(index: number) {
    const char = this.session?.tracker.chars.get(index);
    // The tracker never moves the player's own character (the session predicts it), so its tile comes from the session.
    return char && index === this.session?.charIndex && this.session.position ? { ...char, ...this.session.position } : char;
  }
  get night() { return this.session?.world.isNight ?? false; }
  mapAudio() { return this.renderer.mapAudio; }
  terrainAt(x: number, y: number) { return this.renderer.terrainAt(x, y); }
  roofAt(x: number, y: number) { return this.renderer.roofAt(x, y); }
}

export class AudioSystem {
  readonly engine = new AudioEngine();
  readonly world: SessionWorld;
  readonly director: AudioDirector;
  readonly options: AudioOptions;

  constructor(root: HTMLElement, renderer: WorldRenderer, private readonly report: (message: string) => void) {
    this.world = new SessionWorld(renderer);
    this.director = new AudioDirector(this.engine, this.world);
    this.director.terrainOfGrh = (grh, overlay) => terrainOf(renderer.grhFile(grh), overlay);
    this.options = new AudioOptions(root, this.engine, () => this.director.click());
    // Browsers keep an AudioContext suspended until a user gesture; the login click or the first key press unlocks it.
    // Once the context exists the listeners have done their job and are removed (a suspended one is resumed by visibilitychange / the engine).
    const unlock = () => {
      this.engine.unlock();
      if (this.engine.isUnlocked) { window.removeEventListener('pointerdown', unlock, { capture: true }); window.removeEventListener('keydown', unlock, { capture: true }); }
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => this.engine.setSuspended(document.hidden));
    // clsGraphicalButton: SND_CLICK on press, SND_CLICK_OVER when the pointer enters an art button.
    const target = (event: Event) => (event.target as HTMLElement | null)?.closest?.('button.art-button, button.hotspot, button.vb-art') as HTMLButtonElement | null;
    root.addEventListener('pointerdown', event => { const button = target(event); if (button && !button.hidden) this.director.click(); });
    root.addEventListener('pointerover', event => {
      const button = target(event);
      if ((button?.classList.contains('art-button') || button?.classList.contains('vb-art')) && !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) this.director.hover();
    });
    if (new URLSearchParams(location.search).has('audiodebug')) (globalThis as { __aoAudio?: unknown }).__aoAudio = this;
  }
  /** Dat/zonas.dat (music rectangles). Sound is optional: without the file the map's own music number is used. */
  async init() {
    try {
      const response = await fetch(assetUrl('audio-index.json'));
      if (response.ok) this.engine.setCatalog(parseCatalog(await response.json()));
    } catch { /* no index: every candidate file is tried */ }
    try { this.director.zones = parseZones(await fetchText('Dat/zonas.dat')); }
    catch (error) { this.report(`Zonas de música no disponibles: ${String(error)}`); }
  }
  attach(session: Session) {
    this.world.session = session;
    // Waves the world FX decide: a travelling spell's arrival (positional) and RevisarHoraMundo's wolf / rooster (no position).
    session.world.setHooks({ playWave: (wave, x, y) => this.director.at(wave, x, y), playGlobalWave: wave => this.director.global(wave) });
    session.onPacket = packet => {
      try { this.director.receive(packet); } catch (error) { this.report(`Audio: ${String(error)}`); } // sound must never drop the session
    };
  }
  detach() { this.world.session = undefined; this.director.reset(); }
  tick() { try { this.director.tick(); } catch (error) { this.report(`Audio: ${String(error)}`); } }
}
